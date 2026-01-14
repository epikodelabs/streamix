import {
  createOperator,
  getIteratorEmissionStamp,
  nextEmissionStamp,
  setIteratorEmissionStamp,
  type Operator,
  type Stream,
} from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";
import { createSubject } from "../subjects";

/* -------------------------------------------------------------------------- */
/* Event model                                                                 */
/* -------------------------------------------------------------------------- */

type Event<T> =
  | { kind: "source"; value: T; stamp: number }
  | { kind: "sourceDone"; stamp: number }
  | { kind: "notifierEmit"; stamp: number }
  | { kind: "notifierError"; error: any; stamp: number }
  | { kind: "notifierDone"; stamp: number };


/**
 * Creates a stream operator that delays the emission of values from the source stream
 * until a separate `notifier` stream emits at least one value.
 *
 * This operator acts as a gate. It buffers all values from the source stream
 * until the `notifier` stream emits its first value. Once the notifier emits,
 * the operator immediately flushes all buffered values and then passes through
 * all subsequent values from the source without delay.
 *
 * If the `notifier` stream completes without ever emitting a value, the buffered 
 * values are DISCARDED, and the operator simply waits for the source to complete.
 *
 * @template T The type of the values in the source and output streams.
 * @param notifier The stream or promise that acts as a gatekeeper.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
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

