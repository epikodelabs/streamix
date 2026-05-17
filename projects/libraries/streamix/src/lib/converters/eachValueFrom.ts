import type { Stream } from "../abstractions";

/**
 * Converts a `Stream` into an async generator, yielding each emitted value.
 *
 * The generator handles all stream events:
 * - Each yielded value corresponds to a real `next` emission, including undefined.
 * - The generator terminates when the stream `complete`s.
 * - It throws an error if the stream emits an `error` event.
 *
 * @template T The type of the values emitted by the stream.
 * @param stream The source stream to convert.
 * @returns An async generator that yields the values from the stream.
 */
export function eachValueFrom<T = any>(stream: Stream<T>): AsyncGenerator<T> {
  const iterator = stream[Symbol.asyncIterator]();

  async function* generate(): AsyncGenerator<T> {
    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) return;
        yield result.value;
      }
    } finally {
      try {
        await iterator.return?.();
      } catch {
      }
    }
  }

  return generate();
}
