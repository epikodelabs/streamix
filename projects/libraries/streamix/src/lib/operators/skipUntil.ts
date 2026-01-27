import {
  createOperator,
  getIteratorEmissionStamp,
  nextEmissionStamp,
  setIteratorEmissionStamp,
  type Operator,
  type Stream,
} from "../abstractions";
import { fromAny } from "../converters";

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
  return createOperator<T, T>("skipUntil", (sourceIt) => {
    const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();

    let gateStamp: number | null = null;
    let notifierError: any = null;

    const stampOf = (it: any) => {
      const s = getIteratorEmissionStamp(it);
      return typeof s === "number" ? s : nextEmissionStamp();
    };

    // Observe notifier exactly once
    (async () => {
      try {
        const r = await notifierIt.next();
        const stamp = stampOf(notifierIt);
        if (!r.done) {
          gateStamp = stamp;
        }
      } catch (err) {
        notifierError = err;
        try {
          await sourceIt.return?.();
        } catch {}
      } finally {
        try {
          await notifierIt.return?.();
        } catch {}
      }
    })();

    const iterator: AsyncIterator<T> = {
      async next() {
        while (true) {
          if (notifierError) throw notifierError;

          const r = await sourceIt.next();
          const stamp = stampOf(sourceIt);

          if (r.done) {
            if (notifierError) throw notifierError;
            return { done: true, value: undefined };
          }

          // Gate closed: drop values until notifier emits.
          if (gateStamp === null) {
            continue;
          }

          // Only forward values strictly after the gate-opening stamp.
          if (stamp <= gateStamp) {
            continue;
          }

          setIteratorEmissionStamp(iterator as any, stamp);
          return { done: false, value: r.value };
        }
      },

      async return() {
        try {
          await sourceIt.return?.();
        } catch {}
        try {
          await notifierIt.return?.();
        } catch {}
        return { done: true, value: undefined };
      },

      async throw(err) {
        try {
          await sourceIt.return?.();
        } catch {}
        try {
          await notifierIt.return?.();
        } catch {}
        throw err;
      },
    };

    return iterator;
  });
}
