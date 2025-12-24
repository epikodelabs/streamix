import { createOperator, isPromiseLike, type MaybePromise, type Operator } from '../abstractions';
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

    let lastResult: IteratorResult<T> | undefined = undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined = undefined;
    let resolvedDuration: number | undefined = undefined;

    const flush = () => {
      if (lastResult !== undefined) {
        output.next(lastResult.value!);
        lastResult = undefined;
      }
      timerId = undefined;
    };

    const startTimer = () => {
      if (resolvedDuration === undefined) {
        return;
      }
      timerId = setTimeout(() => flush(), resolvedDuration);
    };

    (async () => {
      try {
        resolvedDuration = isPromiseLike(duration) ? await duration : duration;

        while (true) {
          const result = await source.next();

          // Stream completed
          if (result.done) {
            if (lastResult !== undefined) {
              flush();
            }
            break;
          }

          // Add new value to pending set and buffer it
          lastResult = result;

          // Start a new timer if not active
          if (timerId === undefined) {
            startTimer();
          }
        }
      } catch (err) {
        output.error(err);
      } finally {
        if (timerId !== undefined) {
          clearTimeout(timerId);
          timerId = undefined;
        }
        output.complete();
      }
    })();

    return eachValueFrom(output);
  });
