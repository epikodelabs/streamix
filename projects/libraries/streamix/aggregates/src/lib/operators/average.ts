import { createOperator, DONE, isPromiseLike, type MaybePromise, NEXT, type Operator } from "@epikodelabs/streamix";

/**
 * Creates a stream operator that computes the arithmetic mean of values from the source stream.
 *
 * The operator consumes every value, optionally maps it through the provided `selector`,
 * keeps running totals and counts, and emits the average once the source stream completes.
 * When the source produces no values, it still completes and emits `0`.
 *
 * @template T The type of the values in the source stream.
 * @param selector Optional function that projects each value to a number; it receives the value and its index
 * and may return a promise. Defaults to interpreting the value itself as a number.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method. The operator emits exactly
 * one numeric value before completing every subscription.
 */
export const average = <T = any>(
  selector: (value: T, index: number) => MaybePromise<number> = (value) => value as unknown as number
) =>
  createOperator<T, number>("average", function (this: Operator, source) {
    let total = 0;
    let count = 0;
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
          count++;
        }

        emitted = true;
        const averageValue = count === 0 ? 0 : total / count;
        return NEXT(averageValue);
      },
    };
  });
