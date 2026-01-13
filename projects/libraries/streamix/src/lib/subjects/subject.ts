import { createAsyncGenerator, createReceiver, createSubscription, generateStreamId, type MaybePromise, nextEmissionStamp, type Operator, pipeSourceThrough, type Receiver, type Stream, type StrictReceiver, type Subscription, withEmissionStamp } from "../abstractions";
import { firstValueFrom } from "../converters";

export type Subject<T = any> = Stream<T> & {
  next(value: T): void;
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get value(): T | undefined;
};

export function createSubject<T = any>(): Subject<T> {
  const id = generateStreamId();
  let subscribers: StrictReceiver<T>[] = [];
  let latestValue: T | undefined = undefined;
  let isCompleted = false;
  let hasError = false;
  let errorObj: any = null;

  const next = (value: T) => {
    if (isCompleted || hasError) return;
    latestValue = value;

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
      strictReceiver.error(errorObj);
      return createSubscription();
    }
    if (isCompleted) {
      strictReceiver.complete();
      return createSubscription();
    }

    subscribers = [...subscribers, strictReceiver];

    return createSubscription(() => {
      subscribers = subscribers.filter(s => s !== strictReceiver);
      strictReceiver.complete();
    });
  };

  const subscribe = (callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription => {
    const receiver = createReceiver(callbackOrReceiver);
    return registerReceiver(receiver);
  };

  const subject: Subject<T> = {
    type: "subject",
    name: "subject",
    id,
    get value() {
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
    [Symbol.asyncIterator]: () => {
      const it = createAsyncGenerator(registerReceiver);
      (it as any).__streamix_streamId = id;
      return it;
    },
  };

  return subject;
}
