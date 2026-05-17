import { isDroppedResult } from '../abstractions';
import { createStream, type Stream } from '../abstractions';
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

    const iterators = sources.map((source) => {
      const resolved = fromAny(source as any);
      return ((resolved as any)[RAW]?.() ?? resolved[Symbol.asyncIterator]()) as AsyncIterator<T[number]>;
    });

    try {
      while (true) {
        const results = await Promise.all(iterators.map(it => it.next()));
        if (results.some(r => r.done)) break;
        const droppedResult = results.find((r) => isDroppedResult(r));
        if (droppedResult) {
          // If one source drops, we still need to advance all iterators.
          // The dropped value is yielded so downstream can observe it,
          // but the other iterators have already advanced — their values
          // are consumed and discarded. This is a known semantic limitation
          // of zip with backpressure-aware sources.
          yield droppedResult as any;
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
