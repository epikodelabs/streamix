import { createStream, type Stream } from '../abstractions';

/**
 * Creates an empty stream that emits no values and completes immediately.
 *
 * @template T The type of the stream's values (will never be emitted).
 * @returns {Stream<T>} An empty stream.
 */
export const empty = <T = any>(): Stream<T> => {
  const stream = createStream<T>('EMPTY', async function* (this: Stream<T>): AsyncGenerator<T> {
    // No emissions, just complete immediately
  });

  return Object.assign(stream, { completed: () => true });
};

/**
 * A singleton instance of an empty stream.
 *
 * This constant provides a reusable, empty stream that immediately completes
 * upon subscription without emitting any values. It is useful in stream
 * compositions as a placeholder or to represent a sequence with no elements.
 */
export const EMPTY = empty();
