import {
    createReceiver,
    createSubscription,
    isPromiseLike,
    pipeSourceThrough,
    Subscription,
    type MaybePromise,
    type Operator,
    type Receiver,
    type Stream,
} from "../abstractions";
import { firstValueFrom } from "../converters";
import { AsyncPushable, createAsyncPushable } from "../utils";
import type { Subject } from "./subject";

/**
 * ReplaySubject replays a bounded history of values to late subscribers.
 * It buffers up to `capacity` items and delivers them before continuing
 * with live emissions.
 *
 * @template T
 */
export type ReplaySubject<T = any> = Subject<T> & {
  subscribe(callback: (value: T) => MaybePromise): Subscription;
  subscribe(receiver: Receiver<T>): Subscription;
  subscribe(): Subscription;
  subscribe(callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription;
  query: () => Promise<T>;
};

/**
 * Create a `ReplaySubject` with an optional capacity of buffered items.
 *
 * @template T
 * @param {number} [capacity=Infinity] - max number of values to retain
 * @returns {ReplaySubject<T>} a new replay subject
 */
export function createReplaySubject<T = any>(
  capacity: number = Infinity
): ReplaySubject<T> {
  let latestValue: T | undefined;
  let isCompleted = false;
  let completionInfo: { kind: 'error'; error: any } | null = null;

  const listeners = new Set<AsyncPushable<T>>();
  const isFiniteCapacity = capacity !== Infinity;
  const replay: T[] = [];
  let replayHead = 0;
  let replaySize = 0;

  const pushReplay = (value: T) => {
    if (!isFiniteCapacity) {
      replay.push(value);
      return;
    }
    if (capacity <= 0) return;
    if (replay.length < capacity) {
      replay.push(value);
    } else {
      replay[replayHead] = value;
      replayHead = (replayHead + 1) % capacity;
    }
    replaySize = replaySize < capacity ? replaySize + 1 : replaySize;
  };

  const forEachReplay = (fn: (value: T) => void) => {
    if (!isFiniteCapacity) {
      for (const value of replay) fn(value);
      return;
    }
    if (capacity <= 0) return;
    const start = replaySize < capacity ? 0 : replayHead;
    for (let i = 0; i < replaySize; i++) {
      fn(replay[(start + i) % capacity]);
    }
  };

  const next = (value: T) => {
    if (isCompleted) return;
    latestValue = value;
    pushReplay(value);
    for (const listener of listeners) {
      listener.push(value);
    }
  };

  const drop = (value: T) => {
    if (isCompleted) return;
    for (const listener of listeners) {
      listener.drop(value);
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

          if ((result as any).dropped) continue;

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

    // Replay buffered values
    forEachReplay((value) => listener.push(value));

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

  const self: ReplaySubject<T> = {
    type: "subject",
    name: "replaySubject",
    get value() { return latestValue; },
    next,
    drop,
    complete,
    error,
    completed: () => isCompleted,
    pipe: <TOut>(...steps: Operator<any, any>[]): Stream<TOut> => {
      return pipeSourceThrough<T, TOut>(self, steps);
    },
    subscribe,
    query: () => firstValueFrom(self),
    [Symbol.asyncIterator]: () => {
      const listener = createAsyncPushable<T>();
      listeners.add(listener);

      // Replay buffered values
      forEachReplay((value) => listener.push(value));

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
