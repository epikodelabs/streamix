import { createStream, isPromiseLike, MaybePromise, Stream } from '../abstractions';

/**
 * Creates a stream that emits a sequence of numbers, starting from `start`,
 * incrementing by `step`, and emitting a total of `count` values.
 *
 * This operator is a powerful way to generate a numerical sequence in a
 * reactive context. It's similar to a standard `for` loop but produces
 * values as a stream. It's built upon the `loop` operator for its
 * underlying logic.
 *
 * @param {MaybePromise<number>} start - The first number to emit in the sequence.
 * @param {MaybePromise<number>} count - The total number of values to emit. Must be a non-negative number.
 * @param {MaybePromise<number>} [step=1] - The amount to increment or decrement the value in each step.
 * @returns {Stream<number>} A stream that emits a sequence of numbers.
 */
export function range(start: MaybePromise<number>, count: MaybePromise<number>, step: MaybePromise<number> = 1): Stream<number> {
  return createStream<number>('range', async function* () {
    const resolvedStart = isPromiseLike(start) ? await start : start;
    const resolvedCount = isPromiseLike(count) ? await count : count;
    const resolvedStep = isPromiseLike(step) ? await step : step;
    const end = resolvedStart + resolvedCount * resolvedStep;

    let current = resolvedStart;
    while (resolvedStep > 0 ? current < end : current > end) {
      yield current;
      current += resolvedStep;
    }
  });
}
