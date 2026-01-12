import { isPromiseLike, unwrapPrimitive, type MaybePromise } from "../abstractions";

/**
 * Defines a receiver interface for handling a stream's lifecycle events.
 * @template T The type of the value handled by the receiver's `next` method.
 */
export type Receiver<T = any> = {
  next?: (value: T) => MaybePromise;
  error?: (err: Error) => MaybePromise;
  complete?: () => MaybePromise;
};

/**
 * A fully defined, state-aware receiver with guaranteed lifecycle handlers.
 * @template T The type of the value handled by the receiver.
 */
export type StrictReceiver<T = any> = Required<Receiver<T>> & { readonly completed: boolean; };

/**
 * Normalizes a receiver input (a function or an object) into a strict,
 * fully-defined receiver.
 *
 * This implementation preserves the prototype chain of the input receiver
 * and ensures `this.completed` is a live property, fixing sporadic state issues.
 *
 * @template T The type of the value handled by the receiver.
 * @param callbackOrReceiver An optional function to serve as the `next` handler,
 * or a `Receiver` object with one or more optional handlers.
 * @returns A new `StrictReceiver` instance.
 */
export function createReceiver<T = any>(
  callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>
): StrictReceiver<T> {
  let _completed = false;

  // 1. Construct the internal receiver without destroying prototypes or snapshotting getters.
  let receiver: Receiver<T>;

  if (typeof callbackOrReceiver === 'function') {
    receiver = { next: callbackOrReceiver };
  } else if (callbackOrReceiver && typeof callbackOrReceiver === 'object') {
    // Use Object.create to preserve the prototype chain (methods/class props)
    receiver = Object.create(callbackOrReceiver);
  } else {
    receiver = {};
  }

  // 2. Inject the 'completed' property as a LIVE getter on the internal receiver.
  // This ensures 'this.completed' inside user handlers always reflects the real state.
  Object.defineProperty(receiver, 'completed', {
    get: () => _completed,
    configurable: true,
    enumerable: true
  });

  const wantsRaw = (callbackOrReceiver as any)?.__wantsRawValues === true;

  // Helper: Safely execute complete and return a Promise if async
  const safeComplete = (): MaybePromise => {
    try {
      // Use the ORIGINAL object for the call to ensure 'this' is correct
      // (Though 'receiver' inherits from it, so it's usually fine, 
      // accessing the prop directly from the prototype is safer if the user didn't override it)
      const completeFn = callbackOrReceiver && typeof callbackOrReceiver !== 'function' 
        ? callbackOrReceiver.complete 
        : receiver.complete;
        
      const result = completeFn?.call(receiver);
      
      if (isPromiseLike(result)) {
        return result.catch((err: any) => console.error('Unhandled error in complete handler:', err));
      }
    } catch (err) {
      console.error('Unhandled error in complete handler:', err);
    }
  };

  const wrappedReceiver: StrictReceiver<T> = {
    next: (value: T) => {
      if (_completed) return;
      const val = wantsRaw ? value : unwrapPrimitive(value);
      try {
        const nextFn = receiver.next;
        const result = nextFn?.call(receiver, val);
        
        if (isPromiseLike(result)) {
           // If next is async, we must catch errors to trigger the error lifecycle
           return result.catch((err: any) => wrappedReceiver.error(err));
        }
      } catch (err) {
        // Sync error in next -> trigger error lifecycle
        return wrappedReceiver.error(err instanceof Error ? err : new Error(String(err)));
      }
    },
    error: (err: Error) => {
      if (!_completed) {
        _completed = true;
        
        let errorResult: MaybePromise;
        try {
          const errorFn = receiver.error;
          errorResult = errorFn?.call(receiver, err);
        } catch (e) {
          console.error('Unhandled error in error handler:', e);
        }

        if (isPromiseLike(errorResult)) {
          // Async Error Handling: Wait for error handler, then clean up
          return errorResult
            .catch((e: any) => console.error('Unhandled error in error handler:', e))
            .then(() => safeComplete());
        }

        // Sync Error Handling: Clean up immediately
        return safeComplete();
      }
    },
    complete: () => {
      if (!_completed) {
        _completed = true;
        return safeComplete();
      }
    },
    get completed() {
      return _completed;
    }
  };

  return wrappedReceiver;
}