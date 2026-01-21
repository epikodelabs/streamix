import type { Stream, Subscription } from "../abstractions";

/**
 * Returns a promise that resolves with the first emitted value from a `Stream`.
 *
 * This utility function bridges the gap between the stream's push-based system and
 * JavaScript's standard promise-based asynchronous programming model. It's designed
 * for scenarios where you only care about the very first value a stream produces,
 * treating the stream like a single-value asynchronous source.
 *
 * The function's behavior is as follows:
 * - If the stream emits a value, the promise resolves with that value.
 * - If the stream emits an error, the promise rejects with that error.
 * - If the stream completes without ever emitting a value, the promise rejects with an `Error`.
 *
 * Once the promise is either resolved or rejected, the subscription to the stream is
 * automatically terminated, preventing any further resource consumption. This makes it
 * an efficient way to "query" a stream for a single result.
 *
 * @template T The type of the value that the promise will resolve with.
 * @param stream The source stream to listen to.
 * @returns A promise that resolves with the first value from the stream or rejects on error or completion without a value.
 */
export function firstValueFrom<T = any>(stream: Stream<T>): Promise<T> {
  let subscription: Subscription | undefined;
  let seen = false;
  let settled = false;
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

  return new Promise<T>((resolve, reject) => {
    subscription = stream.subscribe({
      next(value: T) {
        if (settled) return;
        settled = true;
        seen = true;
        resolve(value);
        requestUnsubscribe();
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
        if (!seen) {
          reject(new Error("Stream completed without emitting a value"));
        } else {
          // If the stream synchronously completes after emitting, ignore.
        }
        requestUnsubscribe();
      }
    });

    if (pendingUnsubscribe) {
      requestUnsubscribe();
    }
  });
}
