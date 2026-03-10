import type { Stream } from "../abstractions";

/**
 * Returns a promise that resolves with the first emitted value from a `Stream`.
 *
 * Dropped results (internal backpressure signals from filter/skip/debounce etc.)
 * are skipped transparently — the promise resolves with the first *real* emission.
 *
 * - If the stream emits a value, the promise resolves with that value.
 * - If the stream emits an error, the promise rejects with that error.
 * - If the stream completes without ever emitting a value, the promise rejects with an `Error`.
 *
 * @template T The type of the value that the promise will resolve with.
 * @param stream The source stream to listen to.
 * @returns A promise that resolves with the first value from the stream or rejects on error or completion without a value.
 */
export function firstValueFrom<T = any>(stream: Stream<any, T>): Promise<T> {
  const iterator = stream[Symbol.asyncIterator]();

  return (async () => {
    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) {
          throw new Error("Stream completed without emitting a value");
        }
        // Skip dropped results — they are internal backpressure signals.
        if ((result as any).dropped) continue;
        return result.value;
      }
    } finally {
      try {
        await iterator.return?.();
      } catch {
      }
    }
  })();
}
