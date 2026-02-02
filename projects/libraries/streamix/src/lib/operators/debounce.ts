import { createOperator, getIteratorMeta, isPromiseLike, setIteratorMeta, setValueMeta, type MaybePromise, type Operator } from "../abstractions";
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
    const outputIterator = eachValueFrom(output);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let latestResult: (IteratorResult<T> & { meta?: ReturnType<typeof getIteratorMeta> }) | undefined;

    let resolvedDuration: number | undefined;
    let completed = false;

    const flush = () => {
      if (!latestResult) return;

      let value = latestResult.value!;
      
      if (latestResult.meta) {
        setIteratorMeta(
          outputIterator,
          latestResult.meta,
          latestResult.meta.operatorIndex,
          latestResult.meta.operatorName
        );

        value = setValueMeta(
          value,
          { valueId: latestResult.meta.valueId },
          latestResult.meta.operatorIndex,
          latestResult.meta.operatorName
        );
      }

      // Emit value directly - tracer correlates it via valueId / inputQueue
      output.next(value);

      latestResult = undefined;
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
          latestResult = result;
          if (meta) {
            (latestResult as any).meta = meta;
          }

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
        if (!output.completed()) output.complete();
      }
    })();

    return outputIterator;
  });
}
