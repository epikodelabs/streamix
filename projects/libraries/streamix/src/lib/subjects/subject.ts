import { createAsyncGenerator, createReceiver, createSubscription, generateStreamId, scheduler as globalScheduler, isPromiseLike, type MaybePromise, type Operator, pipeSourceThrough, type Receiver, type Scheduler, type Stream, type Subscription } from "../abstractions";
import { firstValueFrom } from "../converters";

export type Subject<T = any> = Stream<T> & {
  next(value: T): void;
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get snappy(): T | undefined;
};

export function createSubject<T = any>(scheduler: Scheduler = globalScheduler): Subject<T> {
  let subscribers: Receiver<T>[] = [];
  let latestValue: T | undefined = undefined;
  let isCompleted = false;
  let hasError = false;
  let errorObj: any = null;

  const next = (value: T) => {
    if (isCompleted || hasError) return;
    latestValue = value;
    
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
    
    // Capture and clear
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
        scheduler.enqueue(() => receiver.error?.(errorObj));
        return createSubscription(); 
    }
    if (isCompleted) {
        scheduler.enqueue(() => receiver.complete?.());
        return createSubscription();
    }
  
    subscribers = [...subscribers, receiver];

    const subscription = createSubscription(() => {
        const idx = subscribers.indexOf(receiver);
        if (idx !== -1) {
            const nextSubscribers = subscribers.slice();
            nextSubscribers.splice(idx, 1);
            subscribers = nextSubscribers;
        }

       scheduler.enqueue(() => receiver.complete?.());
    });

    return subscription;
  };

  const subscribe = (callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription => {
    const receiver = createReceiver(callbackOrReceiver);
    return registerReceiver(receiver);
  };

  const subject: Subject<T> = {
    type: "subject",
    name: "subject",
    id: generateStreamId(),
    get snappy() {
      return latestValue;
    },
    pipe(...steps: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, steps);
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
