import { DONE, type MaybePromise, NEXT, type Operator, createOperator, isPromiseLike } from "../abstractions";

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
        const size = isPromiseLike(bufferSize) ? await bufferSize : bufferSize;
        while (buffer.length < size) {
          const result = await source.next();

          if (result.done) {
            completed = true;

            // Flush any remaining buffered values
            if (buffer.length > 0) {
              return NEXT(buffer.map((r) => r.value!));
            }

            return DONE;
          }

          if ((result as any).dropped) continue;

          buffer.push(result);
        }

        return NEXT(buffer.map((r) => r.value!));
      },
    };

    return iterator;
  });
