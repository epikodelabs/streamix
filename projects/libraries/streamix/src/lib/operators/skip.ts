import { createOperator, DONE, DROPPED, type MaybePromise, NEXT, type Operator, isPromiseLike } from '../abstractions';

/**
 * Creates a stream operator that skips the first specified number of values from the source stream.
 *
 * This operator is useful for "fast-forwarding" a stream. It consumes the initial `count` values
 * from the source stream without emitting them to the output. Once the count is reached,
 * it begins to pass all subsequent values through unchanged.
 *
 * Skipped values are yielded with `dropped: true` so that backpressure is released and
 * downstream operators can observe the suppressed emissions.
 *
 * @template T The type of the values in the source and output streams.
 * @param count The number of values to skip from the beginning of the stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const skip = <T = any>(count: MaybePromise<number>) =>
  createOperator<T, T>('skip', function (this: Operator, source) {
    let remaining: number | undefined;
    const getRemaining = (): MaybePromise<number> => {
      if (remaining !== undefined) {
        return remaining;
      }
      if (isPromiseLike(count)) {
        return count.then((val) => {
          remaining = val;
          return val;
        });
      }
      remaining = count;
      return remaining;
    };

    return {
      next: async () => {
        const result = await source.next();
        if (result.done) return DONE;

        if ((result as any).dropped) return result as any;

        const remainingOrPromise = getRemaining();
        const currentRemaining = isPromiseLike(remainingOrPromise) ? await remainingOrPromise : remainingOrPromise;
        if (currentRemaining > 0) {
          remaining = currentRemaining - 1;
          return DROPPED(result.value);
        }

        return NEXT(result.value);
      },
    };
  });
