import { createStream, DROPPED, isPromiseLike, type Stream } from '../abstractions';
import { fromAny } from '../converters';

const RAW = Symbol.for("streamix.rawAsyncIterator");

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
  ...sources: Array<Stream<T[number]> | Promise<T[number]>>
): Stream<T> {

  const gen = async function* (): AsyncGenerator<T, void, unknown> {
    if (sources.length === 0) return;

    const resolvedSources: Array<Stream<T[number]> | Array<T[number]> | T[number]> = [];
    for (const source of sources) {
      resolvedSources.push(isPromiseLike(source) ? await source : source);
    }

    const iterators = resolvedSources.map((source) => {
      const resolved = fromAny(source);
      return ((resolved as any)[RAW]?.() ?? resolved[Symbol.asyncIterator]()) as AsyncIterator<T[number]>;
    });

    try {
      while (true) {
        const results = await Promise.all(iterators.map(it => it.next()));
        if (results.some(r => r.done)) break;
        const droppedResult = results.find((r: any) => r.dropped);
        if (droppedResult) {
          yield DROPPED(droppedResult.value) as any;
        } else {
          yield results.map(r => r.value) as unknown as T;
        }
      }
    } finally {
      await Promise.all(
        iterators.map(it => (typeof it.return === 'function' ? it.return(undefined).catch(() => {}) : Promise.resolve()))
      );
    }
  };

  const stream = createStream<T>('zip', gen);
  (stream as any)[RAW] = gen;
  return stream;
}
