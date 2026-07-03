import { flow, type Atom } from "../atoms/atom";
import { toAsyncIterable, type PipeInput } from '../atoms/pipe';
import { createAsyncCoordinator } from "../utils";
import { normalizeError } from "../atoms";

/**
 * Merges multiple source streams into a single atom, emitting values as they arrive from any source.
 *
 * This is useful for combining data from multiple independent sources into a single,
 * unified stream of events. Unlike `zip`, it does not wait for a value from every
 * stream before emitting; it emits values as they become available.
 *
 * The merged atom completes only after all source streams have completed.
 * If any source stream errors, the merged atom immediately errors.
 *
 * **Performance characteristics:**
 * - Synchronous sources with buffered values are drained immediately
 * - Asynchronous sources are pulled concurrently
 *
 * @template T The type of the values in the streams.
 * @param sources Atoms, streams, or values (including promises) to merge.
 * @returns {Atom<T>} A new atom that emits values from all input streams.
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
export function merge<T = any>(...sources: PipeInput<T>[]): Atom<T> {
  return flow<T>(async function* () {
    if (sources.length === 0) return;

    const iterators = sources.map((source) =>
      toAsyncIterable(source)[Symbol.asyncIterator]() as AsyncIterator<T>
    );
    let coordinator: ReturnType<typeof createAsyncCoordinator<T>> | null = null;

    try {
      const initialResults = await Promise.allSettled(iterators.map((iterator) => iterator.next()));
      const activeIterators: AsyncIterator<T>[] = [];

      for (let i = 0; i < initialResults.length; i++) {
        const settled = initialResults[i];
        if (settled.status === 'rejected') {
          throw normalizeError(settled.reason);
        }

        const result = settled.value;
        if (result.done) continue;

        yield result.value;
        activeIterators.push(iterators[i]);
      }

      coordinator = createAsyncCoordinator<T>(activeIterators);

      while (true) {
        const result = await coordinator.next();
        if (result.done) break;

        const event = result.value;
        if (event.type === 'error') {
          throw normalizeError(event.error);
        }
        if (event.type === 'value') {
          yield event.value;
        }
      }
    } finally {
      if (coordinator) {
        await coordinator.return?.();
      } else {
        await Promise.all(
          iterators.map((iterator) => {
            try {
              return Promise.resolve(iterator.return?.()).catch(() => {});
            } catch {
              return Promise.resolve();
            }
          })
        );
      }
    }
  });
}
