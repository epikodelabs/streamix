import { isPromiseLike, type MaybePromise } from '../atoms';
import { flow, type AtomBase } from '../atoms/atom';
import { toAsyncIterable, type PipeInput } from '../atoms/pipe';

/**
 * Creates an atom that chooses between two streams based on a condition.
 *
 * The condition is evaluated lazily when the atom is subscribed to. This allows
 * for dynamic stream selection based on runtime state.
 *
 * @template T The type of the values in the streams.
 * @param condition A function that returns a boolean to determine which stream to use. It is called when the iif atom is subscribed to.
 * @param trueStream The source to use if the condition is `true`.
 * @param falseStream The source to use if the condition is `false`.
 * @returns {AtomBase<T>} A new atom that emits values from either `trueStream` or `falseStream` based on the condition.
 */
export function iif<T = any>(
  condition: () => MaybePromise<boolean>,
  trueStream: PipeInput<T>,
  falseStream: PipeInput<T>
): AtomBase<T> {
  return flow<T>(async function* generator(): AsyncGenerator<T, void, unknown> {
    // Evaluate condition lazily when the stream starts
    const conditionResult = condition();
    const resolvedCondition = isPromiseLike(conditionResult) ? await conditionResult : conditionResult;
    const chosen = resolvedCondition ? trueStream : falseStream;
    const source = toAsyncIterable(chosen);
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
