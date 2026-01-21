import { unwrapPrimitive } from "./hooks";
import { isPromiseLike, type MaybePromise } from "./operator";

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
  let _completionHandled = false;
  let _processing = false;
  let _pendingComplete = false;
  let pendingCompleteResolve: (() => void) | null = null;
  type QueueEntry = { value: T; resolve: () => void; reject: (err: any) => void };
  const _queue: QueueEntry[] = [];

  const baseReceiver = {
    get completed() { return _completed; }
  } as { readonly completed: boolean; };

  const receiver = (typeof callbackOrReceiver === 'function'
    ? { ...baseReceiver, next: callbackOrReceiver }
    : callbackOrReceiver
      ? { ...baseReceiver, ...callbackOrReceiver }
      : baseReceiver) as Receiver<T>;

  const wantsRaw = (receiver as any).__wantsRawValues === true;

  const scheduleCallback = <R>(
    handler?: ((...args: any[]) => MaybePromise<R>) | undefined,
    ...args: any[]
  ): Promise<R | undefined> => {
    if (!handler) return Promise.resolve<R | undefined>(undefined);

    return new Promise<R | undefined>((resolve, reject) => {
      queueMicrotask(() => {
        try {
          const result = handler.apply(receiver, args);
          if (isPromiseLike(result)) {
            result.then(resolve, reject);
          } else {
            resolve(result as R | undefined);
          }
        } catch (err) {
          reject(err);
        }
      });
    });
  };

  const ensureCompletion = async () => {
    if (_completionHandled) return;
    _completionHandled = true;
    _completed = true;
    try {
      await scheduleCallback(receiver.complete);
    } catch (err) {
      console.error('Unhandled error in complete handler:', err);
    }
    pendingCompleteResolve?.();
    pendingCompleteResolve = null;
  };

  const handleError = async (err: any) => {
    if (_completed && _completionHandled) return;
    _queue.length = 0;
    _pendingComplete = false;
    const normalizedError = err instanceof Error ? err : new Error(String(err));
    try {
      await scheduleCallback(receiver.error, normalizedError);
    } catch (handlerErr) {
      console.error('Unhandled error in error handler:', handlerErr);
    }
    await ensureCompletion();
  };

  const processQueue = async () => {
    _processing = true;
    try {
      while (_queue.length > 0 && !_completionHandled) {
        const entry = _queue.shift()!;
        const payload = wantsRaw ? entry.value : unwrapPrimitive(entry.value);
        try {
          await scheduleCallback(receiver.next, payload);
          entry.resolve();
          
          // Check if complete was called during the callback
          if (_completed && !_completionHandled) {
            break;
          }
        } catch (err) {
          await handleError(err);
          entry.resolve();
          return;
        }
      }
    } finally {
      _processing = false;
      if (_pendingComplete && !_completionHandled) {
        _pendingComplete = false;
        await ensureCompletion();
      }
    }
  };

  const wrappedReceiver: StrictReceiver<T> = {
    next: (value: T) => {
      if (_completed) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        _queue.push({ value, resolve, reject });
        if (_processing) return;
        void processQueue();
      });
    },
    error: async function (err: any) {
      await handleError(err);
    },
    complete: () => {
      if (_completionHandled) return Promise.resolve();
      
      // If we're in the middle of processing, just mark as complete
      // The current next() will finish, but no more will be processed
      if (_processing) {
        _completed = true;
        _queue.length = 0; // Clear remaining queue
        _pendingComplete = true;
        return new Promise<void>((resolve) => {
          pendingCompleteResolve = resolve;
        });
      }
      
      // Otherwise complete immediately
      return ensureCompletion();
    },
    get completed() {
      return _completed;
    },
  };

  return wrappedReceiver;
}