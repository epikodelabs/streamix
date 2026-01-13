import { createAsyncGenerator, createReceiver, createSubscription, generateStreamId, type MaybePromise, nextEmissionStamp, type Operator, pipeSourceThrough, type Receiver, type Stream, type StrictReceiver, type Subscription, withEmissionStamp } from "../abstractions";
import { firstValueFrom } from "../converters";
import type { Subject } from "./subject";

export type ReplaySubject<T = any> = Subject<T>;

export function createReplaySubject<T = any>(capacity: number = Infinity): ReplaySubject<T> {
  const id = generateStreamId();
  const values: T[] = [];
  let subscribers: StrictReceiver<T>[] = [];
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

    const stamp = nextEmissionStamp();
    const targets = subscribers;
    withEmissionStamp(stamp, () => {
      for (let i = 0; i < targets.length; i++) {
        targets[i].next(value);
      }
    });
  };

  const complete = () => {
     if (isCompleted || hasError) return;
     isCompleted = true;
     
     const stamp = nextEmissionStamp();
     const targets = subscribers;
     subscribers = [];

     withEmissionStamp(stamp, () => {
       for (let i = 0; i < targets.length; i++) {
         targets[i].complete();
       }
     });
  };

  const error = (err: any) => {
     if (isCompleted || hasError) return;
     hasError = true;
     isCompleted = true;
     errorObj = err instanceof Error ? err : new Error(String(err));
     
     const stamp = nextEmissionStamp();
     const targets = subscribers;
     subscribers = [];
     
     withEmissionStamp(stamp, () => {
       for (let i = 0; i < targets.length; i++) {
         targets[i].error(errorObj);
       }
     });
  };

  const registerReceiver = (receiver: Receiver<T>): Subscription => {
    const strictReceiver = receiver as StrictReceiver<T>;

    if (hasError) {
        const stamp = nextEmissionStamp();
        withEmissionStamp(stamp, () => {
          for (const v of values) strictReceiver.next(v);
          strictReceiver.error(errorObj);
        });
        return createSubscription();
    }
    
    if (isCompleted) {
        const stamp = nextEmissionStamp();
        withEmissionStamp(stamp, () => {
          for (const v of values) strictReceiver.next(v);
          strictReceiver.complete();
        });
        return createSubscription();
    }

    subscribers = [...subscribers, strictReceiver];
    
    if (values.length > 0) {
        const stamp = nextEmissionStamp();
        withEmissionStamp(stamp, () => {
          for (const v of values) {
              strictReceiver.next(v);
          }
        });
    }

    return createSubscription(() => {
        subscribers = subscribers.filter(s => s !== strictReceiver);
        strictReceiver.complete();
    });
  };

  const subscribe = (callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription => {
    const receiver = createReceiver(callbackOrReceiver);
    return registerReceiver(receiver);
  };

  const replaySubject: ReplaySubject<T> = {
    type: "subject",
    name: "replaySubject",
    id,
    pipe(...operators: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, operators);
    },
    subscribe,
    async query(): Promise<T> {
      return await firstValueFrom(this);
    },
    get value(): T | undefined {
      return latestValue;
    },
    next,
    complete,
    completed: () => isCompleted,
    error,
    [Symbol.asyncIterator]: () => {
      const it = createAsyncGenerator(registerReceiver);
      (it as any).__streamix_streamId = id;
      return it;
    },
  };

  return replaySubject;
}
