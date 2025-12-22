import { createOperator, type MaybePromise, NEXT, type Operator, isPromiseLike } from '../abstractions';

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
 * @template T The type of the values in the stream.
 * @param predicateOrValue The filtering criterion. Can be a predicate function, a single value, or an array of values.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const filter = <T = any>(
  predicateOrValue: ((value: T, index: number) => MaybePromise<boolean>) | T | T[]
) =>
  createOperator<T, T>('filter', function (this: Operator, source) {
    let index = 0;

    return {
      next: async () => {
        while (true) {
          const result = await source.next();
          if (result.done) return result;

          const value = result.value;
          let shouldInclude = false;

          if (typeof predicateOrValue === 'function') {
            const predicateResult = (predicateOrValue as (value: T, index: number) => MaybePromise<boolean>)(value, index);
            shouldInclude = isPromiseLike(predicateResult) ? await predicateResult : predicateResult;
          } else if (Array.isArray(predicateOrValue)) {
            shouldInclude = predicateOrValue.includes(value);
          } else {
            shouldInclude = value === predicateOrValue;
          }

          if (shouldInclude) {
            index++; // Increment index only if included
            // If the value passes the filter, return it as a normal IteratorResult.
            return NEXT(value);
          }
        }
      }
    };
  });
