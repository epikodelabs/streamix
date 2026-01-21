import { unwrapPrimitive } from "./hooks";
import { isPromiseLike, type MaybePromise } from "./operator";
import { scheduler } from "./scheduler";

export type Receiver<T = any> = {
  next?: (value: T) => MaybePromise;
  error?: (err: any) => MaybePromise;
  complete?: () => MaybePromise;
};

export type StrictReceiver<T = any> = Required<Receiver<T>> & { readonly completed: boolean; };

export function createReceiver<T = any>(
  callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>
): StrictReceiver<T> {
  let _completed = false;

  // Normalize input to a receiver object
  const target = (typeof callbackOrReceiver === 'function'
    ? { next: callbackOrReceiver }
    : callbackOrReceiver || {}) as Receiver<T>;

  const wantsRaw = (target as any).__wantsRawValues === true;

  // Helper to safely execute a user-provided handler within the scheduler
  const runAction = (handler?: (...args: any[]) => MaybePromise, ...args: any[]): Promise<void> => {
    if (!handler || _completed) return Promise.resolve();

    return scheduler.enqueue(async () => {
      // Re-check completed status inside the scheduled task
      if (_completed) return;
      
      try {
        const result = handler.apply(target, args);
        if (isPromiseLike(result)) await result;
      } catch (err) {
        // If 'next' fails, trigger error flow
        if (handler === target.next) {
          await wrapped.error(err);
        } else {
          console.error("Unhandled error in Receiver:", err);
        }
      }
    });
  };

  const wrapped: StrictReceiver<T> = {
    next: (value: T) => {
      if (_completed) return Promise.resolve();
      const payload = wantsRaw ? value : unwrapPrimitive(value);
      return runAction(target.next, payload);
    },

    error: (err: any) => {
      if (_completed) return Promise.resolve();
      _completed = true;
      const normalizedError = err instanceof Error ? err : new Error(String(err));
      
      return scheduler.enqueue(async () => {
        try {
          const result = target.error?.(normalizedError);
          if (isPromiseLike(result)) await result;
        } finally {
          // Always ensure complete runs after error
          const compResult = target.complete?.();
          if (isPromiseLike(compResult)) await compResult;
        }
      });
    },

    complete: () => {
      if (_completed) return Promise.resolve();
      _completed = true;
      
      return scheduler.enqueue(async () => {
        const result = target.complete?.();
        if (isPromiseLike(result)) await result;
      });
    },

    get completed() {
      return _completed;
    },
  };

  return wrapped;
}