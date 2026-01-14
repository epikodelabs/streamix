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
 * Complete the output when a notifier emits.
 *
 * `takeUntil` subscribes to the provided `notifier` (a `Stream` or `Promise`) and
 * completes the output iterator as soon as the notifier produces its first
 * emission. Ordering between notifier and source values is managed using
 * emission stamps so that values from the source that are stamped at or after
 * the notifier emission will not be forwarded.
 *
 * Semantics and edge cases:
 * - Notifier emits: the operator records the notifier's emission stamp and
 *   cancels the source. Any source value whose stamp is greater than or equal
 *   to the notifier stamp is considered after the notifier and will not be
 *   emitted.
 * - Notifier errors: if the notifier throws before the next source value is
 *   emitted, the error is propagated immediately. If the notifier errors after
 *   a source value has been pulled, the operator will yield that pulled value
 *   first and then throw the notifier error on the subsequent pull.
 * - Notifier completes without emitting: the operator keeps forwarding source
 *   values normally (i.e. it stays open).
 *
 * Use-cases:
 * - Stop processing a stream when an external cancellation/timeout signal fires.
 *
 * @template T Source/output value type.
 * @param notifier A `Stream<any>` or `Promise<any>` whose first emission
 *        triggers completion of the output.
 * @returns An `Operator<T, T>` that completes when the notifier emits.
 */
export function takeUntil<T = any>(
  notifier: Stream<any> | Promise<any>
): Operator<T, T> {
  return createOperator<T, T>("takeUntil", (sourceIt) => {
    const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();

    let gateStamp: number | null = null;   // ONLY for notifier emit
    let notifierError: any = null;

    let pending: { value: T; stamp: number } | null = null;
    let throwAfterPending = false;

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
          // notifier EMIT → gate + cancel source
          gateStamp = stamp;
          try { sourceIt.return?.(); } catch {}
        }
      } catch (err) {
        // notifier ERROR → NO source cancellation
        notifierError = err;
      }
    })();

    const iterator: AsyncIterator<T> = {
      async next() {
        // 1) deliver buffered value
        if (pending) {
          const { value, stamp } = pending;
          pending = null;
          setIteratorEmissionStamp(iterator as any, stamp);
          return { done: false, value };
        }

        // 2) throw notifier error after pending value
        if (throwAfterPending) {
          throwAfterPending = false;
          throw notifierError;
        }

        // 3) pull source
        const r = await sourceIt.next();
        const stamp = stampOf(sourceIt);

        if (r.done) {
          if (notifierError) throw notifierError;
          return { done: true, value: undefined };
        }

        // 4) gate ONLY on notifier emit
        if (gateStamp !== null && stamp >= gateStamp) {
          return { done: true, value: undefined };
        }

        // 5) notifier errored AFTER pull → yield value, then error
        if (notifierError) {
          pending = { value: r.value, stamp };
          throwAfterPending = true;
          return this.next();
        }

        // 6) normal path
        setIteratorEmissionStamp(iterator as any, stamp);
        return { done: false, value: r.value };
      },

      async return() {
        try { sourceIt.return?.(); } catch {}
        try { notifierIt.return?.(); } catch {}
        pending = null;
        throwAfterPending = false;
        return { done: true, value: undefined };
      },

      async throw(err) {
        try { sourceIt.return?.(); } catch {}
        try { notifierIt.return?.(); } catch {}
        pending = null;
        throwAfterPending = false;
        throw err;
      },
    };

    return iterator;
  });
}
