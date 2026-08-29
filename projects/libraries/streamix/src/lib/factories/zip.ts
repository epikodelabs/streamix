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

    // Per-source FIFO buffers: a source may emit several values while its
    // partners have not emitted yet; those values must be retained and paired
    // in order rather than discarded.
    const buffers: T[number][][] = iterators.map(() => []);
    const done = iterators.map(() => false);

    try {
      outer: while (true) {
        // Wait until every source has a buffered value, or a completed source
        // drains its buffer (which ends the zip: it can no longer be paired).
        while (!buffers.every(buffer => buffer.length > 0)) {
          if (done.some((isDone, i) => isDone && buffers[i].length === 0)) {
            break outer;
          }

          const result = await runner.next();
          if (result.done) {
            break outer;
          }

          const event = result.value;
          if (event.type === 'error') {
            throw normalizeError(event.error);
          }
          if (event.type === 'complete') {
            done[event.sourceIndex] = true;
            continue;
          }

          buffers[event.sourceIndex].push(event.value);
        }

        yield buffers.map(buffer => buffer.shift()) as unknown as T;
      }
    } finally {
      await runner.return?.();
    }
  });
}
