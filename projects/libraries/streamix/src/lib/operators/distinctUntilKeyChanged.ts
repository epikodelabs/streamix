import { createOperator, DROPPED, isPromiseLike, type MaybePromise, NEXT, type Operator } from '../abstractions';

/**
 * Creates a stream operator that filters out consecutive values from the source
 * stream if a specified key's value has not changed.
 *
 * This operator is a specialized version of `distinctUntilChanged`. It checks for
 * uniqueness based on the value of a single property (`key`). Consecutive values
 * where the key has not changed are yielded with `dropped: true` so that backpressure
 * is released and downstream operators can observe suppressed emissions.
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
        const result = await source.next();
        if (result.done) return result;

        // Propagate dropped results from upstream unchanged.
        if ((result as any).dropped) return result as any;

        const current = result.value;
        const currentKey = await getKey();

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

        // Key value unchanged — yield as dropped so backpressure is released.
        return DROPPED(current);
      }
    };
  });
