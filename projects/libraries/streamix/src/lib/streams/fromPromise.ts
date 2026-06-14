import { isPromiseLike, type MaybePromise } from "../abstractions";
import { flow, type AtomBase } from "../atoms/atom";

/**
 * Creates an atom from a value, promise, or a cancelable asynchronous factory.
 *
 * The input can be:
 * - A value
 * - A promise
 * - A function that returns a value or promise. The factory may optionally
 *   accept an {@link AbortSignal} that is aborted when the atom is disposed
 *   or the last subscriber unsubscribes.
 *
 * The factory function is invoked when the atom is first subscribed to.
 * If the factory throws or returns a rejected promise, the atom will emit an error.
 *
 * @typeParam T - The type of the emitted value.
 * @param input - A value, promise, or a function producing a value or promise.
 * @returns An atom that emits the produced value and then completes.
 */
export function fromPromise<T>(
  input: MaybePromise<T> | ((signal?: AbortSignal) => MaybePromise<T>)
): AtomBase<T | undefined> {
  return flow<T | undefined>(async function* () {
    const controller = new AbortController();

    try {
      const valueOrPromise =
        typeof input === "function"
          ? (input as (signal?: AbortSignal) => MaybePromise<T>)(controller.signal)
          : input;

      yield isPromiseLike(valueOrPromise) ? await valueOrPromise : valueOrPromise;
    } finally {
      controller.abort();
    }
  });
}
