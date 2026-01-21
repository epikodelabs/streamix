import type { Stream } from "../abstractions";
import type { Subscription } from "../abstractions";

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
  return new Promise<T>((resolve, reject) => {
    let lastValue: T | undefined;
    let hasValue = false;
    let settled = false;

    let subscription: Subscription | undefined;
    let pendingUnsubscribe = false;

    const requestUnsubscribe = (): void => {
      if (subscription) {
        const sub = subscription;
        subscription = undefined;
        sub.unsubscribe();
        return;
      }
      pendingUnsubscribe = true;
    };

    subscription = stream.subscribe({
      next(value: T) {
        lastValue = value;
        hasValue = true;
      },
      error(err: any) {
        if (settled) return;
        settled = true;
        reject(err);
        requestUnsubscribe();
      },
      complete() {
        if (settled) return;
        settled = true;
        if (hasValue) {
          resolve(lastValue as T);
        } else {
          reject(new Error("Stream completed without emitting a value"));
        }
        requestUnsubscribe();
      }
    });

    if (pendingUnsubscribe) {
      requestUnsubscribe();
    }
  });
}
