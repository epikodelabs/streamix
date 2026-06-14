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
  type Stream,
} from "../abstractions";
import { firstValueFrom } from "../converters";
import { AsyncPushable, createAsyncPushable } from "../utils";

/**
 * BehaviorSubject holds a current value and emits it immediately to new
 * subscribers. It exposes imperative `next`/`complete`/`error` methods and
 * guarantees `value` is always available.
 *
 * @template T
 */
export type BehaviorSubject<T = any> = Stream<T> & {
  next(value: T): void;
  dispose(): void;
  error(err: any): void;
  disposed: boolean;
  get value(): T; // BehaviorSubject always has a value
  subscribe(callback: (value: T) => MaybePromise): Subscription;
  subscribe(receiver: Receiver<T>): Subscription;
  subscribe(): Subscription;
  subscribe(callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription;
  query: () => Promise<T>;
  toArray: () => Promise<T[]>;
};

/**
 * Create a `BehaviorSubject` seeded with `initialValue`.
 *
 * @template T
 * @param {T} initialValue - initial value held by the subject
 * @returns {BehaviorSubject<T>} a new behavior subject
 */
export function createBehaviorSubject<T = any>(initialValue: T): BehaviorSubject<T> {
  let latestValue: T = initialValue;
  let isDisposed = false;
  let completionInfo: { kind: 'error'; error: any } | null = null;

  const listeners = new Set<AsyncPushable<T>>();

  const next = (value: T) => {
    if (isDisposed) return;
    latestValue = value;
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
              }, () => {
                isProcessing = false;
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

    // Replay current value only if the subject is still alive.
    // After completion/error, late subscribers receive only the terminal signal.
    if (!isDisposed) {
      listener.push(latestValue);
    }

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

  const self: BehaviorSubject<T> = {
    type: "subject",
    name: "behaviorSubject",
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

      // Replay current value only if the subject is still alive.
      if (!isDisposed) {
        listeners.add(listener);
        listener.push(latestValue);
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
