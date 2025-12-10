import { Stream } from "../abstractions";

/**
 * Converts a `Stream` into an async generator, yielding each emitted value.
 * Distinguishes between undefined values and stream completion.
 *
 * This function creates a bridge between the push-based nature of a stream and
 * the pull-based nature of an async generator. It relies on the stream's
 * async-iterable interface (backed by the same multicast machinery used for
 * subscriptions), so `for await...of eachValueFrom(stream)` is equivalent to
 * `for await...of stream`.
 *
 * The generator handles all stream events:
 * - Each yielded value corresponds to a `next` event, including undefined values.
 * - The generator terminates when the stream `complete`s.
 * - It throws an error if the stream emits an `error` event.
 *
 * It correctly handles situations where the stream completes or errors out
 * before any values are yielded, and ensures the subscription is
 * always cleaned up.
 *
 * @template T The type of the values emitted by the stream.
 * @param stream The source stream to convert.
 * @returns An async generator that yields the values from the stream.
 */
export function eachValueFrom<T = any>(stream: Stream<T>): AsyncGenerator<T> {
  const iterator = stream[Symbol.asyncIterator]();

  // Some iterators only satisfy AsyncIterator; ensure AsyncGenerator shape by
  // making `[Symbol.asyncIterator]` return itself.
  if (typeof (iterator as any)[Symbol.asyncIterator] !== "function") {
    (iterator as any)[Symbol.asyncIterator] = () => iterator;
  }

  return iterator as AsyncGenerator<T>;
}
