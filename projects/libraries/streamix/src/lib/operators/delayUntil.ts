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

/**
 * Delay values from the source until a notifier emits.
 *
 * This operator buffers every value produced by the source stream and releases
 * them only after the provided `notifier` produces its first emission. After the
 * notifier emits, the operator flushes the buffered values and forwards all
 * subsequent source values immediately.
 *
 * Important semantics:
 * - Buffering: values are buffered until the notifier emits, then flushed in order
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
    /* Shared state                                                            */
    /* ---------------------------------------------------------------------- */

    let gateOpened = false;
    let notifierError: any = null;
    const buffer: Array<{ value: T; stamp: number }> = [];

    /* ---------------------------------------------------------------------- */
    /* Notifier producer                                                       */
    /* ---------------------------------------------------------------------- */

    const notifierSub = fromAny(notifier).subscribe({
      next() {
        if (!gateOpened) {
          gateOpened = true;
          
          // Flush buffered values
          for (const b of buffer) {
            setIteratorEmissionStamp(outIt as any, b.stamp);
            output.next(b.value);
          }
          buffer.length = 0;
        }
      },
      error(err) {
        notifierError = err;
      },
      complete() {
        // Notifier completed without emitting - discard buffer
      },
    });

    /* ---------------------------------------------------------------------- */
    /* Source producer                                                         */
    /* ---------------------------------------------------------------------- */

    (async () => {
      try {
        while (true) {
          const r = await source.next();
          const stamp = getIteratorEmissionStamp(source) ?? nextEmissionStamp();

          if (r.done) {
            break;
          }

          if (notifierError) {
            break;
          }

          if (!gateOpened) {
            buffer.push({ value: r.value, stamp });
          } else {
            setIteratorEmissionStamp(outIt as any, stamp);
            output.next(r.value);
          }
        }
      } catch (err) {
        output.error(err);
        return;
      } finally {
        notifierSub.unsubscribe();

        if (notifierError) {
          output.error(notifierError);
        } else {
          output.complete();
        }
      }
    })();

    return outIt;
  });
}