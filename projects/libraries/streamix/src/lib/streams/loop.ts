import { createStream, isPromiseLike, type MaybePromise, type Stream } from '../abstractions';

/**
 * Creates a stream that emits values in a loop based on a condition and an
 * iteration function.
 *
 * This operator is useful for generating a sequence of values until a specific
 * condition is no longer met. It starts with an `initialValue` and, for each
 * iteration, it yields the current value and then uses `iterateFn` to
 * calculate the next value in the sequence.
 *
 * @template T The type of the values in the stream.
 * @param {MaybePromise<T>} initialValue The starting value for the loop.
 * @param {(value: T) => MaybePromise<boolean>} condition A function that returns `true` to continue the loop and `false` to stop.
 * @param {(value: T) => MaybePromise<T>} iterateFn A function that returns the next value in the sequence.
 * @returns {Stream<T>} A stream that emits the generated sequence of values.
 */
export function loop<T = any>(
  initialValue: MaybePromise<T>,
  condition: (value: T) => MaybePromise<boolean>,
  iterateFn: (value: T) => MaybePromise<T>
): Stream<T> {
  return createStream<T>(
    'loop',
    async function* (signal: AbortSignal): AsyncGenerator<T, void, unknown> {
      let currentValue = isPromiseLike(initialValue) ? await initialValue : initialValue;
      while (true) {
        if (signal.aborted) break;
        const shouldContinue = condition(currentValue);
        const continueValue = isPromiseLike(shouldContinue) ? await shouldContinue : shouldContinue;
        if (!continueValue) break;
        yield currentValue;
        await Promise.resolve();
        if (signal.aborted) break;
        const nextValue = iterateFn(currentValue);
        currentValue = isPromiseLike(nextValue) ? await nextValue : nextValue;
      }
    }
  );
}
