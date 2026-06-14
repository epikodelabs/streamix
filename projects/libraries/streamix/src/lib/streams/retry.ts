import { isPromiseLike, type MaybePromise } from "../abstractions";
import { flow, type AtomBase } from "../atoms/atom";
import { toAsyncIterable, type StreamInput } from "./pipe";

/**
 * Creates an atom that subscribes to a source factory and retries the entire sequence on error.
 *
 * Values are yielded as each attempt produces them. If an attempt fails after emitting some values,
 * those values stay visible downstream and the operator restarts the factory for the next attempt.
 *
 * @template T - The type of values emitted by the source stream.
 * @param factory - A factory function executed on each initialization attempt.
 * @param maxRetries - The maximum number of retry operations allowed. A value of 0 runs a single attempt.
 * @param delay - The delay window in milliseconds to pause between attempts.
 * @returns An atom that retries the sequence factory after errors.
 */
export function retry<T = any>(
  factory: () => StreamInput<T>,
  maxRetries: MaybePromise<number> = 3,
  delay: MaybePromise<number> = 1000
): AtomBase<T> {
  return flow<T>(async function* (signal?: AbortSignal) {
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
          let produced: StreamInput<T>;
          try {
            produced = factory();
          } catch (factoryError) {
            throw factoryError instanceof Error ? factoryError : new Error(String(factoryError));
          }

          const source = toAsyncIterable(produced);
          iterator = source[Symbol.asyncIterator]() as AsyncIterator<T>;

          while (true) {
            const next = await iterator.next();
            if (next.done) break;

            yield next.value;
          }

          lastError = null;
          break;
        } catch (error) {
          if (signal?.aborted) {
            break;
          }

          lastError = error instanceof Error ? error : new Error(String(error));
          retryCount++;

          const resolvedDelay = await resolveDelayValue();
          if (retryCount <= resolvedMaxRetries && resolvedDelay !== undefined && resolvedDelay > 0) {
            try {
              await new Promise<void>((resolve, reject) => {
                const id = setTimeout(() => resolve(), resolvedDelay);
                signal!.addEventListener(
                  "abort",
                  () => {
                    clearTimeout(id);
                    reject(new Error("Aborted"));
                  },
                  { once: true }
                );
              });
            } catch {
              break;
            }
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

      if (lastError && !signal!.aborted) {
        throw lastError;
      }
  });
}
