import { createOperator, DONE, getIteratorMeta, isPromiseLike, NEXT, setIteratorMeta, setValueMeta, type MaybePromise, type Operator } from "../abstractions";

type BufferRecord<T> = {
  result: IteratorResult<T>;
  meta?: { valueId: string; operatorIndex: number; operatorName: string };
};

/**
 * Buffers values until the provided predicate returns `true`, then flushes automatically.
 *
 * The predicate receives the current buffer contents and the most recent value (including timestamps if present).
 * When it resolves truthy, the current buffer is emitted and reset. When the source completes, any remaining
 * buffered values are emitted automatically.
 *
 * @template T Source value type.
 * @param predicate Function invoked for each value to decide whether to flush. Receives the buffer (after the latest value is pushed)
 * and the latest value itself. It may return a promise.
 * @param flushOnComplete Whether to emit the last partially-filled buffer when the source completes (default: `true`).
 */
export const bufferWhile = <T = any>(
  predicate: (buffer: T[], next: T) => MaybePromise<boolean>
) =>
  createOperator<T, T[]>("bufferUntil", function (this: Operator, source) {
    let completed = false;

    const iterator: AsyncIterator<any> = {
      next: async () => {
        if (completed) return DONE;

        const buffer: BufferRecord<T>[] = [];

        const flushBuffer = (): IteratorResult<T[]> => {
          const records = buffer.splice(0);
          if (records.length === 0) return NEXT([]);

          const metas = records
            .map((record) => record.meta)
            .filter(Boolean) as { valueId: string; operatorIndex: number; operatorName: string }[];
          const lastMeta = metas[metas.length - 1];
          let values = records.map((record) => record.result.value!);

          if (lastMeta) {
            setIteratorMeta(
              iterator as any,
              {
                valueId: lastMeta.valueId,
                kind: "collapse",
                inputValueIds: metas.map((e) => e.valueId),
              },
              lastMeta.operatorIndex,
              lastMeta.operatorName
            );
            values = setValueMeta(
              values,
              { valueId: lastMeta.valueId, kind: "collapse", inputValueIds: metas.map((e) => e.valueId) },
              lastMeta.operatorIndex,
              lastMeta.operatorName
            );
          }

          return NEXT(values);
        };

        while (true) {
          const result = await source.next();
          if (result.done) {
            completed = true;
            if (buffer.length > 0) {
              return flushBuffer();
            }
            return DONE;
          }

          const record = { result, meta: getIteratorMeta(source) };
          buffer.push(record);

          const values = buffer.map((item) => item.result.value!);
          const predicateResult = predicate(values, result.value);
          const shouldFlush = isPromiseLike(predicateResult) ? await predicateResult : predicateResult;

          if (shouldFlush) {
            return flushBuffer();
          }
        }
      },
    };

    return iterator;
  });
