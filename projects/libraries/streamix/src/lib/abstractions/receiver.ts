import { unwrapPrimitive } from "./hooks";
import { isPromiseLike, type MaybePromise } from "./operator";

/**
 * A receiver is a set of callbacks for handling next, error, and complete notifications from a stream or subject.
 *
 * @template T The type of values received.
 */
export type Receiver<T = any> = {
  next?: (value: T) => MaybePromise;
  error?: (err: any) => MaybePromise;
  complete?: () => MaybePromise;
};

/**
 * A strict receiver is a receiver with all callbacks required and a completed flag.
 *
 * @template T The type of values received.
 */
export type StrictReceiver<T = any> = Required<Receiver<T>> & { readonly completed: boolean; };

/**
 * Create a strict receiver from a callback or receiver object.
 *
 * @template T The type of values received.
 * @param {((value: T) => MaybePromise) | Receiver<T>} [callbackOrReceiver] - Callback or receiver object.
 * @returns {StrictReceiver<T>} A strict receiver instance.
 */
export function createReceiver<T = any>(
  callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>
): StrictReceiver<T> {
  let _completed = false;
  let _completedScheduled = false;
  let _pendingCount = 0;
  let _idlePromise: Promise<void> = Promise.resolve();
  let _resolveIdle: (() => void) | null = null;

  // Normalize input to a receiver object
  const target = (typeof callbackOrReceiver === 'function'
    ? { next: callbackOrReceiver }
    : callbackOrReceiver || {}) as Receiver<T>;

  const wantsRaw = (target as any).__wantsRawValues === true;

  const waitForIdle = () => {
    if (_pendingCount === 0) return Promise.resolve();
    return _idlePromise;
  };

  const incrementPending = () => {
    if (_pendingCount === 0) {
      _idlePromise = new Promise<void>((resolve) => {
        _resolveIdle = resolve;
      });
    }
    _pendingCount++;
  };

  const decrementPending = () => {
    _pendingCount--;
    if (_pendingCount === 0 && _resolveIdle) {
      _resolveIdle();
      _resolveIdle = null;
    }
  };

  // Helper to safely execute a user-provided handler within the scheduler
  const runAction = (handler?: (...args: any[]) => MaybePromise, ...args: any[]): Promise<void> => {
    if (!handler || _completed || _completedScheduled) return Promise.resolve();

    const action = async () => {
      // Re-check completed status inside the scheduled task
      if (_completed) return;

      incrementPending();
      try {
        const result = handler.apply(target, args);
        if (isPromiseLike(result)) await result;
      } catch (err) {
        // If 'next' fails, trigger error flow but don't await it to avoid deadlocks
        if (handler === target.next) {
          void wrapped.error(err);
        } else {
          console.error("Unhandled error in Receiver:", err);
        }
      } finally {
        decrementPending();
      }
    };

    return new Promise<void>((resolve, reject) => {
      queueMicrotask(() => void action().then(resolve, reject));
    });
  };

  const wrapped: StrictReceiver<T> = {
    next: (value: T) => {
      if (_completed) return Promise.resolve();
      const payload = wantsRaw ? value : unwrapPrimitive(value);
      return runAction(target.next, payload);
    },

    error: (err: any) => {
      if (_completed || _completedScheduled) return Promise.resolve();
      _completedScheduled = true;
      const normalizedError = err instanceof Error ? err : new Error(String(err));

      const action = async () => {
        if (_completed) return;

        // Wait for pending actions to complete
        await waitForIdle();

        _completed = true;
        try {
          const result = target.error?.(normalizedError);
          if (isPromiseLike(result)) await result;
        } catch (err) {
          try {
            console.error('Unhandled error in error handler:', err);
          } catch (_) {
            /* ignore logging failures */
          }
        }
      };

      return new Promise<void>((resolve, reject) => {
        queueMicrotask(() => void action().then(resolve, reject));
      });
    },

    complete: () => {
      if (_completed || _completedScheduled) return Promise.resolve();
      _completedScheduled = true;

      const action = async () => {
        if (_completed) return;

        // Wait for pending actions to complete
        await waitForIdle();

        _completed = true;
        try {
          const result = target.complete?.();
          if (isPromiseLike(result)) await result;
        } catch (err) {
          try {
            console.error('Unhandled error in complete handler:', err);
          } catch (_) {
            /* ignore logging failures */
          }
        }
      };

      return new Promise<void>((resolve, reject) => {
        queueMicrotask(() => void action().then(resolve, reject));
      });
    },

    get completed() {
      return _completed;
    },
  };

  return wrapped;
}
