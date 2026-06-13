import { createStream, isPromiseLike, type MaybePromise, type Stream } from "../abstractions";
import { fromAny } from "../converters";

/**
 * Creates a transactional retrying stream that commits values only after a full
 * attempt completes successfully.
 *
 * Unlike {@link retry}, this operator buffers values produced during each
 * attempt. If an attempt fails, the buffered values are discarded and the next
 * retry starts from a clean state. When an attempt completes, its buffered
 * values are emitted downstream in order.
 *
 * This is useful when retries should preserve all-or-nothing visibility for a
 * sequence, while {@link retry} itself remains pass-through.
 *
 * @template T The type of values emitted by the source stream.
 * @param factory A factory executed for each attempt. The produced result is
 * normalized through {@link fromAny}, so it may be a stream, a promise, or a
 * plain value.
 * @param maxRetries The maximum number of retry operations allowed. A value of
 * `0` runs a single attempt.
 * @param delay The delay window in milliseconds to pause between attempts.
 * @returns A stream that emits values only after an attempt finishes
 * successfully.
 */
export function commit<T = any>(
  factory: () => Stream<T> | MaybePromise<T>,
  maxRetries: MaybePromise<number> = 3,
  delay: MaybePromise<number> = 1000
): Stream<T> {
  return createStream<T>("commit", async function* (signal) {
    const resolvedMaxRetries = isPromiseLike(maxRetries) ? await maxRetries : maxRetries;
    let resolvedDelayValue: number | undefined;

    const resolveDelayValue = async () => {
      if (resolvedDelayValue !== undefined) return resolvedDelayValue;
      if (delay === undefined) return undefined;
      resolvedDelayValue = isPromiseLike(delay) ? await delay : delay;
      return resolvedDelayValue;
    };

    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount <= resolvedMaxRetries) {
      let iterator: AsyncIterator<T> | null = null;

      try {
        if (signal?.aborted) {
          throw new DOMException("Stream aborted", "AbortError");
        }

        let produced: Stream<T> | MaybePromise<T>;
        try {
          produced = factory();
        } catch (factoryError) {
          throw factoryError instanceof Error ? factoryError : new Error(String(factoryError));
        }

        const stream = fromAny(isPromiseLike(produced) ? await produced : produced);
        iterator = stream[Symbol.asyncIterator]() as AsyncIterator<T>;

        // Buffer the entire attempt — only commit on full success
        const batch: T[] = [];

        while (true) {
          if (signal?.aborted) {
            throw new DOMException("Stream aborted", "AbortError");
          }

          const next = await iterator.next();
          if (next.done) break;

          batch.push(next.value);
        }

        // Attempt completed successfully — emit buffered values
        yield* batch;
        lastError = null;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retryCount++;

        const resolvedDelay = await resolveDelayValue();
        if (retryCount <= resolvedMaxRetries && resolvedDelay !== undefined && resolvedDelay > 0) {
          await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) {
              return reject(new DOMException("Stream aborted", "AbortError"));
            }

            const timeoutId = setTimeout(() => {
              if (signal) signal.removeEventListener("abort", abortHandler);
              resolve();
            }, resolvedDelay);

            const abortHandler = () => {
              clearTimeout(timeoutId);
              reject(new DOMException("Stream aborted", "AbortError"));
            };

            if (signal) {
              signal.addEventListener("abort", abortHandler, { once: true });
            }
          });
        }
      } finally {
        if (iterator?.return) {
          try {
            await iterator.return(undefined);
          } catch {
            // Suppress secondary exceptions to protect the core error trace
          }
        }
      }
    }

    if (lastError) {
      throw lastError;
    }
  });
}