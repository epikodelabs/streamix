import { createStream, type Stream } from '../abstractions';
import { fromAny } from '../converters';
import { createAsyncCoordinator, normalizeError } from '../utils';

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
    const runner = createAsyncCoordinator<T[number]>(iterators);
    const queues = sources.map(() => [] as T[number][]);
    const completed = new Set<number>();

    const canEmitTuple = () => queues.every(queue => queue.length > 0);
    const cannotEmitMore = () =>
      queues.some((queue, index) => completed.has(index) && queue.length === 0);

    try {
      while (true) {
        if (cannotEmitMore()) break;

        const result = await runner.next();
        if (result.done) break;

        const event = result.value;

        if (event.type === 'error') {
          throw normalizeError(event.error);
        }

        if (event.type === 'complete') {
          completed.add(event.sourceIndex);
        } else {
          queues[event.sourceIndex].push(event.value);
        }

        while (canEmitTuple()) {
          yield queues.map(queue => queue.shift()!) as unknown as T;
          if (cannotEmitMore()) {
            break;
          }
        }

        if (cannotEmitMore()) {
          break;
        }
      }
    } finally {
      await runner.return?.();
    }
  };

  return createStream<T>('zip', gen);
}
