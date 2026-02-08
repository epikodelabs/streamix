import {
    createOperator,
    DONE,
    getIteratorMeta,
    isPromiseLike,
    NEXT,
    type MaybePromise,
    type Operator
} from "../abstractions";
import { tagValue } from "./helpers";

type BufferRecord<T> = {
  result: IteratorResult<T>;
  meta?: { valueId: string; operatorIndex: number; operatorName: string };
};

/**
 * Buffers values while the provided predicate returns `true`.
 *
 * The predicate is evaluated for each incoming value against the *current* buffer (before the value is added).
 * If it resolves to `true`, the value is appended to the current buffer. If it resolves to `false`, the current
 * buffer is flushed and a new buffer is started with the incoming value.
 *
 * When the source completes, any remaining buffered values are emitted automatically.
 *
 * @template T Source value type.
 * @param predicate Function invoked for each value to decide whether the value should remain in the current buffer.
 * Receives the incoming value, the index, and the current buffer (before pushing the value). It may return a promise.
 */
export const bufferWhile = <T = any>(
  predicate: (value: T, index: number, buffer: T[]) => MaybePromise<boolean>
) =>
  createOperator<T, T[]>("bufferWhile", function (this: Operator, source) {
    let completed = false;
    let index = 0;

    const buffer: BufferRecord<T>[] = [];

    const iterator: AsyncIterator<any> = {
      next: async () => {
        const flushBuffer = (): IteratorResult<T[]> => {
          const records = buffer.splice(0);
          if (records.length === 0) return NEXT([]);

          const metas = records
            .map((record) => record.meta)
            .filter(Boolean) as { valueId: string; operatorIndex: number; operatorName: string }[];
          const lastMeta = metas[metas.length - 1];
          const values = tagValue(iterator as any, records.map((record) => record.result.value!), lastMeta, {
            kind: "collapse",
            inputValueIds: metas.map((e) => e.valueId),
          });

          return NEXT(values);
        };

        if (completed) {
          if (buffer.length > 0) {
            return flushBuffer();
          }
          return DONE;
        }

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

          const values = buffer.map((item) => item.result.value!);
          const predicateResult = predicate(result.value, index++, values);
          const shouldKeep = isPromiseLike(predicateResult) ? await predicateResult : predicateResult;

          // Always start a buffer with the first value.
          if (buffer.length === 0) {
            buffer.push(record);
            continue;
          }

          if (shouldKeep) {
            buffer.push(record);
            continue;
          }

          // Boundary: flush the current buffer and start a new one with this value.
          const flushed = flushBuffer();
          buffer.push(record);

          return flushed;
        }
      },
    };

    return iterator;
  });
