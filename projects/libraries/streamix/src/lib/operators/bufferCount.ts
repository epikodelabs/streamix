import { DONE, NEXT, type Operator, createOperator } from "../atoms";

/**
 * Buffers a fixed number of values from the source stream and emits them as arrays,
 * tracking pending and phantom values in the PipeContext.
 *
 * @template T The type of values emitted by the source and output.
 * @param bufferSize The maximum number of values per buffer (default: Infinity).
 * A non-positive or NaN size is rejected: with one, the collection loop never
 * runs and every pull would return an empty array without consuming the
 * source, turning even an empty source into an unending sequence.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export const bufferCount = <T>(bufferSize: number = Infinity) => {
  if (Number.isNaN(bufferSize) || bufferSize <= 0) {
    throw new RangeError(
      `bufferCount requires a positive buffer size, received ${String(bufferSize)}.`,
    );
  }

  return createOperator<T, T[]>("bufferCount", function (this: Operator, source) {
    let completed = false;

    const iterator: AsyncIterator<any> = {
      next: async () => {
        if (completed) return DONE;

        const buffer: IteratorResult<T>[] = [];
        while (buffer.length < bufferSize) {
          const result = await source.next();

          if (result.done) {
            completed = true;

            // Flush any remaining buffered values
            if (buffer.length > 0) {
              return NEXT(buffer.map((r) => r.value!));
            }

            return DONE;
          }

          buffer.push(result);
        }

        return NEXT(buffer.map((r) => r.value!));
      },
    };

    return iterator;
  });
};
