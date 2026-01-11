import { createAsyncGenerator, createReceiver, createSubscription, generateStreamId, type MaybePromise, nextEmissionStamp, type Operator, pipeSourceThrough, type Receiver, type Stream, type StrictReceiver, type Subscription, withEmissionStamp } from "../abstractions";
import { firstValueFrom } from "../converters";
import type { Subject } from "./subject";

export type BehaviorSubject<T = any> = Subject<T> & {
  get snappy(): T;
};

export function createBehaviorSubject<T = any>(initialValue: T): BehaviorSubject<T> {
  const id = generateStreamId();
  let subscribers: StrictReceiver<T>[] = [];
  let latestValue: T = initialValue;
  let isCompleted = false;
  let hasError = false;
  let errorObj: any = null;

  const next = (value: T) => {
    if (isCompleted || hasError) return;
    latestValue = value;

    const stamp = nextEmissionStamp();
    const targets = subscribers.slice();
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
    const targets = subscribers.slice();
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
    const targets = subscribers.slice();
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
        strictReceiver.error(errorObj);
      });
      return createSubscription();
    }
    
    if (isCompleted) {
      const stamp = nextEmissionStamp();
      withEmissionStamp(stamp, () => {
        strictReceiver.complete();
      });
      return createSubscription();
    }

    subscribers.push(strictReceiver);

    const stamp = nextEmissionStamp();
    withEmissionStamp(stamp, () => {
      strictReceiver.next(latestValue);
    });

    return createSubscription(() => {
      subscribers = subscribers.filter(s => s !== strictReceiver);
      strictReceiver.complete();
    });
  };

  const subscribe = (callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription => {
    const receiver = createReceiver(callbackOrReceiver);
    return registerReceiver(receiver);
  };

  const subject: BehaviorSubject<T> = {
    type: "subject",
    name: "behaviorSubject",
    id,
    get snappy() {
      return latestValue;
    },
    pipe(...operators: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, operators);
    },
    subscribe,
    async query(): Promise<T> {
      return await firstValueFrom(this);
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

  return subject;
}
