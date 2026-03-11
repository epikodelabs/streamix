import { createOperator, DONE, DROPPED, isPromiseLike, type MaybePromise, NEXT, type Operator } from '../abstractions';

/**
 * Creates a stream operator that catches errors from the source stream and handles them.
 *
 * This operator listens for errors from the upstream source. When the first error is
 * caught, it invokes a provided `handler` callback, yields a single dropped result
 * for that error, and then completes on the following pull, preventing the error
 * from propagating further down the pipeline.
 *
 * - **Error Handling:** The `handler` is executed only for the first error encountered.
 * - **Dropped Signal:** The first handled error is yielded with `dropped: true` so
 * backpressure is released and downstream operators can observe the suppressed error.
 * - **Completion:** After that dropped signal, the operator completes, terminating
 * the stream's flow.
 * - **Subsequent Errors:** Any errors after the first will be re-thrown.
 *
 * This is useful for error-handling strategies where you want to perform a specific
 * cleanup action and then gracefully terminate the stream.
 *
 * @template T The type of the values emitted by the stream.
 * @param handler The function to call when an error is caught. It can return a `void` or a `Promise<void>`.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const catchError = <T = any>(
  handler: (error: any) => MaybePromise<void> = () => {}
) =>
  createOperator<T, T>('catchError', function (this: Operator, source) {
    let errorCaughtAndHandled = false;
    let completed = false;

    return {
      next: async () => {
        if (errorCaughtAndHandled || completed) {
          return DONE;
        }

        try {
          const result = await source.next();
          if (result.done) {
            completed = true;
            return DONE;
          }

          if ((result as any).dropped) {
            return result as any;
          }

          return NEXT(result.value);
        } catch (error) {
          if (!errorCaughtAndHandled) {
            const handlerResult = handler(error);
            if (isPromiseLike(handlerResult)) await handlerResult;
            errorCaughtAndHandled = true;
            completed = true;
            return DROPPED(error as T);
          }

          throw error;
        }
      },

      async return(value?: any) {
        completed = true;
        try {
          await source.return?.(value);
        } catch {}
        return DONE;
      },

      async throw(err: any) {
        completed = true;
        try {
          await source.return?.();
        } catch {}
        throw err;
      }
    };
  });
