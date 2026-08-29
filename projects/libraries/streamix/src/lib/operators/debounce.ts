import { createPushOperator } from "../atoms";
import { normalizeError } from "../atoms";

/**
 * Creates a stream operator that emits the most recent value from the source stream
 * only after a specified duration has passed without another new value.
 *
 * Values that are superseded before the timeout fires are simply not emitted.
 *
 * @template T The type of the values in the source and output streams.
 * @param duration The debounce duration in milliseconds.
 * @returns An Operator instance for use in a stream pipeline.
 */
export function debounce<T = any>(duration: number) {
  return createPushOperator<T>("debounce", (source, output) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let latestResult: IteratorResult<T> | undefined;
    let resolvedDuration: number | undefined;
    let completed = false;

    const flush = () => {
      if (!latestResult) return;

      output.push(latestResult.value!);

      latestResult = undefined;
      timeoutId = undefined;

      if (completed) output.dispose();
    };

    void (async () => {
      try {
        resolvedDuration = duration;

        while (true) {
          const result = await source.next();

          if (result.done) {
            completed = true;
            if (latestResult && timeoutId === undefined) flush();
            break;
          }

          latestResult = result;

          if (timeoutId) clearTimeout(timeoutId);
          if (resolvedDuration !== undefined) {
            timeoutId = setTimeout(flush, resolvedDuration);
          }
        }
      } catch (err) {
        output.fail(normalizeError(err));
      } finally {
        completed = true;
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = undefined; }
        if (latestResult) flush();
        if (!output.disposed) output.dispose();
      }
    })();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = undefined;
    };
  });
}
