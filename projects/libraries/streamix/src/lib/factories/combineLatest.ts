import { flow, type Atom } from "../atoms/atom";
import { toAsyncIterable, type PipeInput } from '../atoms/pipe';
import { createAsyncCoordinator } from "../utils";
import { normalizeError } from "../atoms";

/**
 * Combines multiple sources and emits a tuple containing the latest values
 * from each source whenever any of the source sources emits a new value.
 *
 * This operator is useful for scenarios where you need to react to changes
 * in multiple independent data sources simultaneously. The output atom
 * will not emit a value until all source sources have emitted at least one
 * value. The output atom completes when all source sources have completed.
 *
 * @template {unknown[]} T A tuple type representing the combined values from the sources.
 * @param sources Atoms, streams, or values (including promises) to combine.
 * @returns {Atom<T>} A new atom that emits a tuple of the latest values from all source sources.
 */
export function combineLatest<T extends unknown[] = any[]>(
  ...sources: Array<PipeInput<T[number]>>
): Atom<T> {
  return flow<T>(async function* () {
    if (sources.length === 0) return;

    const iterators = sources.map((s) =>
      toAsyncIterable(s)[Symbol.asyncIterator]() as AsyncIterator<T[number]>
    );
    const runner = createAsyncCoordinator<T[number]>(iterators);

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
              yield latestValues.slice() as T;
            }
            break;

          case "complete":
            completedCount++;
            break;

          case "error":
            throw normalizeError(event.error);
        }
      }
    } finally {
      // Ensure all upstream iterators are closed
      await runner.return?.();
    }
  });
}
