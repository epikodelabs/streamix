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
 * Skip source values until a notifier emits.
 *
 * `skipUntil` suppresses (drops) source values until the provided `notifier`
 * produces its first emission. After the notifier emits, subsequent source
 * values are forwarded normally. Uses stamp-based filtering to ensure correct
 * ordering between notifier and source events.
 *
 * Important details:
 * - Ordering and stamps: when the gate opens (notifier emits) only source
 *   values whose stamp is strictly greater than the gate-opening stamp will be
 *   forwarded. This prevents forwarding values that were logically emitted
 *   before or concurrently with the notifier signal.
 * - Notifier completion without emission: if the notifier completes without
 *   emitting, the operator remains closed and continues to drop source values.
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
    /* Shared state                                                            */
    /* ---------------------------------------------------------------------- */

    let gateOpened = false;
    let gateStamp: number | null = null;
    let notifierError: any = null;

    /* ---------------------------------------------------------------------- */
    /* Notifier producer                                                       */
    /* ---------------------------------------------------------------------- */

    const notifierSub = fromAny(notifier).subscribe({
      next() {
        if (!gateOpened) {
          gateOpened = true;
          gateStamp = nextEmissionStamp();
        }
      },
      error(err) {
        notifierError = err;
      },
      complete() {
        // Notifier completed without emitting - gate stays closed
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

          // Only forward if gate is open AND stamp is strictly after gate stamp
          if (gateOpened && gateStamp !== null && Math.abs(stamp) > Math.abs(gateStamp)) {
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