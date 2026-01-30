import { createOperator, DONE, NEXT, type Operator } from "@epikodelabs/streamix";

/**
 * Creates a stream operator that counts the number of items emitted by the source stream.
 *
 * This operator consumes every value from the source without emitting until the
 * upstream completes. After the source finishes, it emits exactly one number:
 * the total count of consumed values (zero if nothing arrived), and then the
 * operator completes.
 *
 * @template T The type of the values in the source stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const count = <T = any>() =>
  createOperator<T, number>("count", function(this: Operator, source) {
    let counted = false;
    let total = 0;

    return {
      async next(): Promise<IteratorResult<number>> {
        if (counted) return DONE;

        while (true) {
          const result = await source.next();
          if (result.done) break;

          total++;
        }

        counted = true;
        return NEXT(total);
      },
    };
  });
