import { createPushOperator, getIteratorMeta, isPromiseLike, type MaybePromise } from "../abstractions";

/**
 * Creates a stream operator that emits the most recent value from the source stream
 * only after a specified duration has passed without another new value.
 *
 * @template T The type of the values in the source and output streams.
 * @param duration The debounce duration in milliseconds.
 * @returns An Operator instance for use in a stream pipeline.
 */
export function debounce<T = any>(duration: MaybePromise<number>) {
  return createPushOperator<T>("debounce", (source, output) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let latestResult: (IteratorResult<T> & { meta?: ReturnType<typeof getIteratorMeta> }) | undefined;
    let resolvedDuration: number | undefined;
    let completed = false;

    const flush = () => {
      if (!latestResult) return;

      output.push(latestResult.value!, latestResult.meta);

      latestResult = undefined;
      timeoutId = undefined;

      if (completed) output.complete();
    };

    void (async () => {
      try {
        resolvedDuration = isPromiseLike(duration) ? await duration : duration;

        while (true) {
          const result = await source.next();

          if (result.done) {
            completed = true;
            if (latestResult && timeoutId === undefined) flush();
            break;
          }

          const meta = getIteratorMeta(source);
          latestResult = result;
          if (meta) (latestResult as any).meta = meta;

          if (timeoutId) clearTimeout(timeoutId);
          if (resolvedDuration !== undefined) {
            timeoutId = setTimeout(flush, resolvedDuration);
          }
        }
      } catch (err) {
        output.error(err);
      } finally {
        completed = true;
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = undefined; }
        if (latestResult) flush();
        if (!output.completed()) output.complete();
      }
    })();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = undefined;
    };
  });
}
