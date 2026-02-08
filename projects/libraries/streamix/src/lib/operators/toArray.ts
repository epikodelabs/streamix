import { createOperator, DONE, getIteratorMeta, NEXT, tagValue, type Operator } from "../abstractions";

/**
 * Collects all emitted values from the source stream into an array
 * and emits that array once the source completes, tracking pending state.
 *
 * @template T The type of the values in the source stream.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export const toArray = <T = any>() =>
  createOperator<T, T[]>("toArray", function (this: Operator, source) {
    const collected: IteratorResult<T>[] = [];
    const collectedMeta:
      | ({ valueId: string; operatorIndex: number; operatorName: string } | undefined)[] = [];
    let completed = false;
    let emitted = false;

    return {
      next: async function () {
        while (true) {
          // All done and final array emitted → complete
          if (completed && emitted) {
            return DONE;
          }

          const result = await source.next();

            if (result.done) {
              completed = true;
              if (!emitted) {
                emitted = true;
                const metas = collectedMeta.filter(Boolean) as { valueId: string; operatorIndex: number; operatorName: string }[];
                const lastMeta = metas[metas.length - 1];
                const values = tagValue(this as any, collected.map((r) => r.value!), lastMeta, {
                  kind: "collapse",
                  inputValueIds: metas.map((m) => m.valueId),
                });
                // Emit the final array of values
                return NEXT(values);
              }
              continue;
            }

          collected.push(result);
          collectedMeta.push(getIteratorMeta(source));
        }
      },
    };
  });
