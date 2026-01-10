import { createAsyncGenerator, createReceiver, createSubscription, generateStreamId, scheduler as globalScheduler, type MaybePromise, type Operator, pipeSourceThrough, type Receiver, type Scheduler, type Stream, type Subscription } from "../abstractions";
import { firstValueFrom } from "../converters";

export type Subject<T = any> = Stream<T> & {
  next(value: T): void;
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get snappy(): T | undefined;
};

export function createSubject<T = any>(scheduler: Scheduler = globalScheduler): Subject<T> {
  const subscribers = new Set<Receiver<T>>();
  let latestValue: T | undefined = undefined;
  let isCompleted = false;
  let hasError = false;
  let errorObj: any = null;

  const next = (value: T) => {
    if (isCompleted || hasError) return;
    latestValue = value;
    
    // Snapshot subscribers synchronously
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
    
    // Snapshot subscribers synchronously
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
    
    // Snapshot subscribers synchronously
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
    // Synchronous state check
    if (hasError) {
        scheduler.enqueue(async () => await receiver.error?.(errorObj));
        return createSubscription(); 
    }
    if (isCompleted) {
        scheduler.enqueue(async () => await receiver.complete?.());
        return createSubscription();
    }
  
    subscribers.add(receiver);

    const subscription = createSubscription(() => {
      subscribers.delete(receiver);
      // We also schedule a complete call on the receiver to signify unsubscription finished?
      // StrictReceiver normally handles cleanup.
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
