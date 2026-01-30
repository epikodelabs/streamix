import { createOperator, getIteratorMeta, isPromiseLike, type MaybePromise, type Operator } from '../abstractions';
import { eachValueFrom } from '../converters';
import { createSubject } from '../subjects';

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
 * before emitting the latest value. The duration is resolved once when the operator starts.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const audit = <T = any>(duration: MaybePromise<number>) =>
  createOperator<T, T>('audit', function (this: Operator, source) {
    const output = createSubject<T>();
    const outputIterator = eachValueFrom(output);

    let bufferedResult: IteratorResult<T> | undefined;

    let timerId: ReturnType<typeof setTimeout> | undefined;
    let resolvedDuration: number | undefined;
    let completed = false;

    const flush = () => {
      if (!bufferedResult) return;

      const value = bufferedResult.value!;
      // Emit value directly - tracer tracks it via inputQueue
      output.next(value);

      bufferedResult = undefined;
      timerId = undefined;

      if (completed) {
        output.complete();
      }
    };

    const startTimer = () => {
      if (resolvedDuration === undefined || timerId !== undefined) return;
      timerId = setTimeout(flush, resolvedDuration);
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
            if (bufferedResult) flush();
            break;
          }

          getIteratorMeta(source);

          // ⚠️ Replace buffered value → mark previous as filtered
          bufferedResult = result;

          // Timer starts only once per window
          startTimer();
        }
      } catch (err) {
        output.error(err);
      } finally {
        if (timerId) {
          clearTimeout(timerId);
          timerId = undefined;
        }
        if (!output.completed()) output.complete();
      }
    })();

    return outputIterator;
  });
