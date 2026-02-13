import { createStream, isPromiseLike, type MaybePromise, type Stream } from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";
import { createAsyncCoordinator } from "../utils";

/**
 * Merges multiple source streams into a single stream, emitting values as they arrive from any source.
 *
 * Values are emitted in timestamp order to preserve causality across sources.
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
 * - Timestamp-based ordering ensures temporal causality
 *
 * @template T The type of the values in the streams.
 * @param sources Streams or values (including promises) to merge.
 * @returns {Stream<T>} A new stream that emits values from all input streams in timestamp order.
 *
 * @example
 * ```typescript
 * const fast = interval(10);
 * const slow = interval(100);
 * const instant = from([1, 2, 3]);
 *
 * // All values emitted in timestamp order
 * merge(fast, slow, instant).forEach(console.log);
 * ```
 */
export function merge<T = any>(...sources: (Stream<T> | MaybePromise<T>)[]): Stream<T> {
  return createStream<T>('merge', async function* () {
    if (sources.length === 0) return;

    // Resolve any promises in sources
    const resolvedSources: Array<Stream<T> | Array<T> | T> = [];
    for (const source of sources) {
      resolvedSources.push(isPromiseLike(source) ? await source : source);
    }

    // Convert all sources to iterators
    const iterators = resolvedSources.map((source) =>
      eachValueFrom(fromAny<T>(source))
    );

    // Use coordinator to handle multi-source coordination with timestamp ordering
    const coordinator = createAsyncCoordinator(iterators);

    try {
      while (true) {
        const result = await coordinator.next();
        if (result.done) break;
        const event = result.value;
        if (event.type === 'value') {
          yield event.value;
        } else if (event.type === 'error') {
          throw event.error;
        }
        // 'complete' events are tracked internally by the coordinator
      }
    } finally {
      // Coordinator cleanup handles calling return() on all source iterators
      await coordinator.return?.();
    }
  });
}