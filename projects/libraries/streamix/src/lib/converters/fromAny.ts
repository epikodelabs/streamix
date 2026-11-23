import { DONE, createStream, isPromiseLike, isStreamLike, MaybePromise, type Stream } from "../abstractions";

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
  value: MaybePromise<R | Stream<R> | Iterable<R> | AsyncIterable<R>>
): Stream<R> {
  // Step 1: If it's already a stream, return as-is
  if (isStreamLike<R>(value)) {
    return value;
  }
  
  // Step 2: Handle promises, arrays, iterables, and single values in one generator
  const stream = createStream<R>("fromAny", async function* () {
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
  if (isPromiseLike(value)) {
    stream[Symbol.asyncIterator] = () => {
      let closed = false;
      let closing: Promise<IteratorResult<R>> | undefined;
      const prepared = Promise.resolve(value).then(resolved => {
        const iterable = resolved as AsyncIterable<R> | null;
        return iterable?.[Symbol.asyncIterator]?.()
          ?? fromAny<R>(resolved as R)[Symbol.asyncIterator]();
      });
      void prepared.catch(() => {});
      return {
        async next() {
          if (closed) return DONE;
          const iterator = await prepared;
          if (closed) return DONE;
          const result = await iterator.next();
          return closed ? DONE : result;
        },
        return(value?: unknown) {
          closed = true;
          return closing ??= prepared.then(
            async iterator => {
              await iterator.return?.();
              return { done: true, value };
            },
            () => ({ done: true, value })
          );
        }
      };
    };
  }
  return stream;
}