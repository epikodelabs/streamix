import { createOperator, getIteratorMeta, isPromiseLike, setIteratorMeta, type MaybePromise, type Operator } from "../abstractions";
import { eachValueFrom } from "../converters";
import { createSubject, type Subject } from "../subjects";

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

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let latestResult: IteratorResult<T> | undefined;
    let latestMeta:
      | { valueId: string; operatorIndex: number; operatorName: string }
      | undefined;

    let resolvedDuration: number | undefined;
    let completed = false;

    const flush = () => {
      if (!latestResult) return;

      // Emit final value
      output.next(latestResult.value!);

      latestResult = undefined;
      latestMeta = undefined;
      timeoutId = undefined;

      if (completed) {
        output.complete();
      }
    };

    (async () => {
      try {
        resolvedDuration = isPromiseLike(duration)
          ? await duration
          : duration;

        while (true) {
          const result = await source.next();

          if (result.done) {
            completed = true;

            if (latestResult && timeoutId === undefined) {
              flush();
            }
            break;
          }

          // 🔍 Extract tracing metadata of incoming value
          const meta = getIteratorMeta(source);

          // ⚠️ Supersede previous pending value
          if (latestMeta) {
            // Mark previous as phantom (debounced)
            setIteratorMeta(
              source,
              { valueId: latestMeta.valueId },
              latestMeta.operatorIndex,
              'debounce'
            );
          }

          latestResult = result;
          latestMeta = meta;

          if (timeoutId) clearTimeout(timeoutId);
          if (resolvedDuration !== undefined) {
            timeoutId = setTimeout(flush, resolvedDuration);
          }
        }
      } catch (err) {
        output.error(err);
      } finally {
        completed = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }

        if (latestResult) flush();
        output.complete();
      }
    })();

    return eachValueFrom(output);
  });
}
