import { createOperator, DONE, isPromiseLike, type MaybePromise, NEXT, type Operator } from '@epikodelabs/streamix';

/**
 * Creates a stream operator that emits the maximum value from the source stream.
 *
 * This terminal operator consumes every downstream value, retains the current maximum
 * as data flows through, and waits for the source to complete before emitting the winner.
 * A comparator can be provided to override the default `>` comparison; asynchronous comparators
 * are supported because they are awaited internally.
 * The operator emits once with the maximum value (if any values were provided) and then completes.
 * For empty sources it returns `DONE` without emitting.
 *
 * @template T The type of the values in the source stream.
 * @param comparator Optional comparison function: positive if `a > b`, negative if `a < b`.
 * @returns An `Operator` instance usable in a stream's `pipe` method.
 */
export const max = <T = any>(
  comparator?: (a: T, b: T) => MaybePromise<number>
) =>
  createOperator<T, T>("max", function (this: Operator, source) {
    let maxValue: T | undefined;
    let hasMax = false;
    let emittedMax = false;

    return {
      next: async () => {
        while (true) {
          // If all values processed, emit max once and complete
          if (emittedMax && !hasMax) return DONE;
          if (emittedMax && hasMax) {
            emittedMax = true;
            return DONE;
          }

          const result = await source.next();

          if (result.done) {
            // Emit final max if exists
            if (hasMax && !emittedMax) {
              emittedMax = true;
              return NEXT(maxValue!);
            }
            return DONE;
          }

          const value = result.value;

          if (!hasMax) {
            maxValue = value;
            hasMax = true;
            continue;
          }

          const cmpResult = comparator ? comparator(value, maxValue!) : (value > maxValue! ? 1 : -1);
          const cmp = isPromiseLike(cmpResult) ? await cmpResult : cmpResult;

          if (cmp > 0) {
            // previous max becomes phantom
            maxValue = value;
          }
        }
      },
    };
  });
