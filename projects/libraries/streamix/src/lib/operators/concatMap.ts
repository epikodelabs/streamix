import { __streamixBeginLifetime, type StreamixLifetimeSpan } from '../runtime/introspection-hooks';
import { createOperator, DONE, type MaybePromise, NEXT, type Operator } from "../atoms";
import type { PipeInput } from "../atoms/pipe";
import { from } from "../factories";
import { normalizeError } from "../atoms";
import { SerialInnerExecution } from "../runtime/serial-inner-execution";
import { prepareProjection } from "../runtime/projected-inner";

/**
 * Creates a stream operator that maps each value from the source stream to a new
 * inner stream (or value/array/promise) and flattens all inner streams sequentially.
 *
 * For each value from the source:
 * 1. The `project` function is called with the value and its index.
 * 2. The returned value is normalized into a stream using {@link from}.
 * 3. The inner stream is consumed fully before processing the next outer value.
 *
 * This ensures that all emitted values maintain their original sequential order.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the inner streams and the output.
 * @param project A function that takes a value from the source stream and its index,
 * and returns either:
 *   - an {@link Readable | Readable<R>},
 *   - a {@link MaybePromise<R>},
 *   - or an array of `R`.
 * @returns An {@link Operator} instance that can be used in a stream's `pipe` method.
 */
export const concatMap = <T = any, R = any>(
  project: (value: T, index: number) => MaybePromise<PipeInput<R>>
) =>
  createOperator<T, R>("concatMap", function (this : Operator, source) {
    let outerIndex = 0;
    const operator = this;
    let lifetime: StreamixLifetimeSpan | undefined;
    const inner = new SerialInnerExecution<R>();

    const iterator: AsyncIterator<R> = {
      next: async () => {
        try {
          while (true) {
            if (inner.stopped) return DONE;
            // If no active inner iterator, pull the next outer value
            if (!inner.active) {
              const result = await source.next();
              if (inner.stopped) return DONE;

              if (result.done) return DONE;

              lifetime = __streamixBeginLifetime(operator);
              lifetime?.start();
              prepareProjection(inner.disposal, () => project(result.value, outerIndex++), projected => {
                if (inner.stopped) return false;
                inner.attach(from<R>(projected)[Symbol.asyncIterator]());
                return true;
              });
            }

            // Pull next value from inner stream
            const innerResult = await inner.next();
            if (inner.stopped) return DONE;

            if (innerResult.done) {
              lifetime?.finish('complete');

              // Otherwise continue to next outer value
              continue;
            }

            lifetime?.output();
            return NEXT(innerResult.value);
          }
        } catch (error) { lifetime?.finish('error'); throw error; }
      },

      async return(_value?: any) {
        lifetime?.finish('cancel');
        await inner.close(source);
        return DONE;
      },

      async throw(err: any) {
        lifetime?.finish('error');
        const error = normalizeError(err);
        await inner.close(source);
        throw error;
      }
    };

    return iterator;
  });
