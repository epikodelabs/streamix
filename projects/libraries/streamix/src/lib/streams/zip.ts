import { createStream, isPromiseLike, MaybePromise, Stream } from '../abstractions';
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
 * @param sources Streams to combine.
 * @returns {Stream<T>} A new stream that emits a synchronized tuple of values.
 */
export function zip<T extends readonly unknown[] = any[]>(
  ...sources: Array<MaybePromise<Stream<T[number]> | Array<T[number]> | T[number]>>
): Stream<T> {

  return createStream<T>('zip', async function* (): AsyncGenerator<T, void, unknown> {
    const resolvedInputs: any[] = [];
    for (const src of sources) {
      resolvedInputs.push(isPromiseLike(src) ? await src : src);
    }

    const normalizedStreams = (resolvedInputs.length === 1 && Array.isArray(resolvedInputs[0])
      ? resolvedInputs[0]
      : resolvedInputs) as Array<Stream<T[number]> | Array<T[number]> | T[number]>;

    if (normalizedStreams.length === 0) return;

    const iterators = await Promise.all(
      normalizedStreams.map(async (s) => {
        const streamSource = isPromiseLike(s) ? await s : s;
        return eachValueFrom(fromAny(streamSource));
      })
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
