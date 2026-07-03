import { createStream, isPromiseLike, isStreamLike, MaybePromise, type Stream } from "../abstractions";

/**
 * Converts various value types into a Stream.
 *
 * This function normalizes different input types into a consistent Stream interface:
 * - Streams are passed through as-is
 * - Promises are awaited and their resolved values are processed
 * - Arrays have each element emitted individually
 * - Single values are emitted as-is
 *
 * @template R The type of values emitted by the resulting stream.
 * @param value The input value to convert. Can be:
 *   - a {@link Stream<R>}
 *   - a `Promise<R>` (single value)
 *   - a `Promise<Array<R>>` (multiple values from array)
 *   - a plain value `R`
 *   - an array `Array<R>`
 * @returns A {@link Stream<R>} that emits the normalized values.
 */
export function fromAny<R = any>(
  value: Stream<R> | MaybePromise<R> | Array<R> | Iterable<R> | AsyncIterable<R>
): Stream<R> {
  // Step 1: If it's already a stream, return as-is
  if (isStreamLike<R>(value)) {
    return value;
  }
  
  // Step 2: Handle promises, arrays, iterables, and single values in one generator
  return createStream("fromAny", async function* () {
    // Await promise if needed
    const resolved = isPromiseLike(value) ? await value : value;
    const candidate = resolved as any;

    if (isStreamLike<R>(resolved)) {
      for await (const item of resolved) {
        yield item;
      }
    } else if (candidate != null && typeof candidate[Symbol.asyncIterator] === 'function') {
      for await (const item of resolved as AsyncIterable<R>) {
        yield item;
      }
    } else if (candidate != null && typeof candidate[Symbol.iterator] === 'function' && typeof resolved !== 'string') {
      for (const item of resolved as Iterable<R>) {
        yield item;
      }
    } else {
      // Single value
      yield resolved as R;
    }
  });
}
