import {
  createOperator,
  DONE,
  getIteratorMeta,
  isPromiseLike,
  NEXT,
  setIteratorMeta,
  setValueMeta,
  type MaybePromise,
  type Operator
} from "../abstractions";

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
    let pending: BufferRecord<T> | null = null;

    // If the predicate doesn't declare the `buffer` parameter, treat it as a
    // boundary predicate: the first value that fails starts the *next* buffer.
    const boundaryIsNextValue = predicate.length < 3;

    const iterator: AsyncIterator<any> = {
      next: async () => {
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

        if (completed) {
          if (buffer.length > 0) {
            return flushBuffer();
          }
          return DONE;
        }

        while (true) {
          // If we previously flushed and staged a value for the next buffer,
          // install it now before pulling more from source.
          if (pending) {
            buffer.push(pending);
            pending = null;
          }

          const result = await source.next();
          if (result.done) {
            completed = true;
            if (buffer.length > 0) {
              return flushBuffer();
            }
            return DONE;
          }

          const record = { result, meta: getIteratorMeta(source) };

          // Push first, then evaluate predicate against the updated buffer.
          buffer.push(record);
          const valuesAfterPush = buffer.map((item) => item.result.value!);
          const predicateResult = predicate(result.value, index++, valuesAfterPush);
          const shouldKeep = isPromiseLike(predicateResult)
            ? await predicateResult
            : predicateResult;

          if (shouldKeep) continue;

          // Predicate is false: flush.
          if (boundaryIsNextValue) {
            // Current value belongs to the next buffer.
            pending = buffer.pop() ?? null;
            // If we'd flush an empty buffer, just keep buffering.
            if (buffer.length === 0 && pending) {
              buffer.push(pending);
              pending = null;
              continue;
            }
          }

          return flushBuffer();
        }
      },
    };

    return iterator;
  });
