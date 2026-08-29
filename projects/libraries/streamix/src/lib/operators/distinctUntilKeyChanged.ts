import { createOperator, DONE, isPromiseLike, type MaybePromise, NEXT, type Operator } from "../atoms";

/**
 * Creates a stream operator that filters out consecutive values from the source
 * stream if a specified key's value has not changed.
 *
 * This operator is a specialized version of `distinctUntilChanged`. It checks for
 * uniqueness based on the value of a single property (`key`). Consecutive values
 * where the key has not changed are simply not emitted downstream.
 *
 * @template T The type of the objects in the stream. Must extend `object`.
 * @template K The key of the property to check for changes.
 * @param key The name of the property to check for changes.
 * @param comparator An optional function to compare the previous and current values of the `key`.
 * It should return `true` if the values are considered the same. If not provided,
 * strict inequality (`!==`) is used.
 * @returns An `Operator<T, T>` instance that can be used in a stream's `pipe` method.
 */
export const distinctUntilKeyChanged = <T extends object = any, K extends keyof T = keyof T>(
  key: K,
  comparator?: (prev: T[K], curr: T[K]) => MaybePromise<boolean>
): Operator<T, T> =>
  createOperator<T, T>('distinctUntilKeyChanged', function (this: Operator, source) {
    let lastValue: T | undefined;
    let isFirst = true;

    return {
      next: async () => {
        while (true) {
          const result = await source.next();
          if (result.done) return DONE;

          const current = result.value;
          const currentKey = key;

          if (isFirst) {
            isFirst = false;
            lastValue = current;
            return NEXT(current);
          }

          const prevKey = lastValue![currentKey];
          const currKey = current[currentKey];
          let isSame: boolean;
          if (comparator) {
            const comparison = comparator(prevKey, currKey);
            isSame = isPromiseLike(comparison) ? await comparison : comparison;
          } else {
            isSame = prevKey === currKey;
          }

          if (!isSame) {
            lastValue = current;
            return NEXT(current);
          }

          // duplicate found, continue loop
        }
      }
    };
  });
