import {
  createOperator,
  DONE,
  getIteratorEmissionStamp,
  NEXT,
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
    let notifierErrorStamp: number | null = null;

    let pending: { value: T; stamp: number } | null = null;

    const stampOf = (it: any) => {
      const s = getIteratorEmissionStamp(it);
      return typeof s === "number" ? s : nextEmissionStamp();
    };

    // Observe notifier exactly once
    void (async () => {
      try {
        const r = await notifierIt.next();
        const stamp = stampOf(notifierIt);

        if (!r.done) {
          // notifier EMIT → gate + cancel source
          gateStamp = stamp;
          try { await sourceIt.return?.(); } catch {}
        }
      } catch (err) {
        // notifier ERROR → NO source cancellation
        notifierError = err;
        notifierErrorStamp = stampOf(notifierIt);
      } finally {
        try { await notifierIt.return?.(); } catch {}
      }
    })();

    const tryDrainBufferedValue = (): IteratorResult<T> | null => {
      const tryNext = (sourceIt as any).__tryNext;
      if (typeof tryNext === "function") {
        try {
          return tryNext.call(sourceIt);
        } catch {
          return null;
        }
      }
      return null;
    };

    const iterator: AsyncIterator<T> = {
      async next() {
        while (true) {
          // 1) deliver buffered value
          if (pending) {
            const { value, stamp } = pending;
            pending = null;
            setIteratorEmissionStamp(iterator as any, stamp);
            return NEXT(value);
          }

          // 2) notifier ERROR: flush buffered source values that happened
          // before the notifier error stamp, then throw.
          if (notifierError) {
            const buffered = tryDrainBufferedValue();
            if (buffered && !buffered.done) {
              const stamp = stampOf(sourceIt);
              if (notifierErrorStamp === null || stamp < notifierErrorStamp) {
                setIteratorEmissionStamp(iterator as any, stamp);
                return NEXT(buffered.value);
              }
            }
            throw notifierError;
          }

          // 3) pull source
          const r = await sourceIt.next();
          const stamp = stampOf(sourceIt);

          if (r.done) {
            if (notifierError) throw notifierError;
            return DONE;
          }

          // 4) gate ONLY on notifier emit
          if (gateStamp !== null && stamp >= gateStamp) {
            return DONE;
          }

          // 5) notifier errored AFTER pull → yield value, then error
          if (notifierError) {
            if (notifierErrorStamp === null || stamp < notifierErrorStamp) {
              pending = { value: r.value, stamp };
              continue;
            }
            throw notifierError;
          }

          // 6) normal path
          setIteratorEmissionStamp(iterator as any, stamp);
          return NEXT(r.value);
        }
      },

      async return() {
        try { await sourceIt.return?.(); } catch {}
        try { await notifierIt.return?.(); } catch {}
        pending = null;
        return DONE;
      },

      async throw(err) {
        try { await sourceIt.return?.(); } catch {}
        try { await notifierIt.return?.(); } catch {}
        pending = null;
        throw err;
      },
    };

    return iterator;
  });
}
