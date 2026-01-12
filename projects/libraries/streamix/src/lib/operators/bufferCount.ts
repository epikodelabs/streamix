import { DONE, type MaybePromise, NEXT, type Operator, createOperator, getIteratorMeta, isPromiseLike, setIteratorMeta, setValueMeta } from "../abstractions";

/**
 * Buffers a fixed number of values from the source stream and emits them as arrays,
 * tracking pending and phantom values in the PipeContext.
 *
 * @template T The type of values in the source stream.
 * @param bufferSize The maximum number of values per buffer (default: Infinity).
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export const bufferCount = <T = any>(bufferSize: MaybePromise<number> = Infinity) =>
  createOperator<T, T[]>("bufferCount", function (this: Operator, source) {
    let completed = false;
    let resolvedBufferSize: number | undefined;
    const resolveBufferSize = (): MaybePromise<number> => {
      if (resolvedBufferSize !== undefined) {
        return resolvedBufferSize;
      }
      if (isPromiseLike(bufferSize)) {
        return bufferSize.then((val) => {
          resolvedBufferSize = val;
          return val;
        });
      }
      resolvedBufferSize = bufferSize;
      return resolvedBufferSize;
    };

    const iterator: AsyncIterator<any> = {
      next: async () => {
        if (completed) return DONE;

        const buffer: IteratorResult<T>[] = [];
        const metaByIndex: ({ valueId: string; operatorIndex: number; operatorName: string } | undefined)[] = [];

        const sizeOrPromise = resolveBufferSize();
        const size = isPromiseLike(sizeOrPromise) ? await sizeOrPromise : sizeOrPromise;
        while (buffer.length < size) {
          const result = await source.next();

          if (result.done) {
            completed = true;

            // Flush any remaining buffered values
            if (buffer.length > 0) {
              const metas = metaByIndex.filter(Boolean) as { valueId: string; operatorIndex: number; operatorName: string }[];
              const lastMeta = metas[metas.length - 1];
              let values = buffer.map((r) => r.value!);
              if (lastMeta) {
                setIteratorMeta(
                  iterator as any,
                  {
                    valueId: lastMeta.valueId,
                    kind: "collapse",
                    inputValueIds: metas.map((m) => m.valueId),
                  },
                  lastMeta.operatorIndex,
                  lastMeta.operatorName
                );
                values = setValueMeta(
                  values,
                  { valueId: lastMeta.valueId, kind: "collapse", inputValueIds: metas.map((m) => m.valueId) },
                  lastMeta.operatorIndex,
                  lastMeta.operatorName
                );
              }
              return NEXT(values);
            }

            return DONE;
          }

          buffer.push(result);
          metaByIndex.push(getIteratorMeta(source));
        }

        const metas = metaByIndex.filter(Boolean) as { valueId: string; operatorIndex: number; operatorName: string }[];
        const lastMeta = metas[metas.length - 1];
        let values = buffer.map((r) => r.value!);
        if (lastMeta) {
          setIteratorMeta(
            iterator as any,
            {
              valueId: lastMeta.valueId,
              kind: "collapse",
              inputValueIds: metas.map((m) => m.valueId),
            },
            lastMeta.operatorIndex,
            lastMeta.operatorName
          );
          values = setValueMeta(
            values,
            { valueId: lastMeta.valueId, kind: "collapse", inputValueIds: metas.map((m) => m.valueId) },
            lastMeta.operatorIndex,
            lastMeta.operatorName
          );
        }
        return NEXT(values);
      },
    };

    return iterator;
  });
