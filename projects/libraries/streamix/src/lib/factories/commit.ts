import { flow, type Atom } from "../atoms/atom";
import { toAsyncIterable, type PipeInput } from '../atoms/pipe';

/**
 * Creates an atomic retrying atom that commits values only after a full
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
 * normalized through {@link toAsyncIterable}, so it may be an atom, stream,
 * iterable, promise, or plain value.
 * @param maxRetries The maximum number of retry operations allowed. A value of
 * `0` runs a single attempt.
 * @param delay The delay window in milliseconds to pause between attempts.
 * @returns An atom that emits values only after an attempt finishes
 * successfully.
 */
export function commit<T = any>(
  factory: () => PipeInput<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Atom<T> {
  return flow<T>(async function* () {
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

        // Buffer the entire attempt — only commit on full success
        const batch: T[] = [];

        while (true) {
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

        if (retryCount <= maxRetries && delay !== undefined && delay > 0) {
          await new Promise<void>((resolve) => {
            setTimeout(() => {
              resolve();
            }, delay);
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
