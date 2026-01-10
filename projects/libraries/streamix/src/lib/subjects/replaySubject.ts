import { createAsyncGenerator, createReceiver, createSubscription, generateStreamId, isPromiseLike, type MaybePromise, type Operator, pipeSourceThrough, type Receiver, scheduler, type Stream, type Subscription } from "../abstractions";
import { firstValueFrom } from "../converters";
import type { Subject } from "./subject";

export type ReplaySubject<T = any> = Subject<T>;

export function createReplaySubject<T = any>(capacity: number = Infinity): ReplaySubject<T> {
  const values: T[] = [];
  let subscribers: Receiver<T>[] = [];
  let isCompleted = false;
  let hasError = false;
  let latestValue: T | undefined = undefined;
  let errorObj: any = null;

  const next = (value: T) => {
    if (isCompleted || hasError) return;
    latestValue = value;
    values.push(value);
    if (values.length > capacity) {
      values.shift();
    }

    const currentSubscribers = subscribers;

    scheduler.enqueue(async () => {
      let promises: Promise<void>[] | undefined;
      for (let i = 0; i < currentSubscribers.length; i++) {
        const subscriber = currentSubscribers[i];
        if (subscriber.next) {
          const result = subscriber.next(value);
          if (isPromiseLike(result)) {
            if (!promises) promises = [];
            promises.push(result as Promise<void>);
          }
        }
      }
      await Promise.all(promises || []);
    });
  };

  const complete = () => {
     if (isCompleted || hasError) return;
     isCompleted = true;
     
     const currentSubscribers = subscribers;
     subscribers = [];

     scheduler.enqueue(async () => {
         let promises: Promise<void>[] | undefined;
         for (let i = 0; i < currentSubscribers.length; i++) {
             const subscriber = currentSubscribers[i];
             if (subscriber.complete) {
                 const result = subscriber.complete();
                 if (isPromiseLike(result)) {
                     if (!promises) promises = [];
                     promises.push(result as Promise<void>);
                 }
             }
         }
         await Promise.all(promises || []);
     });
  };

  const error = (err: any) => {
     if (isCompleted || hasError) return;
     hasError = true;
     isCompleted = true;
     errorObj = err;
     
     const currentSubscribers = subscribers;
     subscribers = [];
     
     scheduler.enqueue(async () => {
         let promises: Promise<void>[] | undefined;
         for (let i = 0; i < currentSubscribers.length; i++) {
             const subscriber = currentSubscribers[i];
             if (subscriber.error) {
                 const result = subscriber.error(err);
                 if (isPromiseLike(result)) {
                     if (!promises) promises = [];
                     promises.push(result as Promise<void>);
                 }
             }
         }
         await Promise.all(promises || []);
     });
  };

  const registerReceiver = (receiver: Receiver<T>): Subscription => {
    if (hasError) {
        scheduler.enqueue(async () => {
            for (const v of values) await receiver.next?.(v);
            await receiver.error?.(errorObj);
        });
        return createSubscription();
    }
    
    if (isCompleted) {
        scheduler.enqueue(async () => {
            for (const v of values) await receiver.next?.(v);
            await receiver.complete?.();
        });
        return createSubscription();
    }
    
    let isUnsubscribed = false;
    subscribers = [...subscribers, receiver];
    const currentValues = [...values];
    
    scheduler.enqueue(async () => {
        // Only run replay if not unsubscribed
        if (!isUnsubscribed) {
            for (const v of currentValues) {
                // Technically we could check isUnsubscribed inside loop too?
                // But generally "batch" replay is fine.
                await receiver.next?.(v);
            }
        }
    });
    
    return createSubscription(() => {
        isUnsubscribed = true;
        const idx = subscribers.indexOf(receiver);
        if (idx !== -1) {
            const nextSubscribers = subscribers.slice();
            nextSubscribers.splice(idx, 1);
            subscribers = nextSubscribers;
        }
        scheduler.enqueue(() => receiver.complete?.());
    });
  };

  const subscribe = (callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription => {
    const receiver = createReceiver(callbackOrReceiver);
    return registerReceiver(receiver);
  };

  const replaySubject: ReplaySubject<T> = {
    type: "subject",
    name: "replaySubject",
    id: generateStreamId(),
    pipe(...operators: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, operators);
    },
    subscribe,
    async query(): Promise<T> {
      return await firstValueFrom(this);
    },
    get snappy(): T | undefined {
      return latestValue;
    },
    next,
    complete,
    completed: () => isCompleted,
    error,
    [Symbol.asyncIterator]: () => createAsyncGenerator(registerReceiver),
  };

  return replaySubject;
}
