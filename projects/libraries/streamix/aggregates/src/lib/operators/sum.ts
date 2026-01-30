import { createOperator, DONE, isPromiseLike, type MaybePromise, NEXT, type Operator } from "@epikodelabs/streamix";

/**
 * Creates a stream operator that sums values from the source stream.
 *
 * The operator consumes every value, optionally transforms it through the provided `selector`,
 * and accumulates the sum. After the source completes, it emits the final total and completes.
 * When there are no values, it emits `0`.
 *
 * @template T The type of the values in the source stream.
 * @param selector Optional function that maps each value into a number. It receives the value and its index,
 * and can be synchronous or asynchronous. Defaults to treating each value as a number directly.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const sum = <T = any>(
  selector: (value: T, index: number) => MaybePromise<number> = (value) => value as unknown as number
) =>
  createOperator<T, number>("sum", function (this: Operator, source) {
    let total = 0;
    let index = 0;
    let emitted = false;

    return {
      async next() {
        if (emitted) return DONE;

        while (true) {
          const result = await source.next();

          if (result.done) break;

          const selected = selector(result.value, index++);
          const value = isPromiseLike(selected) ? await selected : selected;
          total += value;
        }

        emitted = true;
        return NEXT(total);
      },
    };
  });
