import { createStream, isPromiseLike, type MaybePromise, type Stream } from "../abstractions";

/**
 * Factory for producing a value or promise that supports cooperative cancellation.
 *
 * The provided {@link AbortSignal} will be aborted when the resulting stream
 * is unsubscribed or otherwise terminated, allowing the underlying asynchronous
 * work to stop early if it supports abort signals (e.g. `fetch`).
 *
 * @template T
 */
export type CancelablePromiseFactory<T> =
  (signal: AbortSignal) => MaybePromise<T>;

/**
 * Creates a stream that emits exactly one value and then completes.
 *
 * This function supports two usage patterns:
 *
 * ### 1. Eager value or promise
 * When given a value or a promise, the stream will emit the resolved value
 * and then complete. If the promise rejects, the stream will emit an error.
 * The underlying promise itself is **not cancelable**.
 *
 * ### 2. Lazy, cancelable factory
 * When given a factory function, the factory is invoked on subscription
 * and receives an {@link AbortSignal}. The signal is aborted when the stream
 * is unsubscribed, enabling cooperative cancellation of the underlying
 * asynchronous work.
 *
 * In both cases, the stream emits exactly one value (if successful) and
 * then completes.
 *
 * @template T The type of the emitted value.
 *
 * @param promise
 * A value or promise to convert into a stream.
 *
 * @returns
 * A stream that emits the resolved value and then completes.
 */
export function fromPromise<T>(promise: MaybePromise<T>): Stream<T>;

/**
 * Creates a stream from a cancelable, lazy asynchronous factory.
 *
 * The factory is invoked on subscription and receives an {@link AbortSignal}
 * that is aborted when the stream is unsubscribed. If the factory throws or
 * returns a rejected promise, the stream will emit an error.
 *
 * @template T The type of the emitted value.
 *
 * @param factory
 * A function producing a value or promise, optionally reacting to cancellation
 * via the provided abort signal.
 *
 * @returns
 * A stream that emits the produced value and then completes.
 */
export function fromPromise<T>(
  factory: CancelablePromiseFactory<T>
): Stream<T>;

export function fromPromise<T>(
  input: MaybePromise<T> | CancelablePromiseFactory<T>
): Stream<T> {
  return createStream<T>('fromPromise', async function* (signal: AbortSignal) {
    const valueOrPromise =
      typeof input === "function" ? (input as CancelablePromiseFactory<T>)(signal) : input;

    yield isPromiseLike(valueOrPromise) ? await valueOrPromise : valueOrPromise;
  });
}
