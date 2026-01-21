import { createOperator, DONE, isPromiseLike, type MaybePromise, NEXT, type Operator } from "@epikodelabs/streamix";

/**
 * Creates a stream operator that tests if no values from the source stream satisfy a predicate.
 *
 * This operator consumes the stream and applies the provided `predicate` to each value.
 * - If the predicate returns truthy for any element, the operator immediately emits `false`
 *   and completes, short-circuiting the evaluation.
 * - If the source completes without the predicate ever returning truthy, the operator emits `true`.
 *
 * It mirrors `Array.prototype.every` with the predicate inverted and emits a single boolean value.
 * Empty streams also emit `true`.
 *
 * @template T The type of the values in the source stream.
 * @param predicate Function to test each value. It receives the value and its index, and it can be synchronous or async.
 * @returns An `Operator` instance usable in a stream's `pipe` method.
 */
export const none = <T = any>(
  predicate: (value: T, index: number) => MaybePromise<boolean>
) =>
  createOperator<T, boolean>("none", function (this: Operator, source) {
    let evaluated = false;
    let index = 0;

    return {
      async next() {
        if (evaluated) return DONE;

        let matched = false;

        try {
          while (true) {
            const result = await source.next();

            if (result.done) break;

            const predicateResult = predicate(result.value, index++);
            const passes = isPromiseLike(predicateResult) ? await predicateResult : predicateResult;

            if (passes) {
              matched = true;
              break;
            }
          }
        } finally {
          evaluated = true;
        }

        return NEXT(!matched);
      },
    };
  });
