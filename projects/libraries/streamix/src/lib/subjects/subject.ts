import {
    createReceiver,
    createSubscription,
    isPromiseLike,
    pipeSourceThrough,
    streamToArray,
    Subscription,
    type MaybePromise,
    type Operator,
    type Receiver,
    type Stream
} from "../abstractions";
import { firstValueFrom } from "../converters";
import { AsyncPushable, createAsyncPushable } from "../utils";

/**
 * Subject is a hot, multicast stream that allows imperatively pushing values
 * with `next`, signalling completion with `complete`, or errors with
 * `error`. It implements `Stream<T>` and exposes the current value via
 * the `value` getter when available.
 *
 * @template T
 */
export type Subject<T = any> = Stream<T> & {
  next(value: T): void;
  dispose(): void;
  error(err: any): void;
  disposed: boolean;
  get value(): T | undefined;
  subscribe(callback: (value: T) => MaybePromise): Subscription;
  subscribe(receiver: Receiver<T>): Subscription;
  subscribe(): Subscription;
  subscribe(callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription;
};

/**
 * Create a plain `Subject` which buffers emissions and delivers them to
 * current subscribers. The returned subject can be used as an async
 * iterable and as an imperative emitter via `next`/`complete`/`error`.
 *
 * @template T
 * @returns {Subject<T>} A new subject instance.
 */
export function createSubject<T = any>(): Subject<T> {
  let latestValue: T | undefined;
  let isDisposed = false;
  let completionInfo: { kind: 'error', error: any } | null = null;

  const listeners = new Set<AsyncPushable<T>>();

  const next = (value: T) => {
    if (isDisposed) return;
    latestValue = value;
    // Deliver to all current listeners
    for (const listener of listeners) {
       listener.push(value);
    }
  };

  const dispose = () => {
    if (isDisposed) return;
    isDisposed = true;
    for (const listener of listeners) {
      listener.dispose();
    }
    listeners.clear();
  };

  const error = (err: any) => {
    if (isDisposed) return;
    isDisposed = true;
    completionInfo = { kind: 'error', error: err };
    for (const listener of listeners) {
      listener.error(err);
    }
    listeners.clear();
  };

  const subscribe = (cb?: Receiver<T> | ((v: T) => MaybePromise)) => {
    const listener = createAsyncPushable<T>();
    listeners.add(listener);

    const receiver = createReceiver(cb);
    let isProcessing = false;
    let stopped = false;

    const drain = () => {
      if (isProcessing) return;
      isProcessing = true;
      try {
        while (true) {
          let result;
          try {
            result = (listener as any).__tryNext();
          } catch (e) {
            receiver.error?.(e);
            listeners.delete(listener);
            return;
          }

          if (!result) break;

          if (result.done) {
             receiver.complete?.();
             listeners.delete(listener);
             return;
          }

          // Skip next values after unsubscribe, but keep draining
          // so the terminal signal (DONE) can still be delivered.
          if (stopped) continue;

          if (receiver.next) {
             const ret = receiver.next(result.value);
             if (isPromiseLike(ret)) {
                ret.then(() => {
                   isProcessing = false;
                   drain();
                }, (err) => {
                   // If receiver.next() rejects, report the error and resume draining
                   // to prevent buffered values from stalling.
                   isProcessing = false;
                   receiver.error?.(err);
                   drain();
                });
                return;
             }
          }
        }
      } catch (err) {
         receiver.error?.(err);
      }
      isProcessing = false;
    };

    (listener as any).__onPush = drain;
    
    if (isDisposed) {
       if (completionInfo?.kind === 'error') listener.error(completionInfo.error);
       else listener.dispose();
    }

    // Initial drain
    drain();

    const sub = createSubscription(async () => {
        listeners.delete(listener);
        listener.dispose();
    });

    const origUnsub = sub.unsubscribe.bind(sub);
    sub.unsubscribe = () => {
      stopped = true;
      return origUnsub();
    };

    return sub;
  };

  const self: Subject<T> = {
    type: "subject",
    name: "subject",
    get value() { return latestValue; },
    next,
    dispose,
    error,
    get disposed() { return isDisposed; },
    pipe: <TOut>(...steps: Operator<any, any>[]): Stream<TOut> => {
      return pipeSourceThrough<T, TOut>(self, steps);
    },
    subscribe,
    query: () => firstValueFrom(self),
    toArray: () => streamToArray(self),
    [Symbol.asyncIterator]: () => {
      const listener = createAsyncPushable<T>();
      if (!isDisposed) {
        listeners.add(listener);
      } else if (completionInfo?.kind === 'error') {
        listener.error(completionInfo.error);
      } else {
        listener.dispose();
      }
       
       const originalReturn = listener.return!.bind(listener);
       const originalThrow = listener.throw!.bind(listener);
       const originalNext = listener.next.bind(listener);
       const originalTryNext = (listener as any).__tryNext.bind(listener);

       (listener as any).return = async (v?: any) => {
         listeners.delete(listener);
         return originalReturn(v);
       };
       (listener as any).throw = async (err?: any) => {
         listeners.delete(listener);
         return originalThrow(err);
       };
       
       listener.next = originalNext;
       (listener as any).__tryNext = originalTryNext;

       return listener;
    }
  };
  
  return self;
}
