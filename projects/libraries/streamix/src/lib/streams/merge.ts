import { createStream, type Stream } from "../abstractions";
import { fromAny } from "../converters";
import { createAsyncCoordinator } from "../utils";

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

    const iterators = sources.map((source) => {
      const resolved = fromAny<T>(source as any);
      return resolved[Symbol.asyncIterator]() as AsyncIterator<T>;
    });

    // Track coordinator so the outer finally can clean it up even if it was
    // created before an early return/throw.
    let coordinator: ReturnType<typeof createAsyncCoordinator> | null = null;

    try {
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

        yield result.value;
        activeIterators.push(iterators[i]);
      }

      coordinator = createAsyncCoordinator(activeIterators);

      while (true) {
        const result = await coordinator.next();
        if (result.done) break;

        const event = result.value;
        if (event.type === 'error') {
          throw event.error;
        }
        if (event.type === 'value') {
          yield event.value;
        }
      }
    } finally {
      // coordinator.return() cleans up iterators that were handed to it.
      // For iterators that never made it into activeIterators (completed on
      // first pull), call return() directly so no iterator leaks.
      if (coordinator) {
        await coordinator.return?.();
      } else {
        // Early exit before coordinator was created — clean up all iterators.
        await Promise.all(
          iterators.map((it) => {
            try { return Promise.resolve(it.return?.()).catch(() => {}); } catch { return Promise.resolve(); }
          })
        );
      }
    }
  };

  return createStream<T>('merge', gen);
}