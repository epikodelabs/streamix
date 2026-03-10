import { createOperator, DONE, DROPPED, isPromiseLike, type MaybePromise, NEXT, type Operator } from '../abstractions';

/**
 * Creates a stream operator that skips values from the source stream while a predicate returns true.
 *
 * Values skipped while the predicate holds are yielded with `dropped: true` so that
 * backpressure is released and downstream operators can observe suppressed emissions.
 * As soon as the predicate returns `false` for the first time, this operator emits
 * that value and all subsequent values normally.
 *
 * @template T The type of the values in the source and output streams.
 * @param predicate The function to test each value. Receives the value and its index. `true` means to continue skipping,
 * and `false` means to stop skipping and begin emitting.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const skipWhile = <T = any>(
  predicate: (value: T, index: number) => MaybePromise<boolean>
) =>
  createOperator<T, T>('skipWhile', function (this: Operator, source) {
    let skipping = true;
    let index = 0;

    return {
      next: async () => {
        const result = await source.next();

        if (result.done) return DONE;
        if ((result as any).dropped) return result as any;

        if (skipping) {
          const predicateResult = predicate(result.value, index++);
          const shouldSkip = isPromiseLike(predicateResult) ? await predicateResult : predicateResult;
          if (!shouldSkip) {
            skipping = false;
            return NEXT(result.value);
          }
          return DROPPED(result.value);
        }

        index++;
        return NEXT(result.value);
      }
    };
  });
