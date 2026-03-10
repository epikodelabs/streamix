import { createOperator, DONE, DROPPED, isPromiseLike, type MaybePromise, NEXT, type Operator } from '../abstractions';

/**
 * Creates a stream operator that emits values from the source stream only if
 * they are different from the previous value.
 *
 * Consecutive duplicate values are yielded with `dropped: true` so that
 * backpressure is released and downstream operators can observe the suppressed
 * emissions without treating them as real values.
 *
 * @template T The type of the values in the stream.
 * @param comparator An optional function that compares the previous and current values.
 * It should return `true` if they are considered the same, and `false` otherwise.
 * If not provided, a strict equality check (`===`) is used.
 * @returns An `Operator<T, T>` instance that can be used in a stream's `pipe` method.
 */
export const distinctUntilChanged = <T = any>(
  comparator?: (prev: T, curr: T) => MaybePromise<boolean>
): Operator<T, T> =>
  createOperator<T, T>('distinctUntilChanged', function (this: Operator, source) {
    let lastValue: T | undefined;
    let hasLast = false;

    return {
      next: async () => {
        const result = await source.next();

        if (result.done) return DONE;
        if ((result as any).dropped) return result as any;

        if (!hasLast) {
          lastValue = result.value;
          hasLast = true;
          return NEXT(result.value);
        }

        const comparison = comparator ? comparator(lastValue!, result.value) : (lastValue === result.value);
        const isSame = comparator
          ? (isPromiseLike(comparison) ? await comparison : comparison)
          : comparison;

        if (!isSame) {
          lastValue = result.value;
          hasLast = true;
          return NEXT(result.value);
        }

        return DROPPED(result.value);
      },
    };
  });
