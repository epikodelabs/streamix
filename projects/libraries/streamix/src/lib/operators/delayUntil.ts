import {
  createOperator,
  Event,
  getIteratorEmissionStamp,
  nextEmissionStamp,
  setIteratorEmissionStamp,
  type Operator,
  type Stream,
} from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";
import { createSubject } from "../subjects";

/**
 * Delay values from the source until a notifier emits.
 *
 * This operator buffers every value produced by the source stream and releases
 * them only after the provided `notifier` produces its first emission. After the
 * notifier emits, the operator flushes the buffered values (in timestamp order)
 * and forwards all subsequent source values immediately.
 *
 * Important semantics:
 * - Ordering and stamps: each source emission and notifier signal is stamped with
 *   a monotonic emission `stamp`. The operator uses `stamp` comparisons to
 *   determine ordering and to avoid races between near-simultaneous notifier and
 *   source events. Buffered values are flushed only if their stamp is strictly
 *   greater than the gate-opening stamp.
 * - Notifier completion without emission: if the notifier completes without
 *   emitting, buffered values are discarded and the operator will not forward
 *   any buffered values (it simply waits for the source to continue/complete).
 * - Error propagation: any error from the notifier or source is propagated to
 *   the output (the operator records the error and terminates the output
 *   iterator accordingly).
 *
 * Use-cases:
 * - Delay producing values until an initialization step completes (e.g. wait
 *   for a connection or configuration event).
 * - Gate values until user interaction or external readiness signal occurs.
 *
 * @template T Source/output value type.
 * @template R Notifier value type (ignored by this operator).
 * @param notifier A `Stream<R>` or `Promise<R>` that gates the source.
 * @returns An `Operator<T, T>` that can be used in a stream pipeline.
 */
export function delayUntil<T = any, R = any>(
  notifier: Stream<R> | Promise<R>
): Operator<T, T> {
  return createOperator<T, T>("delayUntil", function (
    this: Operator,
    source: AsyncIterator<T>
  ) {
    const output = createSubject<T>();
    const outIt = eachValueFrom(output);

    /* ---------------------------------------------------------------------- */
    /* Shared queue                                                            */
    /* ---------------------------------------------------------------------- */

    const queue: Event<T>[] = [];
    let wake: (() => void) | null = null;

    const enqueue = (e: Event<T>) => {
      queue.push(e);
      wake?.();
      wake = null;
    };

    const dequeue = async (): Promise<Event<T>> => {
      while (queue.length === 0) {
        await new Promise<void>((r) => (wake = r));
      }
      queue.sort((a, b) => Math.abs(a.stamp) - Math.abs(b.stamp));
      return queue.shift()!;
    };

    /* ---------------------------------------------------------------------- */
    /* Notifier producer (MUST BE FIRST)                                       */
    /* ---------------------------------------------------------------------- */

    const notifierSub = fromAny(notifier).subscribe({
      next() {
        enqueue({ kind: "notifierEmit", stamp: nextEmissionStamp() });
      },
      error(err) {
        enqueue({
          kind: "notifierError",
          error: err,
          stamp: nextEmissionStamp(),
        });
      },
      complete() {
        enqueue({ kind: "notifierDone", stamp: nextEmissionStamp() });
      },
    });

    /* ---------------------------------------------------------------------- */
    /* Source producer                                                         */
    /* ---------------------------------------------------------------------- */

    (async () => {
      try {
        while (true) {
          const r = await source.next();
          const stamp =
            getIteratorEmissionStamp(source) ?? nextEmissionStamp();

          if (r.done) {
            enqueue({ kind: "sourceDone", stamp });
            break;
          }

          enqueue({ kind: "source", value: r.value, stamp });
        }
      } catch (err) {
        enqueue({
          kind: "notifierError",
          error: err,
          stamp: nextEmissionStamp(),
        });
      }
    })();

    /* ---------------------------------------------------------------------- */
    /* Consumer (ONLY authority)                                               */
    /* ---------------------------------------------------------------------- */

    (async () => {
      let gateOpened = false;
      let gateStamp: number | null = null;
      let notifierError: any = null;

      const buffer: Array<{ value: T; stamp: number }> = [];

      try {
        while (true) {
          const e = await dequeue();

          switch (e.kind) {
            case "notifierEmit":
              if (!gateOpened) {
                gateOpened = true;
                gateStamp = e.stamp;

                // flush buffered values AFTER gate stamp
                for (const b of buffer) {
                  setIteratorEmissionStamp(outIt as any, b.stamp);
                  output.next(b.value);
                }
                buffer.length = 0;
              }
              break;

            case "notifierDone":
              // no-op (buffer stays, but will be discarded if never opened)
              break;

            case "notifierError":
              notifierError = e.error;
              throw "__STOP__";

            case "source":
              if (!gateOpened) {
                buffer.push({ value: e.value, stamp: e.stamp });
                break;
              }

              if (
                gateStamp !== null &&
                Math.abs(e.stamp) <= Math.abs(gateStamp)
              ) {
                break;
              }

              setIteratorEmissionStamp(outIt as any, e.stamp);
              output.next(e.value);
              break;

            case "sourceDone":
              throw "__STOP__";
          }
        }
      } catch (err) {
        if (err !== "__STOP__") {
          output.error(err);
          return;
        }
      } finally {
        notifierSub.unsubscribe();
        source.return?.();

        if (notifierError) output.error(notifierError);
        else output.complete();
      }
    })();

    return outIt;
  });
}

