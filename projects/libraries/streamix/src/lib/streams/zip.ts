import { createStream, type Stream } from '../abstractions';
import { fromAny } from '../converters';
import { normalizeError } from '../utils/helpers';

/**
 * Combine multiple streams into a single stream that emits arrays of the latest values
 * from each input stream whenever any input emits. Emission occurs only when all inputs
 * have emitted at least once.
 *
 * @template T
 * @param {...Stream<T[number]>[]} sources - The input streams to zip.
 * @returns {Stream<T>} A stream emitting arrays of values from each input.
 */
export function zip<T extends readonly unknown[] = any[]>(
  ...sources: Array<Stream<T[number]> | Promise<T[number]>>
): Stream<T> {

  const gen = async function* (): AsyncGenerator<T, void, unknown> {
    if (sources.length === 0) return;

    const iterators = sources.map((source) => {
      const resolved = fromAny(source as any);
      return resolved[Symbol.asyncIterator]() as AsyncIterator<T[number]>;
    });

    try {
      while (true) {
        // Pull from all iterators; if any completes, cancel the rest immediately
        const results = await Promise.allSettled(iterators.map(it => it.next()));

        let completed = false;
        const values: T[number][] = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === 'rejected') {
            // Propagate first rejection, cancel others first
            await Promise.all(iterators.map((it, j) =>
              j !== i ? it.return?.(undefined).catch(() => { }) : Promise.resolve()
            ));
            throw normalizeError(r.reason);
          }
          if (r.value.done) {
            completed = true;
            break;
          }
          values.push(r.value.value);
        }

        if (completed) {
          // Cancel any pending iterators that haven't resolved yet
          await Promise.all(
            iterators.map(it => it.return?.(undefined).catch(() => { }))
          );
          break;
        }

        yield values as unknown as T;
      }
    } finally {
      await Promise.all(
        iterators.map(it => (typeof it.return === 'function' ? it.return(undefined).catch(() => { }) : Promise.resolve()))
      );
    }
  };

  return createStream<T>('zip', gen);
}
