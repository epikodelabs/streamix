import { createStream, DROPPED, isPromiseLike, type Stream } from "../abstractions";
import { fromAny } from "../converters";
import { createAsyncCoordinator } from "../utils";

const RAW = Symbol.for("streamix.rawAsyncIterator");

/**
 * Merges multiple source streams into a single stream, emitting values as they arrive from any source.
 *
 * This is useful for combining data from multiple independent sources into a single,
 * unified stream of events. Unlike `zip`, it does not wait for a value from every
 * stream before emitting; it emits values as they become available.
 *
 * The merged stream completes only after all source streams have completed.
 * If any source stream errors, the merged stream immediately errors.
 *
 * **Performance characteristics:**
 * - Synchronous sources with buffered values are drained immediately
 * - Asynchronous sources are pulled concurrently
 *
 * @template T The type of the values in the streams.
 * @param sources Streams or values (including promises) to merge.
 * @returns {Stream<T>} A new stream that emits values from all input streams.
 *
 * @example
 * ```typescript
 * const fast = interval(10);
 * const slow = interval(100);
 * const instant = from([1, 2, 3]);
 *
 * // Values emitted as they arrive
 * merge(fast, slow, instant).forEach(console.log);
 * ```
 */
export function merge<T = any>(...sources: (Stream<T> | Promise<T>)[]): Stream<T> {
  const gen = async function* () {
    if (sources.length === 0) return;

    // Resolve any promises in sources
    const resolvedSources: Array<Stream<T> | Array<T> | T> = [];
    for (const source of sources) {
      resolvedSources.push(isPromiseLike(source) ? await source : source);
    }

    const iterators = resolvedSources.map((source) => {
      const resolved = fromAny<T>(source);
      return ((resolved as any)[RAW]?.() ?? resolved[Symbol.asyncIterator]()) as AsyncIterator<T>;
    });
    const initialResults = await Promise.allSettled(iterators.map((iterator) => iterator.next()));

    const activeIterators: AsyncIterator<T>[] = [];

    for (let i = 0; i < initialResults.length; i++) {
      const settled = initialResults[i];
      if (settled.status === 'rejected') {
        throw settled.reason;
      }

      const result = settled.value;
      if (result.done) {
        continue;
      }

      if ((result as any).dropped) {
        yield DROPPED(result.value) as any;
      } else {
        yield result.value;
      }
      activeIterators.push(iterators[i]);
    }

    const coordinator = createAsyncCoordinator(activeIterators);

    try {
      while (true) {
        const result = await coordinator.next();
        if (result.done) break;

        const event = result.value;
        if (event.type === 'error') {
          throw event.error;
        }
        if (event.type === 'value') {
          if (event.dropped) {
            yield DROPPED(event.value) as any;
          } else {
            yield event.value;
          }
        }
      }
    } finally {
      await coordinator.return?.();
    }
  };

  const stream = createStream<T>('merge', gen);
  (stream as any)[RAW] = gen;
  return stream;
}
