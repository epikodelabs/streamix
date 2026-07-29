import { flow, type Atom } from "../atoms/atom";
import { toAsyncIterable, type PipeInput } from '../atoms/pipe';

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
  factory: () => PipeInput<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Atom<T> {
  return flow<T>(async function* (signal?: AbortSignal) {
    let retryCount = 0;
    let lastError: Error | null = null;

    while (retryCount <= maxRetries) {
      let iterator: AsyncIterator<T> | null = null;

      try {
        let produced: PipeInput<T>;
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

        if (retryCount <= maxRetries && delay !== undefined && delay > 0) {
          try {
            await new Promise<void>((resolve, reject) => {
              const onAbort = () => {
                clearTimeout(id);
                reject(new Error("Aborted"));
              };

              const id = setTimeout(() => {
                signal?.removeEventListener("abort", onAbort);
                resolve();
              }, delay);

              if (signal) {
                signal.addEventListener("abort", onAbort, { once: true });
              }
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

    if (lastError && !signal?.aborted) {
      throw lastError;
    }
  });
}
