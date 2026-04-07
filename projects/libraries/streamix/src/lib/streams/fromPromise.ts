import { createStream, isPromiseLike, type Stream } from "../abstractions";

/**
 * Creates a stream from a value, promise, or a cancelable asynchronous factory.
 *
 * The input can be:
 * - A value
 * - A promise
 * - A function that returns a value or promise, and optionally reacts to cancellation via an {@link AbortSignal}.
 *
 * The factory function (if provided) is invoked on subscription and receives an {@link AbortSignal}
 * that is aborted when the stream is unsubscribed. If the factory throws or returns a rejected promise,
 * the stream will emit an error.
 *
 * @typeParam T - The type of the emitted value.
 * @param input - A value, promise, or a function producing a value or promise, optionally using the provided abort signal for cancellation.
 * @returns A stream that emits the produced value and then completes.
 */
export function fromPromise<T>(
  input: Promise<T> | ((signal: AbortSignal) => Promise<T>)
): Stream<T> {
  return createStream<T>('fromPromise', async function* (signal?: AbortSignal) {
    const effectiveSignal = signal ?? new AbortController().signal;
    const valueOrPromise =
      typeof input === "function" ? (input as (s?: AbortSignal) => Promise<T>)(effectiveSignal) : input;

    yield isPromiseLike(valueOrPromise) ? await valueOrPromise : valueOrPromise;
  });
}