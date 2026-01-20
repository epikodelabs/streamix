import { unwrapPrimitive } from "./hooks";
import { type MaybePromise } from "./operator";

/**
 * Defines a receiver interface for handling a stream's lifecycle events.
 *
 * A receiver is an object that can be passed to a stream's `subscribe` method
 * to handle the three primary events in a stream's lifecycle: `next` for
 * new values, `error` for stream errors, and `complete` when the stream has finished.
 *
 * All properties are optional, allowing you to subscribe only to the events you care about.
 *
 * @template T The type of the value handled by the receiver's `next` method.
 */
export type Receiver<T = any> = {
  /**
   * A function called for each new value emitted by the stream.
   * @param value The value emitted by the stream.
   */
  next?: (value: T) => MaybePromise;
  /**
   * A function called if the stream encounters an error.
   * @param err The error that occurred.
   */
  error?: (err: any) => MaybePromise;
  /**
   * A function called when the stream has completed successfully and will emit no more values.
   * Streamix also invokes this on unsubscribe (and after error) so subscribers can
   * centralize cleanup in one place.
   */
  complete?: () => MaybePromise;
};

/**
 * A fully defined, state-aware receiver with guaranteed lifecycle handlers.
 *
 * This type extends the `Receiver` interface by making all handler methods
 * (`next`, `error`, and `complete`) required. It also includes a `completed`
 * property to track the receiver's state, preventing it from processing
 * new events after it has completed. This is an internal type used to ensure
 * robust handling of all stream events.
 *
 * @template T The type of the value handled by the receiver.
 */
export type StrictReceiver<T = any> = Required<Receiver<T>> & { readonly completed: boolean; };

/**
 * Normalizes a receiver input (a function or an object) into a strict,
 * fully-defined receiver.
 *
 * This factory function ensures that a consistent `StrictReceiver` object is
 * always returned, regardless of the input. It wraps the provided handlers
 * with logic that ensures events are not processed after completion and that
 * unhandled errors are logged.
 *
 * If the input is a function, it is treated as the `next` handler. If it's an
 * object, its `next`, `error`, and `complete` properties are used. If no input
 * is provided, a receiver with no-op handlers is created.
 *
 * @template T The type of the value handled by the receiver.
 * @param callbackOrReceiver An optional function to serve as the `next` handler,
 * or a `Receiver` object with one or more optional handlers.
 * @returns A new `StrictReceiver` instance with normalized handlers and completion tracking.
 */
export function createReceiver<T = any>(
  callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>
): StrictReceiver<T> {
  let _completed = false;

  const baseReceiver = {
    get completed() { return _completed; }
  } as { readonly completed: boolean; };

  const receiver = (typeof callbackOrReceiver === 'function'
    ? { ...baseReceiver, next: callbackOrReceiver }
    : callbackOrReceiver
      ? { ...baseReceiver, ...callbackOrReceiver }
      : baseReceiver) as Receiver<T>;

  const wantsRaw = (receiver as any).__wantsRawValues === true;

  const safeCall = <R>(
    handler?: ((...args: any[]) => MaybePromise<R>) | undefined,
    ...args: any[]
  ): MaybePromise<R | undefined> => {
    if (!handler) return undefined;
    try {
      return handler.apply(receiver, args);
    } catch (err) {
      void wrappedReceiver.error(err instanceof Error ? err : new Error(String(err)));
      return undefined;
    }
  };

  const runNext = (value: T) => {
    if (_completed) return;
    const payload = wantsRaw ? value : unwrapPrimitive(value);
    return safeCall(receiver.next, payload);
  };

  const runError = (err: any) => {
    if (_completed) return;
    _completed = true;
    const normalizedError = err instanceof Error ? err : new Error(String(err));
    safeCall(receiver.error, normalizedError);
    safeCall(receiver.complete);
  };

  const runComplete = () => {
    if (_completed) return;
    _completed = true;
    safeCall(receiver.complete);
  };

  const wrappedReceiver: StrictReceiver<T> = {
    next: (value: T) => runNext(value),
    error: async function (err: any) {
      runError(err);
    },
    complete: async () => {
      runComplete();
    },
    get completed() {
      return _completed;
    },
  };

  return wrappedReceiver;
}
