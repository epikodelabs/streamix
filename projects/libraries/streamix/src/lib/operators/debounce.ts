import { createPushOperator, isPromiseLike, type MaybePromise } from "../abstractions";

/**
 * Creates a stream operator that emits the most recent value from the source stream
 * only after a specified duration has passed without another new value.
 *
 * Values that are superseded before the timeout fires are forwarded to the output
 * with `dropped: true` so that backpressure is released without surfacing them as
 * real emissions.
 *
 * @template T The type of the values in the source and output streams.
 * @param duration The debounce duration in milliseconds.
 * @returns An Operator instance for use in a stream pipeline.
 */
export function debounce<T = any>(duration: MaybePromise<number>) {
  return createPushOperator<T>("debounce", (source, output) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let latestResult: IteratorResult<T> | undefined;
    let pendingDrops: T[] = [];
    let resolvedDuration: number | undefined;
    let completed = false;

    const flush = () => {
      if (!latestResult) return;

      // Drop all values that were superseded during the debounce window.
      for (const v of pendingDrops) {
        output.drop(v);
      }
      pendingDrops = [];

      output.push(latestResult.value!);

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

          // The previous latest (if any) is now superseded — mark it as pending drop.
          if (latestResult) {
            pendingDrops.push(latestResult.value!);
          }

          latestResult = result;

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
