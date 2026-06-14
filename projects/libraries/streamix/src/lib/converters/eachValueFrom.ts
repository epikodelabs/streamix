import type { Stream } from "../abstractions";
import { iterate, type Atom } from "../atoms";

function isAtomLike(value: unknown): value is Atom<any> {
  return value != null && (value as any).type === "atom";
}

/**
 * Converts a `Stream` or atom into an async generator, yielding each emitted value.
 *
 * The generator handles all source events:
 * - Each yielded value corresponds to a real `next` emission, including undefined.
 * - The generator terminates when the source completes.
 * - It throws an error if the source emits an `error` event.
 *
 * @template T The type of the values emitted by the source.
 * @param source The source stream or atom to convert.
 * @returns An async generator that yields the values from the source.
 */
export function eachValueFrom<T = any>(source: Stream<T> | Atom<T> | AsyncIterable<T>): AsyncGenerator<T> {
  const iterator = isAtomLike(source)
    ? iterate(source)[Symbol.asyncIterator]()
    : source[Symbol.asyncIterator]();

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

  const gen = generate();
  // Ensure the generator itself is iterable for `for await` convenience.
  (gen as any)[Symbol.asyncIterator] = () => gen;
  return gen;
}
