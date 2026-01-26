import type { Stream } from "../abstractions";

/**
 * Returns a promise that resolves with the last emitted value from a `Stream`.
 *
 * This function subscribes to the provided stream and buffers the last value
 * received. The returned promise is only settled once the stream completes or
 * errors.
 *
 * - **Successful resolution:** The promise resolves with the last value emitted
 * by the stream, but only after the stream has completed.
 * - **Rejection on error:** If the stream emits an error, the promise is rejected with that error.
 * - **Rejection on no value:** If the stream completes without emitting any values,
 * the promise is rejected with a specific error message.
 *
 * The subscription is automatically and immediately unsubscribed upon completion or
 * on error, ensuring proper resource cleanup.
 *
 * @template T The type of the value expected from the stream.
 * @param stream The source stream to listen to for the final value.
 * @returns A promise that resolves with the last value from the stream or rejects on completion without a value or on error.
 */
export function lastValueFrom<T = any>(stream: Stream<T>): Promise<T> {
  const iterator = stream[Symbol.asyncIterator]();

  return (async () => {
    let hasValue = false;
    let lastValue!: T;

    try {
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
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
