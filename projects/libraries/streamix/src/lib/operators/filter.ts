import { createOperator, DONE, isPromiseLike, type MaybePromise, NEXT, type Operator } from "../atoms";

/**
 * Creates a stream operator that filters values emitted by the source stream.
 *
 * This operator provides flexible filtering capabilities. It processes each value
 * from the source stream and passes it through to the output stream only if it meets
 * a specific criterion.
 *
 * The filtering can be configured in one of three ways:
 * - A **predicate function**: A function that returns `true` for values to be included.
 * - A **single value**: Only values that are strictly equal (`===`) to this value are included.
 * - An **array of values**: Only values that are present in this array are included.
 *
 * Values that do not pass the filter are yielded with `dropped: true` so that
 * backpressure is released and downstream operators can observe suppressed emissions.
 *
 * @template T The type of the values in the stream.
 * @param predicateOrValue The filtering criterion. Can be a predicate function, a single value, or an array of values.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export function filter<T>(
  predicateOrValue: (value: T, index: number) => MaybePromise<boolean>
): Operator<T, T>;
export function filter<T>(predicateOrValue: T): Operator<T, T>;
export function filter<T>(predicateOrValue: T[]): Operator<T, T>;
export function filter<T = any>(
  predicateOrValue: ((value: T, index: number) => MaybePromise<boolean>) | T | T[]
) {
  return createOperator<T, T>('filter', function (this: Operator, source) {
    let index = 0;

    return {
      next: async () => {
        while (true) {
          const result = await source.next();
          if (result.done) return DONE;

          const value = result.value;
          const currentIndex = index++;
          let shouldInclude = false;

          if (typeof predicateOrValue === 'function') {
            const predicateResult = (predicateOrValue as (value: T, index: number) => MaybePromise<boolean>)(value, currentIndex);
            shouldInclude = isPromiseLike(predicateResult) ? await predicateResult : predicateResult;
          } else if (Array.isArray(predicateOrValue)) {
            shouldInclude = predicateOrValue.includes(value);
          } else {
            shouldInclude = value === predicateOrValue;
          }

          if (shouldInclude) {
            return NEXT(value);
          }

          // value should be dropped, continue loop
        }
      }
    };
  });
}
