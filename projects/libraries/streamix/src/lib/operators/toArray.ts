import { createOperator, DONE, NEXT, type Operator } from "../atoms";

/**
 * Collects all emitted values from the source stream into an array
 * and emits that array once the source completes, tracking pending state.
 *
 * @template T The type of the values in the source stream.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export const toArray = <T = any>() =>
  createOperator<T, T[]>("toArray", function (this: Operator, source) {
    const collected: T[] = [];
    let completed = false;
    let emitted = false;

    return {
      next: async function (): Promise<IteratorResult<T[]>> {
        if (completed && emitted) {
          return DONE;
        }

        while (true) {
          const result = await source.next();
          if (result.done) {
            completed = true;
            if (!emitted) {
              emitted = true;
              return NEXT(collected);
            }
            return DONE;
          }

          collected.push(result.value);
          // continue consuming values
        }
      },
    };
  });
