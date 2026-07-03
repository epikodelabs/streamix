import { createStream, type Stream } from "../abstractions";
import { fromAny } from "../converters";
import { createAsyncCoordinator, normalizeError } from "../utils";

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

    const iterators = sources.map((source) =>
      fromAny<T>(source as any)[Symbol.asyncIterator]() as AsyncIterator<T>
    );
    const coordinator = createAsyncCoordinator<T>(iterators);

    try {
      while (true) {
        const result = await coordinator.next();
        if (result.done) break;

        const event = result.value;
        if (event.type === "error") {
          throw normalizeError(event.error);
        }
        if (event.type === "value") {
          yield event.value;
        }
      }
    } finally {
      await coordinator.return?.();
    }
  };

  return createStream<T>("merge", gen);
}
