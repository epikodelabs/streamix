import { createOperator, DONE, type Operator } from "../atoms";

/**
 * Creates a stream operator that throws an error with the provided message as
 * soon as the source produces a value.
 *
 * When a consumer requests a value by calling `next()`, the operator pulls the
 * source: if a value arrives, it throws an `Error` with the given `message`
 * instead of emitting; if the source completes without emitting, the operator
 * completes normally without erroring.
 *
 * This is useful for testing error handling logic in a stream pipeline or for
 * explicitly modeling a failed asynchronous operation.
 *
 * @template T The type of the values in the source stream (this is a formality, as no values are emitted).
 * @param message The error message to be thrown.
 * @returns An `Operator` instance that errors when the source emits.
 */
export const throwError = <T = any>(message: string) =>
  createOperator<T, never>('throwError', function (this: Operator, source) {

    return {
      next: async () => {
        const result = await source.next();
        if (result.done) return DONE as any;
        throw new Error(message);
      }
    };
  });
