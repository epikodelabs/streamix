import { isDroppedResult } from '../abstractions';
import { createStream, isPromiseLike, type MaybePromise, type Stream } from "../abstractions";
import { fromAny } from "../converters";

const RAW = Symbol.for("streamix.rawAsyncIterator");

/**
 * Creates a stream that subscribes to a source factory and retries the entire sequence on error.
 *
 * @description
 * This operator isolates the downstream consumer from partial failures by buffering **all** * values emitted during an execution attempt. 
 * * * **Transactional Behavior:** If an execution attempt errors partway through, the internal 
 * buffer is discarded completely and no values are pushed downstream. Values are only yielded 
 * to the consumer once an entire sequence execution finishes successfully (`next.done === true`).
 * * **Abortion:** The operator honors the abort signal during stream iteration and between-retry delays,
 * clearing allocations safely without event listener leaks.
 *
 * @template T - The type of values emitted by the source stream.
 * @param {() => (Stream<T> | Promise<T>)} factory - A factory function executed on each initialization attempt.
 * @param {MaybePromise<number>} [maxRetries=3] - The maximum number of retry operations allowed. A value of 0 runs a single attempt.
 * @param {MaybePromise<number>} [delay=1000] - The delay window in milliseconds to pause between attempts.
 * @returns {Stream<T>} A transactionally guarded stream that applies sequence retry logic.
 */
export function retry<T = any>(
  factory: () => Stream<T> | Promise<T>,
  maxRetries: MaybePromise<number> = 3,
  delay: MaybePromise<number> = 1000
): Stream<T> {
  return createStream<T>("retry", async function* (signal) {
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
      
      // Transaction buffer: Isolate consumer from seeing partial failures
      const buffer: T[] = [];

      try {
        if (signal?.aborted) {
          throw new DOMException("Stream aborted", "AbortError");
        }

        let produced: Stream<T> | Promise<T>;
        try {
          produced = factory();
        } catch (factoryError) {
          throw factoryError instanceof Error ? factoryError : new Error(String(factoryError));
        }

        const source = isPromiseLike(produced) ? await produced : produced;
        const stream = fromAny(source);
        iterator = ((stream as any)[RAW]?.() ?? stream[Symbol.asyncIterator]()) as AsyncIterator<T>;

        while (true) {
          if (signal?.aborted) {
            throw new DOMException("Stream aborted", "AbortError");
          }

          const next = await iterator.next();
          if (next.done) break;

          if (isDroppedResult(next)) {
            yield next as any;
            continue;
          }
          
          buffer.push(next.value);
        }

        // Entire sequence passed successfully — safely unload transaction buffer downstream
        for (const value of buffer) {
          yield value;
        }

        lastError = null;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retryCount++;

        // Clear references immediately to free up memory on failure drop
        buffer.length = 0;

        const resolvedDelay = await resolveDelayValue();
        if (retryCount <= resolvedMaxRetries && resolvedDelay !== undefined && resolvedDelay > 0) {
          
          // Secure delay engine that cleanly removes abort listeners when timing out naturally
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