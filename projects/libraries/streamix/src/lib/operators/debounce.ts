import { createOperator, isPromiseLike, MaybePromise, Operator } from "../abstractions";
import { eachValueFrom } from "../converters";
import { createSubject, Subject } from "../streams";

/**
 * Creates a stream operator that emits the most recent value from the source stream
 * only after a specified duration has passed without another new value.
 *
 * This version tracks pending results in the PipeContext and marks
 * superseded values as phantoms.
 *
 * @template T The type of the values in the source and output streams.
 * @param duration The debounce duration in milliseconds.
 * @returns An Operator instance for use in a stream pipeline.
 */
export function debounce<T = any>(duration: MaybePromise<number>) {
  return createOperator<T, T>("debounce", function (this: Operator, source) {
    const output: Subject<T> = createSubject<T>();
    let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined;
    let latestResult: IteratorResult<T> | undefined = undefined;
    let isCompleted = false;
    let resolvedDuration: number | undefined = undefined;

    const flush = () => {
      if (latestResult !== undefined) {
        // Emit the latest value
        output.next(latestResult.value!);

        latestResult = undefined;
      }
      timeoutId = undefined;

      // If the source has completed, complete the output stream
      if (isCompleted) {
        output.complete();
      }
    };

    (async () => {
      try {
        resolvedDuration = isPromiseLike(duration) ? await duration : duration;

        while (true) {
          const result = await source.next();

          if (result.done) {
            isCompleted = true;

            // If a pending value exists, flush it before completing
            if (timeoutId === undefined && latestResult !== undefined) {
              flush();
            }
            break;
          }

          latestResult = result;

          // Reset the timer
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          if (resolvedDuration !== undefined) {
            timeoutId = setTimeout(flush, resolvedDuration);
          }
        }
      } catch (err) {
        output.error(err);
      } finally {
        isCompleted = true;
        // Clear pending timer
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        // Flush any remaining latest value
        if (latestResult !== undefined) flush();
        output.complete();
      }
    })();

    return eachValueFrom(output);
  });
}
