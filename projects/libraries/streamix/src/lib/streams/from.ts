import { createStream, isPromiseLike, type MaybePromise, type Stream } from "../abstractions";

/**
 * Creates a stream from an asynchronous or synchronous iterable.
 *
 * This operator is a powerful way to convert any source that can be iterated
 * over (such as arrays, strings, `Map`, `Set`, `AsyncGenerator`, etc.) into
 * a reactive stream. The stream will emit each value from the source in order
 * before completing.
 *
 * @template T The type of the values in the iterable.
 * @param {AsyncIterable<T> | Iterable<T> | PromiseLike<AsyncIterable<T> | Iterable<T>>} source The iterable source to convert into a stream.
 * @returns {Stream<T>} A new stream that emits each value from the source.
 */
export function from<T = any>(source: MaybePromise<AsyncIterable<T> | Iterable<T>>): Stream<T> {
  async function* generator() {
    const resolvedSource = isPromiseLike(source) ? await source : source;
    const iterator = (resolvedSource as any)[Symbol.asyncIterator]?.() ?? (resolvedSource as any)[Symbol.iterator]?.();

    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) break;
        yield result.value;
      }
    } finally {
      if (iterator.return) {
        await iterator.return();
      }
    }
  }

  const stream = createStream<T>("from", generator);

  // `from()` is fundamentally pull-based. Iterating it (directly or through
  // pull operators such as `take`) must therefore pull the wrapped iterable
  // only when downstream asks for another value.
  //
  // createStream() intentionally fans a generator run out through a Subject for
  // subscription/multicast semantics. That producer loop can advance before an
  // AsyncIterator consumer has pulled the buffered value, which is correct for
  // push subscriptions but would make `from(source).pipe(take(n))` observe
  // source value n + 1 before `take` gets a chance to close upstream.
  //
  // Preserve createStream's subscription behaviour, but expose the source
  // generator directly for AsyncIterator consumption so iterator cancellation
  // reaches the original iterable without prefetching.
  stream[Symbol.asyncIterator] = () => generator();

  return stream;
}
