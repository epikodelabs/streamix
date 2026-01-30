import { createOperator, DONE, isPromiseLike, type MaybePromise, NEXT, type Operator } from '@epikodelabs/streamix';

/**
 * Creates a stream operator that emits the smallest value produced by the source stream.
 *
 * This terminal operator consumes every value, retaining the minimum seen so far as the stream progresses.
 * A comparator may be provided to customize how values are ordered (asynchronous comparators are supported).
 * Once the source completes, the minimum is emitted exactly once; empty sources result in `DONE` without emission.
 *
 * @template T The type of the values in the source stream.
 * @param comparator Optional comparison function. It should return a negative number when `a < b`, zero when equal,
 * and a positive number when `a > b`. Defaults to the `<` operator.
 * @returns An `Operator` instance usable in a stream's `pipe` method.
 */
export const min = <T = any>(
  comparator?: (a: T, b: T) => MaybePromise<number>
) =>
  createOperator<T, T>("min", function (this: Operator, source) {
    let minValue: T | undefined;
    let hasMin = false;
    let emittedMin = false;

    return {
      next: async () => {
        while (true) {
          const result = await source.next();

          if (result.done) {
            // Emit the final minimum once
            if (hasMin && !emittedMin) {
              emittedMin = true;
              return NEXT(minValue!);
            }
            return DONE;
          }

          const value = result.value;

          if (!hasMin) {
            minValue = value;
            hasMin = true;
            continue;
          }

          const cmpResult = comparator ? comparator(value, minValue!) : (value < minValue! ? -1 : 1);
          const cmp = isPromiseLike(cmpResult) ? await cmpResult : cmpResult;

          if (cmp < 0) {
            minValue = value;
          }
        }
      },
    };
  });
