import { createOperator, NEXT, type Operator } from "../atoms";

/**
 * Creates a stream operator that emits pairs of values from the source stream,
 * where each pair consists of the current and the previous value.
 *
 * This operator is a powerful tool for comparing consecutive values in a stream.
 * It maintains an internal state to remember the last value it received. For
 * each new value, it creates a tuple of `[current, previous]` and
 * emits it to the output stream.
 *
 * The very first value emitted will have `undefined` as its "previous" value.
 *
 * @template T The type of the values in the source stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method,
 * emitting tuples of `[T, T | undefined]`.
 */
export const slidingPair = <T = any>() =>
  createOperator<T, [T, T | undefined]>('slidingPair', function (this: Operator, source) {
    let prev: T | undefined = undefined;
    let first = true;

    return {
      next: async (): Promise<IteratorResult<[T, T | undefined]>> => {
        const result = await source.next();
        if (result.done) {
          return result;
        }
        const value: [T, T | undefined] = [result.value, first ? undefined : prev];
        prev = result.value;
        first = false;
        return NEXT(value);
      }
    };
  });
