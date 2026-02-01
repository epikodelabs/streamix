import { enqueueMicrotask } from "../primitives/scheduling";
import { getCurrentEmissionStamp } from "./emission";
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
  let _active = 0;
  const _idleResolvers: Array<() => void> = [];

  // Normalize input to a receiver object
  const target = (typeof callbackOrReceiver === 'function'
    ? { next: callbackOrReceiver }
    : callbackOrReceiver || {}) as Receiver<T>;

  const wantsRaw = (target as any).__wantsRawValues === true;

  // Helper to safely execute a user-provided handler within the scheduler
  const runAction = (handler?: (...args: any[]) => MaybePromise, ...args: any[]): Promise<void> => {
    if (!handler || _completed || _completedScheduled) return Promise.resolve();

    const action = async () => {
      // Re-check completed status inside the scheduled task
      if (_completed) return;

      _active++;
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
        _active--;
        if (_active === 0) {
          const resolvers = _idleResolvers.splice(0);
          for (const r of resolvers) r();
        }
      }
    };

    // If we're already in an emission context (i.e. called from a Subject/Stream
    // delivery loop), execute inline to preserve sync semantics.
    const stamp = getCurrentEmissionStamp();
    if (stamp !== null) {
      return action();
    }

    return new Promise<void>((resolve, reject) => {
      enqueueMicrotask(() => void action().then(resolve, reject));
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

        // Wait until any active handlers finish before delivering terminal
        if (_active > 0) {
          await new Promise<void>((resolve) => _idleResolvers.push(resolve));
        }

          try {
            const result = target.error?.(normalizedError);
            if (isPromiseLike(result)) await result;
          } catch (err) {
            try {
              console.error('Unhandled error in error handler:', err);
            } catch (_) {
              /* ignore logging failures */
            }
          } finally {
            _completed = true;
          }
      };

      const stamp = getCurrentEmissionStamp();
      if (stamp !== null) {
        return action();
      }

      return new Promise<void>((resolve, reject) => {
        enqueueMicrotask(() => void action().then(resolve, reject));
      });
    },

    complete: () => {
      if (_completed || _completedScheduled) return Promise.resolve();
      _completedScheduled = true;

      const action = async () => {
        if (_completed) return;

        // Wait until any active handlers finish before delivering terminal
        if (_active > 0) {
          await new Promise<void>((resolve) => _idleResolvers.push(resolve));
        }

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

      const stamp = getCurrentEmissionStamp();
      if (stamp !== null) {
        return action();
      }

      return new Promise<void>((resolve, reject) => {
        enqueueMicrotask(() => void action().then(resolve, reject));
      });
    },

    get completed() {
      return _completed;
    },
  };

  return wrapped;
}
