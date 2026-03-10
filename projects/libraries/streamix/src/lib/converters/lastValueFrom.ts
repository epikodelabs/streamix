import type { Stream } from "../abstractions";

/**
 * Returns a promise that resolves with the last emitted value from a `Stream`.
 *
 * Dropped results (internal backpressure signals from filter/skip/debounce etc.)
 * are skipped transparently — only real emissions are considered.
 *
 * - **Successful resolution:** The promise resolves with the last *real* value
 *   emitted by the stream, after the stream has completed.
 * - **Rejection on error:** If the stream emits an error, the promise is rejected.
 * - **Rejection on no value:** If the stream completes without emitting any real
 *   values, the promise is rejected with a specific error message.
 *
 * @template T The type of the value expected from the stream.
 * @param stream The source stream to listen to for the final value.
 * @returns A promise that resolves with the last value from the stream or rejects on completion without a value or on error.
 */
export function lastValueFrom<T = any>(stream: Stream<any, T>): Promise<T> {
  const iterator = stream[Symbol.asyncIterator]();

  return (async () => {
    let hasValue = false;
    let lastValue!: T;

    try {
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        // Skip dropped results — they are internal backpressure signals.
        if ((next as any).dropped) continue;
        hasValue = true;
        lastValue = next.value;
      }

      if (!hasValue) {
        throw new Error("Stream completed without emitting a value");
      }

      return lastValue;
    } finally {
      try {
        await iterator.return?.();
      } catch {
      }
    }
  })();
}
