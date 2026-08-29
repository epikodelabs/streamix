import { flow, type Atom } from "../atoms/atom";
import { toAsyncIterable, type PipeInput } from '../atoms/pipe';
import { createAsyncCoordinator } from "../utils";
import { normalizeError } from "../atoms";

/**
 * Waits for all sources to complete and emits an array of their last values.
 *
 * This is similar to RxJS `forkJoin`:
 * - Each source is consumed fully.
 * - The output emits exactly once (an array of the last value from each source)
 *   and then completes.
 * - If any source errors, the output errors.
 * - If any source completes without emitting a value, `forkJoin` errors.
 *
 * Sources may be atoms, streams, or plain values (including promises).
 *
 * @template R A tuple type representing the last values emitted by each source.
 * @param sources Atoms, streams, or values (including promises) to join.
 * @returns An atom that emits a single array of last values.
 *
 * @example
 * const s = forkJoin(from([1, 2]), from([10]));
 * // emits: [2, 10]
 */
export function forkJoin<R extends readonly unknown[] = any[]>(
  ...sources: { [K in keyof R]: PipeInput<R[K]> }
): Atom<R >;

/**
 * Overload that accepts an array/tuple of sources.
 *
 * @template R
 * @param sources Tuple/array of sources.
 * @returns An atom that emits a single array of last values.
 */
export function forkJoin<R extends readonly unknown[] = any[]>(
  sources: { [K in keyof R]: PipeInput<R[K]> }
): Atom<R >;

/**
 * Implementation signature.
 *
 * This implementation supports both `forkJoin(a, b, c)` and `forkJoin([a, b, c])`.
 */
export function forkJoin<R extends readonly unknown[] = any[]>(
  ...sources: any[]
): Atom<R > {
  return flow<R >(async function* () {
    const normalizedSources = sources.length === 1 && Array.isArray(sources[0]) ? sources[0] : sources;

    // No sources: complete without emitting (RxJS forkJoin returns EMPTY for
    // an empty source list rather than emitting `[]`).
    if (normalizedSources.length === 0) return;

    const results = new Array(normalizedSources.length);
    const hasValue = new Array(normalizedSources.length).fill(false);
    const iterators = normalizedSources.map((source: any) =>
      toAsyncIterable(source as PipeInput<R[number]>)[Symbol.asyncIterator]() as AsyncIterator<R[number]>
    );

    const coordinator = createAsyncCoordinator<R[number]>(iterators);
    let completedCount = 0;

    try {
      while (completedCount < iterators.length) {
        const next = await coordinator.next();
        if (next.done) break;

        const event = next.value;
        if (event.type === "error") {
          throw normalizeError(event.error);
        }

        if (event.type === "value") {
          hasValue[event.sourceIndex] = true;
          results[event.sourceIndex] = event.value;
          continue;
        }

        completedCount++;
        if (!hasValue[event.sourceIndex]) {
          throw new Error(`forkJoin: source at index ${event.sourceIndex} completed without emitting any value`);
        }
      }

      yield results as unknown as R;
    } finally {
      await coordinator.return?.();
    }
  });
}
