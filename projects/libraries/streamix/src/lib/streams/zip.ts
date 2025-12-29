import { createStream, isPromiseLike, type MaybePromise, type Stream } from '../abstractions';
import { eachValueFrom, fromAny } from '../converters';

/**
 * Combines multiple streams by emitting an array of values (a tuple),
 * only when all streams have a value ready (one-by-one, synchronized).
 *
 * It waits for the next value from all streams to form the next tuple.
 * The stream completes when any of the input streams complete.
 * Errors from any stream propagate immediately.
 *
 * @template T - A tuple type representing the combined values from the streams.
 * @param sources Streams or values (including promises) to combine.
 * @returns {Stream<T>} A new stream that emits a synchronized tuple of values.
 */
export function zip<T extends readonly unknown[] = any[]>(
  ...sources: Array<Stream<T[number]> | MaybePromise<T[number]>>
): Stream<T> {

  return createStream<T>('zip', async function* (): AsyncGenerator<T, void, unknown> {
    if (sources.length === 0) return;

    const resolvedSources: Array<Stream<T[number]> | Array<T[number]> | T[number]> = [];
    for (const source of sources) {
      resolvedSources.push(isPromiseLike(source) ? await source : source);
    }

    const iterators = resolvedSources.map((source) =>
      eachValueFrom(fromAny(source))
    );

    try {
      while (true) {
        const results = await Promise.all(iterators.map(it => it.next()));
        if (results.some(r => r.done)) break;
        yield results.map(r => r.value) as unknown as T;
      }
    } finally {
      await Promise.all(
        iterators.map(it => (typeof it.return === 'function' ? it.return(undefined).catch(() => {}) : Promise.resolve()))
      );
    }
  });
}
