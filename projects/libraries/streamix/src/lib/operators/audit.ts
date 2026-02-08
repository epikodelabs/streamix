import { createPushOperator, getIteratorMeta, isPromiseLike, type MaybePromise } from '../abstractions';

/**
 * Creates a stream operator that emits the latest value from the source stream
 * at most once per specified duration.
 *
 * Each incoming value is stored as the "latest"; a timer emits that latest value
 * when the duration elapses. If the source completes before emission, the last
 * buffered value is flushed before completing.
 *
 * @template T The type of the values in the stream.
 * @param duration The time in milliseconds (or a promise resolving to it) to wait
 * before emitting the latest value.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const audit = <T = any>(duration: MaybePromise<number>) =>
  createPushOperator<T>('audit', (source, output) => {
    let bufferedResult: IteratorResult<T> | undefined;
    let bufferedMeta: ReturnType<typeof getIteratorMeta> | undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    let resolvedDuration: number | undefined;
    let completed = false;

    const flush = () => {
      if (!bufferedResult) return;

      output.push(bufferedResult.value!, bufferedMeta);

      bufferedResult = undefined;
      bufferedMeta = undefined;
      timerId = undefined;

      if (completed) output.complete();
    };

    const startTimer = () => {
      if (resolvedDuration === undefined || timerId !== undefined) return;
      timerId = setTimeout(flush, resolvedDuration);
    };

    void (async () => {
      try {
        resolvedDuration = isPromiseLike(duration) ? await duration : duration;

        while (true) {
          const result = await source.next();

          if (result.done) {
            completed = true;
            if (bufferedResult) flush();
            break;
          }

          bufferedMeta = getIteratorMeta(source);
          bufferedResult = result;
          startTimer();
        }
      } catch (err) {
        output.error(err);
      } finally {
        if (timerId) { clearTimeout(timerId); timerId = undefined; }
        if (!output.completed()) output.complete();
      }
    })();

    return () => {
      if (timerId) { clearTimeout(timerId); timerId = undefined; }
    };
  });
