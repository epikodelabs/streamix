import { createStream, isPromiseLike, type MaybePromise, type Stream } from '../abstractions';
import { eachValueFrom, fromAny } from '../converters';

/**
 * Combine multiple streams into a single stream that emits arrays of the latest values
 * from each input stream whenever any input emits. Emission occurs only when all inputs
 * have emitted at least once.
 *
 * @template T
 * @param {...Stream<T[number]>[]} sources - The input streams to zip.
 * @returns {Stream<T>} A stream emitting arrays of values from each input.
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
