import {
  createOperator,
  Event,
  getIteratorEmissionStamp,
  nextEmissionStamp,
  setIteratorEmissionStamp,
  type Operator,
  type Stream
} from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";
import { createSubject } from "../subjects";

/**
 * Complete the output when a notifier emits.
 *
 * `takeUntil` forwards source values until the supplied `notifier` emits its
 * first value. When the notifier emits (or errors), the operator will stop
 * forwarding further source values and will complete (or error) the output
 * subscription at the appropriate logical boundary determined by emission
 * stamps.
 *
 * Key behaviors:
 * - Ordering and stamps: both source values and notifier signals carry a
 *   monotonic `stamp`. The operator uses stamp comparisons to decide whether a
 *   particular source value should be emitted (only values with stamps strictly
 *   less than the notifier's stamp are forwarded).
 * - Notifier error: if the notifier errors, that error is propagated to the
 *   output and the subscription is terminated.
 * - Notifier completion without emission: completing the notifier without any
 *   emission does not by itself stop the source; `takeUntil` only reacts to an
 *   actual `notifierEmit` event (or error).
 *
 * Typical use-cases:
 * - Stop processing a stream once an external cancellation or signal occurs.
 * - Implement timeouts or cancellation by piping a timer/abort-notifier.
 *
 * @template T Source/output value type.
 * @template R Notifier value type (ignored for payload).
 * @param notifier A `Stream<R>` or `Promise<R>` whose first emission triggers completion.
 * @returns An `Operator<T, T>` that ends the output when the notifier emits.
 */
export function takeUntil<T = any, R = any>(
  notifier: Stream<R> | Promise<R>
): Operator<T, T> {
  return createOperator<T, T>("takeUntil", function (
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
    /* Notifier producer                                                       */
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
        /* ignored */
      },
    });

    /* ---------------------------------------------------------------------- */
    /* Consumer (ONLY authority)                                               */
    /* ---------------------------------------------------------------------- */

    (async () => {
      let stopAtStamp: number | null = null;
      let notifierError: any = null;

      try {
        while (true) {
          const e = await dequeue();

          switch (e.kind) {
            case "source": {
              if (
                stopAtStamp !== null &&
                Math.abs(e.stamp) >= Math.abs(stopAtStamp)
              ) {
                throw "__STOP__";
              }

              setIteratorEmissionStamp(outIt as any, e.stamp);
              output.next(e.value);
              break;
            }

            case "notifierEmit": {
              stopAtStamp ??= e.stamp;
              throw "__STOP__";
            }

            case "notifierError": {
              notifierError = e.error;
              stopAtStamp ??= e.stamp;
              throw "__STOP__";
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
