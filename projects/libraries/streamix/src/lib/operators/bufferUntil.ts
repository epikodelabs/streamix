import {
    createOperator,
    DONE,
    getIteratorEmissionStamp,
    getIteratorMeta,
    NEXT,
    setIteratorMeta,
    setValueMeta,
    type Operator,
    type Stream,
} from "../abstractions";
import { fromAny } from "../converters";
import { createSubject } from "../subjects";

type BufferRecord<T> = {
  value: T;
  stamp: number;
  meta?: {
    valueId: string;
    operatorIndex: number;
    operatorName: string;
  };
};

/**
 * Emits arrays of buffered source values whenever the `notifier` stream emits.
 *
 * This operator collects values from the source stream into a buffer. When the
 * `notifier` emits, all buffered values up to that point are flushed as a single
 * array downstream. The buffer is then cleared and begins collecting new values
 * until the next notifier emission. If the source completes, any remaining buffered
 * values are flushed as a final array.
 *
 * Metadata is attached to the output array to track collapse operations and value
 * lineage for tracing.
 *
 * @param notifier Stream whose emissions trigger buffer flushes.
 * @returns Operator that emits arrays of buffered values.
 *
 * @example
 * from([1,2,3]).pipe(bufferUntil(timer(1000))) // emits [1,2,3] after 1s
 */
export const bufferUntil = <T = any>(notifier: Stream<any>) =>
  createOperator<T, T[]>("bufferUntil", function (this: Operator, source) {
    const output = createSubject<T[]>();
    const outputIt = output[Symbol.asyncIterator]();

    const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();

    let buffer: BufferRecord<T>[] = [];
    let cancelled = false;

    /**
     * Flush all buffered values with stamp < cutoffStamp.
     * Used when notifier emits to partition batches by emission order.
     */
    const flushBefore = (cutoffStamp: number) => {
      const matching = buffer.filter(r => r.stamp < cutoffStamp);
      buffer = buffer.filter(r => r.stamp >= cutoffStamp);

      if (matching.length === 0) return;

      const metas = matching
        .map(r => r.meta)
        .filter(Boolean) as {
          valueId: string;
          operatorIndex: number;
          operatorName: string;
        }[];

      let values = matching.map(r => r.value);

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

    /**
     * Flush all remaining buffered values.
     * Used when source completes.
     */
    const flushAll = () => {
      if (buffer.length === 0) return;

      const matching = buffer;
      buffer = [];

      const metas = matching
        .map(r => r.meta)
        .filter(Boolean) as {
          valueId: string;
          operatorIndex: number;
          operatorName: string;
        }[];

      let values = matching.map(r => r.value);

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

    const sourceTryNext = (source as any).__tryNext as
      | undefined
      | (() => IteratorResult<T> | null);

    const notifierTryNext = (notifierIt as any).__tryNext as
      | undefined
      | (() => IteratorResult<any> | null);

    const pushSourceValue = (value: T, stamp: number) => {
      buffer.push({
        value,
        stamp,
        meta: getIteratorMeta(source),
      });
    };

    const canUseSyncPull = typeof sourceTryNext === "function" && typeof notifierTryNext === "function";

    /* ---------- sync pull mode (both source and notifier have __tryNext) ---------- */

    if (canUseSyncPull) {
      const drainBoth = () => {
        while (!cancelled) {
          let sourceResult: IteratorResult<T> | null = null;
          let notifierResult: IteratorResult<any> | null = null;

          // Try to pull from both
          try {
            sourceResult = sourceTryNext!.call(source);
          } catch (err) {
            cancelled = true;
            try { notifierIt.return?.(); } catch {}
            output.error(err);
            return;
          }

          try {
            notifierResult = notifierTryNext!.call(notifierIt);
          } catch (err) {
            cancelled = true;
            try { source.return?.(); } catch {}
            output.error(err);
            return;
          }

          // If nothing available, we're caught up
          if (!sourceResult && !notifierResult) {
            return;
          }

          // Process source value
          if (sourceResult) {
            if (sourceResult.done) {
              cancelled = true;
              flushAll();
              output.complete();
              return;
            }
            const sourceStamp = getIteratorEmissionStamp(source);
            pushSourceValue(sourceResult.value, sourceStamp ?? 0);
          }

          // Process notifier emission
          if (notifierResult) {
            if (notifierResult.done) {
              cancelled = true;
              try { source.return?.(); } catch {}
              output.complete();
              return;
            }
            // Flush all values emitted before this notifier emission
            const notifierStamp = getIteratorEmissionStamp(notifierIt) ?? 0;
            flushBefore(notifierStamp);
          }
        }
      };

      // Both iterators call drain when they receive pushed values
      (source as any).__onPush = drainBoth;
      (notifierIt as any).__onPush = drainBoth;
      
      // Initial drain to process any immediately available values
      drainBoth();
    }
    /* ---------- async mode (fallback when __tryNext not available) ---------- */
    else {
      /* ---------- notifier async loop ---------- */

      void void (async () => {
        try {
          while (!cancelled) {
            const r = await notifierIt.next();
            if (r.done || cancelled) break;
            // In async mode, flush on every notifier emission
            flushAll();
          }
        } catch (err) {
          if (!cancelled) {
            cancelled = true;
            try { await source.return?.(); } catch {}
            output.error(err);
          }
        }
      })();

      /* ---------- source async loop ---------- */

      void void (async () => {
        try {
          while (!cancelled) {
            const r = await source.next();
            if (r.done || cancelled) break;
            const sourceStamp = getIteratorEmissionStamp(source) ?? 0;
            pushSourceValue(r.value, sourceStamp);
          }

          if (!cancelled) {
            cancelled = true;
            flushAll();
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