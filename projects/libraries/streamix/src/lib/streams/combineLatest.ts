import { createStream, type MaybePromise, type Stream } from "../abstractions";
import { fromAny } from "../converters";
import { createAsyncCoordinator } from "../utils";

/**
 * Combines multiple streams and emits a tuple containing the latest values
 * from each stream whenever any of the source streams emits a new value.
 *
 * This operator is useful for scenarios where you need to react to changes
 * in multiple independent data sources simultaneously. The output stream
 * will not emit a value until all source streams have emitted at least one
 * value. The output stream completes when all source streams have completed.
 *
 * @template {unknown[]} T A tuple type representing the combined values from the sources.
 * @param sources Streams or values (including promises) to combine.
 * @returns {Stream<T>} A new stream that emits a tuple of the latest values from all source streams.
 */
export function combineLatest<T extends unknown[] = any[]>(
  ...sources: Array<Stream<T[number]> | MaybePromise<T[number]>>
): Stream<T> {
  return createStream<T>("combineLatest", async function* () {
    if (sources.length === 0) return;

    const iterators = sources.map((s) => fromAny(s)[Symbol.asyncIterator]());
    const runner = createAsyncCoordinator(iterators);

    const latestValues = new Array(sources.length).fill(undefined);
    const hasEmitted = new Set<number>();
    let completedCount = 0;

    try {
      while (completedCount < sources.length) {
        const result = await runner.next();
        
        if (result.done) break;

        const event = result.value;

        switch (event.type) {
          case "value":
            latestValues[event.sourceIndex] = event.value;
            hasEmitted.add(event.sourceIndex);

            // Only emit if all sources have provided at least one value
            if (hasEmitted.size === sources.length) {
              yield [...latestValues] as T;
            }
            break;

          case "complete":
            completedCount++;
            break;

          case "error":
            throw event.error;
        }
      }
    } finally {
      // Ensure all upstream iterators are closed
      await runner.return?.();
    }
  });
}