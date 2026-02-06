import {
    createOperator,
    DONE,
    getIteratorEmissionStamp,
    getIteratorMeta,
    NEXT,
    nextEmissionStamp,
    setIteratorMeta,
    setValueMeta,
    type Operator,
    type Stream,
} from "../abstractions";
import { fromAny } from "../converters";
import { createSubject } from "../subjects";

type BufferRecord<T> = {
  value: T;
  meta?: {
    valueId: string;
    operatorIndex: number;
    operatorName: string;
  };
};

export const bufferUntil = <T = any>(notifier: Stream<any>) =>
  createOperator<T, T[]>("bufferUntil", function (this: Operator, source) {
    const output = createSubject<T[]>();
    const outputIt = output[Symbol.asyncIterator]();

    const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();

    let buffer: BufferRecord<T>[] = [];
    let cancelled = false;

    const flush = () => {
      if (buffer.length === 0) return;

      const records = buffer;
      buffer = [];

      const metas = records
        .map(r => r.meta)
        .filter(Boolean) as {
          valueId: string;
          operatorIndex: number;
          operatorName: string;
        }[];

      let values = records.map(r => r.value);

      if (metas.length) {
        const last = metas[metas.length - 1];

        const collapse = {
          valueId: last.valueId,
          kind: "collapse" as const,
          inputValueIds: metas.map(m => m.valueId),
        };

        setIteratorMeta(
          iterator,
          collapse,
          last.operatorIndex,
          last.operatorName
        );

        values = setValueMeta(
          values,
          collapse,
          last.operatorIndex,
          last.operatorName
        );
      }

      output.next(values);
    };

    /* ---------- synchronous pull helpers ---------- */

    const sourceTryNext = (source as any).__tryNext as
      | undefined
      | (() => IteratorResult<T> | null);

    const notifierTryNext = (notifierIt as any).__tryNext as
      | undefined
      | (() => IteratorResult<any> | null);

    const push = (value: T) => {
      buffer.push({
        value,
        meta: getIteratorMeta(source),
      });
    };

    const canUseSyncPull = typeof sourceTryNext === "function" && typeof notifierTryNext === "function";

    /* ---------- sync pull mode (both have __tryNext) ---------- */

    if (canUseSyncPull) {
      let pendingSourceResult: IteratorResult<T> | null = null;
      let pendingNotifierResult: IteratorResult<any> | null = null;

      const drainBoth = () => {
        while (!cancelled) {
          // First, try to get pending or new results
          if (!pendingSourceResult) {
            try {
              pendingSourceResult = sourceTryNext!.call(source);
            } catch (err) {
              cancelled = true;
              try { notifierIt.return?.(); } catch {}
              output.error(err);
              return;
            }
          }

          if (!pendingNotifierResult) {
            try {
              pendingNotifierResult = notifierTryNext!.call(notifierIt);
            } catch (err) {
              cancelled = true;
              try { source.return?.(); } catch {}
              output.error(err);
              return;
            }
          }

          // If both are null, we're caught up - wait for more data
          if (!pendingSourceResult && !pendingNotifierResult) {
            return;
          }

          // If only source has data, process it
          if (pendingSourceResult && !pendingNotifierResult) {
            if (pendingSourceResult.done) {
              cancelled = true;
              flush();
              output.complete();
              return;
            }
            push(pendingSourceResult.value);
            pendingSourceResult = null;
            continue;
          }

          // If only notifier has data, process it
          if (pendingNotifierResult && !pendingSourceResult) {
            if (pendingNotifierResult.done) {
              cancelled = true;
              try { source.return?.(); } catch {}
              output.complete();
              return;
            }
            flush();
            pendingNotifierResult = null;
            continue;
          }

          // Both have data - compare timestamps to decide order
          if (pendingSourceResult && pendingNotifierResult) {
            const sourceStamp = getIteratorEmissionStamp(source) ?? nextEmissionStamp();
            const notifierStamp = getIteratorEmissionStamp(notifierIt) ?? nextEmissionStamp();

            if (sourceStamp <= notifierStamp) {
              // Process source first
              if (pendingSourceResult.done) {
                cancelled = true;
                flush();
                output.complete();
                return;
              }
              push(pendingSourceResult.value);
              pendingSourceResult = null;
              // Leave pendingNotifierResult for next iteration
            } else {
              // Process notifier first
              if (pendingNotifierResult.done) {
                cancelled = true;
                try { source.return?.(); } catch {}
                output.complete();
                return;
              }
              flush();
              pendingNotifierResult = null;
              // Leave pendingSourceResult for next iteration
            }
          }
        }
      };

      // Set up push callbacks for both iterators
      (source as any).__onPush = drainBoth;
      (notifierIt as any).__onPush = drainBoth;
      
      // Initial drain
      drainBoth();
    }
    /* ---------- async mode (fallback) ---------- */
    else {
      /* ---------- notifier loop ---------- */

      (async () => {
        try {
          while (!cancelled) {
            const r = await notifierIt.next();
            if (r.done || cancelled) break;
            flush();
          }
        } catch (err) {
          if (!cancelled) {
            cancelled = true;
            try { await source.return?.(); } catch {}
            output.error(err);
          }
        }
      })();

      /* ---------- source handling ---------- */

      if (typeof sourceTryNext === "function") {
        const drain = () => {
          while (!cancelled) {
            let r: IteratorResult<T> | null;
            try {
              r = sourceTryNext.call(source);
            } catch (err) {
              cancelled = true;
              try { notifierIt.return?.(); } catch {}
              output.error(err);
              return;
            }

            if (!r) return;

            if (r.done) {
              cancelled = true;
              flush();
              output.complete();
              return;
            }

            push(r.value);
          }
        };

        (source as any).__onPush = drain;
        drain();
      } else {
        (async () => {
          try {
            while (!cancelled) {
              const r = await source.next();
              if (r.done || cancelled) break;
              push(r.value);
            }

            if (!cancelled) {
              cancelled = true;
              flush();
              output.complete();
            }
          } catch (err) {
            if (!cancelled) {
              cancelled = true;
              try { await notifierIt.return?.(); } catch {}
              output.error(err);
            }
          }
        })();
      }
    }

    /* ---------- iterator facade ---------- */

    const iterator: AsyncIterator<T[]> = {
      next: () => outputIt.next(),

      return: async (value?: any) => {
        cancelled = true;
        try { await source.return?.(); } catch {}
        try { await notifierIt.return?.(); } catch {}
        output.complete();
        return value !== undefined ? NEXT(value) : DONE;
      },

      throw: async (err?: any) => {
        cancelled = true;
        output.error(err);
        return outputIt.throw?.(err) ?? Promise.reject(err);
      },
    };

    return iterator;
  });