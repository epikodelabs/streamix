import { createStream, isPromiseLike, type MaybePromise, type Stream } from "../abstractions";

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
  input: MaybePromise<T>
): Stream<T> {
  return createStream<T>('fromPromise', async function* (signal?: AbortSignal) {
    const effectiveSignal = signal ?? new AbortController().signal;
    const valueOrPromise =
      typeof input === "function" ? input(effectiveSignal) : input;

    yield isPromiseLike(valueOrPromise) ? await valueOrPromise : valueOrPromise;
  });
}
