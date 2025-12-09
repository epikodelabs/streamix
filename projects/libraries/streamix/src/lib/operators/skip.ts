import { createOperator, DONE, MaybePromise, NEXT, Operator, isPromiseLike } from '../abstractions';

/**
 * Creates a stream operator that skips the first specified number of values from the source stream.
 *
 * This operator is useful for "fast-forwarding" a stream. It consumes the initial `count` values
 * from the source stream without emitting them to the output. Once the count is reached,
 * it begins to pass all subsequent values through unchanged.
 *
 * @template T The type of the values in the source and output streams.
 * @param count The number of values to skip from the beginning of the stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const skip = <T = any>(count: MaybePromise<number>) =>
  createOperator<T, T>('skip', function (this: Operator, source) {
    let counter: number | undefined;
    const getCounter = (): MaybePromise<number> => {
      if (counter !== undefined) {
        return counter;
      }
      if (isPromiseLike(count)) {
        return count.then((val) => {
          counter = val;
          return val;
        });
      }
      counter = count;
      return counter;
    };

    return {
      next: async () => {
        while (true) {
          const result = await source.next();
          if (result.done) return DONE;

          const counterOrPromise = getCounter();
          const currentCounter = isPromiseLike(counterOrPromise) ? await counterOrPromise : counterOrPromise;
          if (currentCounter > 0) {
            counter = currentCounter - 1;
            continue;
          }

          return NEXT(result.value);
        }
      },
    };
  });
