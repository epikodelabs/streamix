import { createStream, isPromiseLike, type MaybePromise, type Stream } from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";

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
 * @param {() => (Stream<T> | MaybePromise<T>)} factory A function that returns a new stream or value for each attempt.
 * @param {MaybePromise<number>} [maxRetries=3] The maximum number of times to retry the stream. A value of 0 means no retries.
 * @param {MaybePromise<number>} [delay=1000] The time in milliseconds to wait before each retry attempt.
 * @returns {Stream<T>} A new stream that applies the retry logic.
 */
export function retry<T = any>(
  factory: () => Stream<T> | MaybePromise<T>,
  maxRetries: MaybePromise<number> = 3,
  delay: MaybePromise<number> = 1000
): Stream<T> {
  return createStream<T>("retry", async function* (signal) {
    const resolvedMaxRetries = isPromiseLike(maxRetries) ? await maxRetries : maxRetries;
    let resolvedDelayValue: number | undefined;
    const resolveDelayValue = async () => {
      if (resolvedDelayValue !== undefined) {
        return resolvedDelayValue;
      }
      if (delay === undefined) {
        return undefined;
      }
      resolvedDelayValue = isPromiseLike(delay) ? await delay : delay;
      return resolvedDelayValue;
    };

    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount <= resolvedMaxRetries) {
      let iterator: AsyncGenerator<T> | null = null;
      let buffered: T[] = [];

      try {
        // Check abort signal at loop start
        if (signal?.aborted) {
          throw new Error("Stream aborted");
        }

        // Wrap factory call in try-catch to handle factory errors
        let produced: Stream<T> | MaybePromise<T>;
        try {
          produced = factory();
        } catch (factoryError) {
          throw factoryError instanceof Error ? factoryError : new Error(String(factoryError));
        }

        const source = isPromiseLike(produced) ? await produced : produced;
        iterator = eachValueFrom(fromAny(source));

        for await (const value of iterator) {
          // Check abort signal during iteration
          if (signal?.aborted) {
            throw new Error("Stream aborted");
          }
          buffered.push(value);
        }

        for (const value of buffered) {
          yield value;
        }
        lastError = null;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retryCount++;

        // Only delay if we're going to retry (check BEFORE sleeping)
        const resolvedDelay = await resolveDelayValue();
        if (retryCount <= resolvedMaxRetries && resolvedDelay !== undefined && resolvedDelay > 0) {
          // Allow abortion during delay
          try {
            await new Promise<void>((resolve, reject) => {
              const timeoutId = setTimeout(resolve, resolvedDelay);

              if (signal) {
                const abortHandler = () => {
                  clearTimeout(timeoutId);
                  reject(new Error("Stream aborted"));
                };
                signal.addEventListener("abort", abortHandler, { once: true });
              }
            });
          } catch (delayError) {
            throw delayError;
          }
        }
      } finally {
        if (iterator?.return) {
          try {
            await iterator.return(undefined);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    }

    // If we exhausted retries and had errors, throw the last error
    if (lastError) {
      throw lastError;
    }
  });
}
