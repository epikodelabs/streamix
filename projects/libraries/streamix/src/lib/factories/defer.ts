import { flow, type Readable } from '../atoms/atom';
import { toAsyncIterable, type PipeInput } from '../atoms/pipe';

/**
 * Creates an atom that instantiates its inner stream through a factory.
 *
 * The `factory` function is called when the flow producer is activated by a
 * subscription or scope observation. Subscribers share that producer. Source
 * completion, explicit disposal, or the last unsubscribe releases its resources.
 *
 * @template T The type of the values in the inner stream.
 * @param factory A function that returns the source to be subscribed to.
 * @returns {Readable<T>} A new atom that defers subscription to the inner stream.
 */
export function defer<T = any>(factory: () => PipeInput<T>): Readable<T> {
  return flow<T>(async function* () {
    const source = toAsyncIterable(factory());
    const iterator = source[Symbol.asyncIterator]() as AsyncIterator<T>;

    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) break;
        yield result.value;
      }
    } finally {
      // Ensure proper cleanup of the iterator
      if (iterator.return) {
        try {
          await iterator.return(undefined);
        } catch {
          // Ignore any errors during cleanup
        }
      }
    }
  });
}
