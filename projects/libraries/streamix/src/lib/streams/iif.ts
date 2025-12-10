import { createStream, isPromiseLike, MaybePromise, Stream } from '../abstractions';
import { eachValueFrom, fromAny } from '../converters';

/**
 * Creates a stream that chooses between two streams based on a condition.
 *
 * The condition is evaluated lazily when the stream is subscribed to. This allows
 * for dynamic stream selection based on runtime state.
 *
 * @template T The type of the values in the streams.
 * @param {() => MaybePromise<boolean>} condition A function that returns a boolean to determine which stream to use. It is called when the iif stream is subscribed to.
 * @param {Stream<T> | MaybePromise<T> | Array<T>} trueStream The stream to subscribe to if the condition is `true`.
 * @param {Stream<T> | MaybePromise<T> | Array<T>} falseStream The stream to subscribe to if the condition is `false`.
 * @returns {Stream<T>} A new stream that emits values from either `trueStream` or `falseStream` based on the condition.
 */
export function iif<T = any>(
  condition: MaybePromise<() => boolean>,
  trueStream: MaybePromise<Stream<T> | Array<T> | T>,
  falseStream: MaybePromise<Stream<T> | Array<T> | T>
): Stream<T> {
  async function* generator(): AsyncGenerator<T, void, unknown> {
    // Evaluate condition lazily when the stream starts
    const conditionFn = isPromiseLike(condition) ? await condition : condition;
    const conditionResult = conditionFn();
    const resolvedCondition = isPromiseLike(conditionResult) ? await conditionResult : conditionResult;
    const chosen = resolvedCondition ? trueStream : falseStream;
    const resolvedChosen = isPromiseLike(chosen) ? await chosen : chosen;
    const asyncIterable = eachValueFrom<T>(fromAny(resolvedChosen));
    const iterator = asyncIterable[Symbol.asyncIterator]();

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
  }

  return createStream<T>('iif', generator);
}
