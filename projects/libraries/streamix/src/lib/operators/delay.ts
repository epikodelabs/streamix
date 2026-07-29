import { createPushOperator } from "../atoms";
import { normalizeError } from "../atoms";

/**
 * Creates a stream operator that delays the emission of each value from the source stream.
 *
 * Each value received from the source is held for the specified duration before
 * being emitted downstream.
 *
 * @template T The type of the values in the source and output streams.
 * @param ms The time in milliseconds to delay each value.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export function delay<T = any>(ms: number) {
  return createPushOperator<T>('delay', (source, output) => {
    void (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (result.done) break;

          if (ms !== undefined) {
            await new Promise((resolve) => setTimeout(resolve, ms));
          }

          output.push(result.value!);
        }
      } catch (err) {
        output.fail(normalizeError(err));
      } finally {
        if (!output.disposed) output.dispose();
      }
    })();

    return () => {};
  });
}
