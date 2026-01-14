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
 * Skip source values until a notifier emits.
 *
 * `skipUntil` suppresses (drops) source values until the provided `notifier`
 * produces its first emission. After the notifier emits, subsequent source
 * values are forwarded normally. Like other until-style operators, ordering is
 * determined using monotonic `stamp` values attached to emissions.
 *
 * Important details:
 * - Ordering and stamps: when the gate opens (notifier emits) only source
 *   values whose stamp is strictly greater than the gate-opening stamp will be
 *   forwarded. This prevents forwarding values that were logically emitted
 *   before or concurrently with the notifier signal.
 * - Notifier completion without emission: if the notifier completes without
 *   emitting, the operator remains closed and continues to drop source values
 *   (unless the notifier later emits, which will open the gate).
 * - Error propagation: errors from either the notifier or source are propagated
 *   to the output and will terminate the subscription.
 *
 * Common uses:
 * - Ignore initial values until a readiness signal arrives.
 * - Wait for user interaction before processing inputs.
 *
 * @template T Source/output value type.
 * @template R Notifier value type (ignored by this operator).
 * @param notifier A `Stream<R>` or `Promise<R>` that opens the gate when it emits.
 * @returns An `Operator<T, T>` that drops source values until the notifier emits.
 */
export function skipUntil<T = any, R = any>(
  notifier: Stream<R> | Promise<R>
): Operator<T, T> {
  return createOperator<T, T>("skipUntil", function (
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
    /* Source producer (AFTER notifier subscription)                           */
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

      try {
        while (true) {
          const e = await dequeue();

          switch (e.kind) {
            case "notifierEmit":
              if (!gateOpened) {
                gateOpened = true;
                gateStamp = e.stamp;
              }
              break;

            case "notifierDone":
              break;

            case "notifierError":
              notifierError = e.error;
              throw "__STOP__";

            case "source": {
              if (!gateOpened) break;

              if (
                gateStamp !== null &&
                Math.abs(e.stamp) <= Math.abs(gateStamp)
              ) {
                break;
              }

              setIteratorEmissionStamp(outIt as any, e.stamp);
              output.next(e.value);
              break;
            }

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
