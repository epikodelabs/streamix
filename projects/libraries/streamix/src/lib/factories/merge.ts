import { normalizeError } from "../atoms";
import { flow, type Atom } from "../atoms/atom";
import { toAsyncIterable, type PipeInput } from '../atoms/pipe';
import { createAsyncCoordinator } from "../utils";

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
 * **Ordering note:** when several sources have values available at the same
 * tick, they are interleaved round-robin (one value per source per pass)
 * rather than drained first-to-last. `merge(from([1,2]), from([3]), from([4]))`
 * emits `1, 3, 4, 2`. RxJS drains synchronous sources in subscription order
 * (`1, 2, 3, 4`); prefer `concat` when strict order matters.
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
    const coordinator = createAsyncCoordinator<T>(iterators);

    try {
      while (true) {
        const result = await coordinator.next();
        if (result.done) break;

        const event = result.value;
        switch (event.type) {
          case 'value':
            yield event.value;
            break;
          case 'error':
            throw normalizeError(event.error);
        }
      }
    } finally {
      await coordinator.return?.();
    }
  });
}
