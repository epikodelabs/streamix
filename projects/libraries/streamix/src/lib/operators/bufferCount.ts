import { DONE, type MaybePromise, NEXT, type Operator, createOperator, getIteratorMeta, isPromiseLike } from "../abstractions";
import { tagValue } from "./helpers";

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

    const iterator: AsyncIterator<any> = {
      next: async () => {
        if (completed) return DONE;

        const buffer: IteratorResult<T>[] = [];
        const metaByIndex: ({ valueId: string; operatorIndex: number; operatorName: string } | undefined)[] = [];
        
        const size = isPromiseLike(bufferSize) ? await bufferSize : bufferSize;
        while (buffer.length < size) {
          const result = await source.next();

          if (result.done) {
            completed = true;

            // Flush any remaining buffered values
            if (buffer.length > 0) {
              const metas = metaByIndex.filter(Boolean) as { valueId: string; operatorIndex: number; operatorName: string }[];
              const lastMeta = metas[metas.length - 1];
              const values = tagValue(iterator as any, buffer.map((r) => r.value!), lastMeta, {
                kind: "collapse",
                inputValueIds: metas.map((m) => m.valueId),
              });
              return NEXT(values);
            }

            return DONE;
          }

          buffer.push(result);
          metaByIndex.push(getIteratorMeta(source));
        }

        const metas = metaByIndex.filter(Boolean) as { valueId: string; operatorIndex: number; operatorName: string }[];
        const lastMeta = metas[metas.length - 1];
        const values = tagValue(iterator as any, buffer.map((r) => r.value!), lastMeta, {
          kind: "collapse",
          inputValueIds: metas.map((m) => m.valueId),
        });
        return NEXT(values);
      },
    };

    return iterator;
  });
