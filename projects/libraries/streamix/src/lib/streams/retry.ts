import { createStream, isPromiseLike, MaybePromise, Stream } from "../abstractions";
import { fromAny } from "../converters";

/**
 * Creates a stream that subscribes to a source factory and retries on error.
 *
 * This operator is useful for handling streams that may fail due to
 * temporary issues, such as network problems. It will attempt to
 * resubscribe to the source stream up to `maxRetries` times, with an
 * optional delay between each attempt. If the stream completes successfully
 * on any attempt, it will emit all of its values and then complete.
 * If all retry attempts fail, the final error is propagated.
 *
 * @template T The type of values emitted by the stream.
 * @param {() => (Stream<T> | MaybePromise<T>)} factory A function that returns a new stream instance for each subscription attempt.
 * @param {MaybePromise<number>} [maxRetries=3] The maximum number of times to retry the stream. A value of 0 means no retries.
 * @param {MaybePromise<number>} [delay=1000] The time in milliseconds to wait before each retry attempt.
 * @returns {Stream<T>} A new stream that applies the retry logic.
 */
export function retry<T = any>(
  factory: () => MaybePromise<(Stream<T> | T)>,
  maxRetries: MaybePromise<number> = 3,
  delay: MaybePromise<number> = 1000
): Stream<T> {
  return createStream<T>("retry", async function* () {
    const resolvedMaxRetries = isPromiseLike(maxRetries) ? await maxRetries : maxRetries;
    const resolvedDelay = isPromiseLike(delay) ? await delay : delay;

    let retryCount = 0;

    while (retryCount <= resolvedMaxRetries) {
      try {
        const produced = factory();
        const sourceStream = fromAny(isPromiseLike(produced) ? await produced : produced);
        const values: T[] = [];
        let streamError: any = null;
        let completed = false;

        await new Promise<void>((resolve, reject) => {
          const subscription = sourceStream.subscribe({
            next: (value: T) => {
              values.push(value);
            },
            error: (err: any) => {
              streamError = err;
              reject(err);
            },
            complete: () => {
              completed = true;
              resolve();
              subscription.unsubscribe();
            },
          });
        });

        if (streamError) {
          throw streamError;
        }

        if (completed) {
          for (const value of values) {
            yield value;
          }
          break;
        }
      } catch (error) {
        retryCount++;
        if (retryCount > resolvedMaxRetries) {
          throw error;
        }

        if (resolvedDelay !== undefined) {
          await new Promise<void>((resolve) => setTimeout(resolve, resolvedDelay));
        }
      }
    }
  });
}
