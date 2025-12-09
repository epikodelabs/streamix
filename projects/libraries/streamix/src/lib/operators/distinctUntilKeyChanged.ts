import { createOperator, MaybePromise, NEXT, Operator, isPromiseLike } from '../abstractions';

/**
 * Creates a stream operator that filters out consecutive values from the source
 * stream if a specified key's value has not changed.
 *
 * This operator is a specialized version of `distinctUntilChanged`. It is designed
 * to work with streams of objects and checks for uniqueness based on the value
 * of a single property (`key`).
 *
 * @template T The type of the objects in the stream. Must extend `object`.
 * @param key The name of the property to check for changes.
 * @param comparator An optional function to compare the previous and current values of the `key`.
 * It should return `true` if the values are considered the same. If not provided,
 * strict inequality (`!==`) is used.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const distinctUntilKeyChanged = <T extends object = any, K extends keyof T = keyof T>(
  key: MaybePromise<K>,
  comparator?: (prev: T[K], curr: T[K]) => MaybePromise<boolean>
): Operator<T, T> =>
  createOperator<T, T>('distinctUntilKeyChanged', function (this: Operator, source) {
    let lastValue: T | undefined;
    let isFirst = true;
    let resolvedKey: K | undefined;

    const getKey = async () => {
      if (resolvedKey === undefined) {
        resolvedKey = isPromiseLike(key) ? await key : key;
      }
      return resolvedKey;
    };

    return {
      next: async () => {
        while (true) {
          const result = await source.next();
          if (result.done) return result;

          const current = result.value;
          const currentKey = await getKey();

          if (isFirst) {
            isFirst = false;
            lastValue = current;
            return NEXT(current);
          }

          const comparison = comparator
            ? comparator(lastValue![currentKey], current[currentKey])
            : lastValue![currentKey] === current[currentKey];
          const isSame = comparator
            ? (isPromiseLike(comparison) ? await comparison : comparison)
            : comparison;
          const isDistinct = !isSame;

          isFirst = false;

          if (isDistinct) {
            lastValue = current;
            return NEXT(current);
          }
        }
      }
    };
  });
