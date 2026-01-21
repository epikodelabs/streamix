import {
  createReceiver,
  createSubscription,
  generateStreamId,
  getCurrentEmissionStamp,
  nextEmissionStamp,
  pipeSourceThrough,
  scheduler,
  withEmissionStamp,
  type Operator,
  type Receiver,
  type Stream,
  type StrictReceiver,
  type Subscription
} from "../abstractions";
import { firstValueFrom } from "../converters";
import { createAsyncIterator } from "./helpers";

export type Subject<T = any> = Stream<T> & {
  next(value: T): void;
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get value(): T | undefined;
};

export function createSubject<T = any>(): Subject<T> {
  const id = generateStreamId();
  let operationId = 0;
  let latestValue: T | undefined;
  let isCompleted = false;
  let terminalItem: { kind: 'complete' | 'error', error?: any, stamp: number } | null = null;

  type TrackedReceiver = StrictReceiver<T> & { subscribedAt: number };
  const receivers = new Set<TrackedReceiver>();

  const next = (value: T) => {
    if (isCompleted) return;
    latestValue = value;
    const opId = ++operationId;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();

    scheduler.enqueue(() => {
      if (receivers.size === 0) return;
      const targets = Array.from(receivers).filter(r => opId > r.subscribedAt);
      const promises: Promise<any>[] = [];
      withEmissionStamp(stamp, () => {
        for (const r of targets) {
          promises.push(Promise.resolve(r.next(value)));
        }
      });
      return Promise.allSettled(promises);
    });
  };

  const complete = () => {
    if (isCompleted) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    terminalItem = { kind: 'complete', stamp };

    scheduler.enqueue(() => {
      const targets = Array.from(receivers);
      const promises: Promise<any>[] = [];
      withEmissionStamp(stamp, () => {
        for (const r of targets) {
          promises.push(Promise.resolve(r.complete()));
        }
      });
      receivers.clear();
      return Promise.allSettled(promises);
    });
  };

  const error = (err: any) => {
    if (isCompleted) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    terminalItem = { kind: 'error', error: err, stamp };

    scheduler.enqueue(() => {
      const targets = Array.from(receivers);
      const promises: Promise<any>[] = [];
      withEmissionStamp(stamp, () => {
        for (const r of targets) {
          promises.push(Promise.resolve(r.error(err)));
        }
      });
      receivers.clear();
      return Promise.allSettled(promises);
    });
  };

  const register = (receiver: Receiver<T>): Subscription => {
    const r = receiver as StrictReceiver<T>;
    const trackedReceiver: TrackedReceiver = { ...r, subscribedAt: operationId };

    if (terminalItem) {
      const term = terminalItem;
      scheduler.enqueue(() => {
        withEmissionStamp(term.stamp, () => {
          term.kind === 'error' ? r.error(term.error) : undefined;
          r.complete()
        });
      });
      return createSubscription();
    }

    receivers.add(trackedReceiver);

    Object.defineProperty(trackedReceiver, "completed", {
      get() {
        return r.completed;
      },
      enumerable: true,
      configurable: true
    });

    return createSubscription(() => {
      receivers.delete(trackedReceiver);
      scheduler.enqueue(() => {
        if (!trackedReceiver.completed) {
          const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
          withEmissionStamp(stamp, () => r.complete());
        }
      });
    });
  };

  return {
    type: "subject",
    name: "subject",
    id,
    get value() { return latestValue; },
    pipe(...steps: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, steps);
    },
    subscribe: (cb) => register(createReceiver(cb)),
    async query(): Promise<T> { return firstValueFrom(this); },
    next,
    complete,
    error,
    completed: () => isCompleted,
    [Symbol.asyncIterator]: createAsyncIterator({ register })
  } as Subject<T>;
}
