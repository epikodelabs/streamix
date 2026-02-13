import {
  createReceiver,
  createSubscription,
  generateStreamId,
  isPromiseLike,
  pipeSourceThrough,
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
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get value(): T; // BehaviorSubject always has a value
};

/**
 * Create a `BehaviorSubject` seeded with `initialValue`.
 *
 * @template T
 * @param {T} initialValue - initial value held by the subject
 * @returns {BehaviorSubject<T>} a new behavior subject
 */
export function createBehaviorSubject<T = any>(initialValue: T): BehaviorSubject<T> {
  const id = generateStreamId();
  let latestValue: T = initialValue;
  let isCompleted = false;
  let completionInfo: { kind: 'error'; error: any } | null = null;

  const listeners = new Set<AsyncPushable<T>>();

  const next = (value: T) => {
    if (isCompleted) return;
    latestValue = value;
    for (const listener of listeners) {
      listener.push(value);
    }
  };

  const complete = () => {
    if (isCompleted) return;
    isCompleted = true;
    for (const listener of listeners) {
      listener.complete();
    }
    listeners.clear();
  };

  const error = (err: any) => {
    if (isCompleted) return;
    isCompleted = true;
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
    if (!isCompleted) {
      listener.push(latestValue);
    }

    if (isCompleted) {
      if (completionInfo?.kind === 'error') listener.error(completionInfo.error);
      else listener.complete();
    }

    // Initial drain
    drain();

    const sub = createSubscription(async () => {
      listeners.delete(listener);
      listener.complete();
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
    id,
    get value() { return latestValue; },
    next,
    complete,
    error,
    completed: () => isCompleted,
    pipe: (...steps: Operator<any, any>[]): Stream<any> => {
      return pipeSourceThrough(self, steps);
    },
    subscribe,
    query: () => firstValueFrom(self),
    [Symbol.asyncIterator]: () => {
      const listener = createAsyncPushable<T>();
      listeners.add(listener);

      // Replay current value only if the subject is still alive.
      if (!isCompleted) {
        listener.push(latestValue);
      }

      if (isCompleted) {
        if (completionInfo?.kind === 'error') listener.error(completionInfo.error);
        else listener.complete();
      }

      const originalReturn = listener.return;
      (listener as any).return = (v?: any) => {
        listeners.delete(listener);
        return originalReturn ? originalReturn.call(listener, v) : Promise.resolve({ done: true, value: v });
      };

      return listener;
    }
  };

  return self;
}
