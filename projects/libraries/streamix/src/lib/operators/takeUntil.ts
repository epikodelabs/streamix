import {
  createOperator,
  getIteratorEmissionStamp,
  nextEmissionStamp,
  setIteratorEmissionStamp,
  type Operator,
  type Stream,
} from "../abstractions";
import { fromAny } from "../converters";

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
