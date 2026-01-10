import { createAsyncGenerator, createReceiver, createSubscription, generateStreamId, type MaybePromise, type Operator, pipeSourceThrough, type Receiver, scheduler, type Stream, type Subscription } from "../abstractions";
import { firstValueFrom } from "../converters";
import type { Subject } from "./subject";

export type BehaviorSubject<T = any> = Subject<T> & {
  get snappy(): T;
};

export function createBehaviorSubject<T = any>(initialValue: T): BehaviorSubject<T> {
  const subscribers = new Set<Receiver<T>>();
  let latestValue: T = initialValue;
  let isCompleted = false;
  let hasError = false;
  let errorObj: any = null;

  const next = (value: T) => {
    if (isCompleted || hasError) return;
    latestValue = value;
    
    const currentSubscribers = new Set(subscribers);

    scheduler.enqueue(async () => {
      const promises: Promise<void>[] = [];
      for (const subscriber of currentSubscribers) {
        if (subscriber.next) {
          const result = subscriber.next(value);
          if (result instanceof Promise) {
            promises.push(result);
          }
        }
      }
      await Promise.all(promises);
    });
  };

  const complete = () => {
    if (isCompleted || hasError) return;
    isCompleted = true;
    
    const currentSubscribers = new Set(subscribers);
    subscribers.clear();

    scheduler.enqueue(async () => {
      const promises: Promise<void>[] = [];
      for (const subscriber of currentSubscribers) {
        if (subscriber.complete) {
          const result = subscriber.complete();
          if (result instanceof Promise) {
            promises.push(result);
          }
        }
      }
      await Promise.all(promises);
    });
  };

  const error = (err: any) => {
    if (isCompleted || hasError) return;
    hasError = true;
    isCompleted = true;
    errorObj = err;
    
    const currentSubscribers = new Set(subscribers);
    subscribers.clear();

    scheduler.enqueue(async () => {
      const promises: Promise<void>[] = [];
      for (const subscriber of currentSubscribers) {
        if (subscriber.error) {
          const result = subscriber.error(err);
          if (result instanceof Promise) {
            promises.push(result);
          }
        }
      }
      await Promise.all(promises);
    });
  };

  const registerReceiver = (receiver: Receiver<T>): Subscription => {
    if (hasError) {
        scheduler.enqueue(async () => await receiver.error?.(errorObj));
        return createSubscription();
    }
    
    if (isCompleted) {
         // Should NOT emit value if completed, just complete.
         scheduler.enqueue(async () => {
             await receiver.complete?.();
         });
         return createSubscription();
    }

    subscribers.add(receiver);
    
    // Synchronous Initial Emission
    if (receiver.next) {
         // We call validation-wrapped receiver, so it handles errors.
         receiver.next(latestValue);
    }

    const subscription = createSubscription(() => {
      subscribers.delete(receiver);
      scheduler.enqueue(async () => {
        await receiver.complete?.();
      });
    });

    return subscription;
  };

  const subscribe = (callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription => {
    const receiver = createReceiver(callbackOrReceiver);
    return registerReceiver(receiver);
  };

  const subject: BehaviorSubject<T> = {
    type: "subject",
    name: "behaviorSubject",
    id: generateStreamId(),
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
    [Symbol.asyncIterator]: () => createAsyncGenerator(registerReceiver),
  };

  return subject;
}
