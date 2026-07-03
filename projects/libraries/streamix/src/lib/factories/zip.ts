import { normalizeError } from '../atoms';
import { flow, type Atom } from '../atoms/atom';
import { toAsyncIterable, type PipeInput } from '../atoms/pipe';
import { createAsyncCoordinator } from '../utils';

/**
 * Combine multiple sources into a single atom that emits arrays of the latest values
 * from each input source whenever any input emits. Emission occurs only when all inputs
 * have emitted at least once.
 *
 * @template T
 * @param sources - The input atoms, streams, or values (including promises) to zip.
 * @returns {Atom<T>} An atom emitting arrays of values from each input.
 */
export function zip<T extends readonly unknown[] = any[]>(
  ...sources: { [K in keyof T]: PipeInput<T[K]> }
): Atom<T> {
  return flow<T>(async function* (): AsyncGenerator<T, void, unknown> {
    if (sources.length === 0) return;

    const iterators = sources.map((source) =>
      toAsyncIterable(source)[Symbol.asyncIterator]()
    );
    const runner = createAsyncCoordinator<T[number]>(iterators);

    try {
      while (true) {
        const tuple = new Array(iterators.length);
        const seen = new Set<number>();
        let isComplete = false;

        while (seen.size < iterators.length) {
          const result = await runner.next();
          if (result.done) {
            isComplete = true;
            break;
          }

          const event = result.value;
          if (seen.has(event.sourceIndex)) continue;

          if (event.type === 'error') {
            throw normalizeError(event.error);
          }
          if (event.type === 'complete') {
            isComplete = true;
            break;
          }

          tuple[event.sourceIndex] = event.value;
          seen.add(event.sourceIndex);
        }

        if (isComplete) {
          break;
        }

        yield tuple as unknown as T;
      }
    } finally {
      await runner.return?.();
    }
  });
}
