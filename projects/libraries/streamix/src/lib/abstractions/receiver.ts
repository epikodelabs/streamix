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

    return scheduler.enqueue(async () => {
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

      return scheduler.enqueue(async () => {
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
            try {
              const compResult = target.complete?.();
              if (isPromiseLike(compResult)) await compResult;
            } catch (err2) {
              try {
                console.error('Unhandled error in complete handler:', err2);
              } catch (_) {
                /* ignore logging failures */
              }
            }
          }
      });
    },

    complete: () => {
      if (_completed || _completedScheduled) return Promise.resolve();
      _completedScheduled = true;

      return scheduler.enqueue(async () => {
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
      });
    },

    get completed() {
      return _completed;
    },
  };

  return wrapped;
}