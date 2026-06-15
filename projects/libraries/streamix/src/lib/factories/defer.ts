import { flow, type AtomBase } from '../atoms/atom';
import { toAsyncIterable, type PipeInput } from '../atoms/pipe';

/**
 * Creates an atom that defers the creation of an inner stream until it is
 * subscribed to.
 *
 * This operator ensures that the `factory` function is called only when
 * a consumer subscribes to the atom, making it a good choice for
 * creating "cold" atoms. Each new subscription will trigger a new
 * call to the `factory` and create a fresh stream instance.
 *
 * @template T The type of the values in the inner stream.
 * @param factory A function that returns the source to be subscribed to.
 * @returns {AtomBase<T>} A new atom that defers subscription to the inner stream.
 */
export function defer<T = any>(factory: () => PipeInput<T>): AtomBase<T> {
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
