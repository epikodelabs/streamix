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

export type BehaviorSubject<T = any> = Stream<T> & {
  next(value: T): void;
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get value(): T; // BehaviorSubject always has a value
};

export function createBehaviorSubject<T = any>(initialValue: T): BehaviorSubject<T> {
  const id = generateStreamId();
  let latestValue: T = initialValue;
  let isCompleted = false;
  let terminalItem: { kind: "complete" | "error"; error?: any; stamp: number } | null = null;

  type TrackedReceiver = StrictReceiver<T> & { subscribedAt: number };
  const receivers = new Set<TrackedReceiver>();

  const next = (value: T) => {
    if (isCompleted) return;
    latestValue = value;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();

    // Scheduled delivery
    const targets = Array.from(receivers).filter((r) => stamp > r.subscribedAt);
    scheduler.enqueue(() => {
      withEmissionStamp(stamp, () => {
        for (const r of targets) {
          r.next(value);
        }
      });
    });
  };

  const complete = () => {
    if (isCompleted) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    terminalItem = { kind: "complete", stamp };

    // Scheduled delivery
    const targets = Array.from(receivers);
    scheduler.enqueue(() => {
      withEmissionStamp(stamp, () => {
        for (const r of targets) {
          r.complete();
        }
      });
      receivers.clear();
    });
  };

  const error = (err: any) => {
    if (isCompleted) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    const wrappedError = err instanceof Error ? err : new Error(String(err));
    terminalItem = { kind: "error", error: wrappedError, stamp };

    // Scheduled delivery
    const targets = Array.from(receivers);
    scheduler.enqueue(() => {
      withEmissionStamp(stamp, () => {
        for (const r of targets) {
          r.error(wrappedError);
        }
      });
      receivers.clear();
    });
  };

  const register = (receiver: Receiver<T>): Subscription => {
    const r = receiver as StrictReceiver<T>;

    if (terminalItem) {
      const term = terminalItem;
      withEmissionStamp(term.stamp, () => {
        if (term.kind === "complete") r.complete();
        else if (term.kind === "error") r.error(term.error);
      });
      return createSubscription();
    }

    // Capture the value and stamp at the EXACT moment of registration
    const replayValue = latestValue;
    const replayStamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    
    // Use the emission stamp as the subscription marker so delivery logic
    // (which compares emission stamps) remains consistent across helpers.
    // Mutate the receiver to attach `subscribedAt` so helpers that expect
    // the property on the original receiver work correctly.
    (r as any).subscribedAt = replayStamp;
    const trackedReceiver = r as TrackedReceiver;
    receivers.add(trackedReceiver);

    // Replay the current state to the new subscriber immediately so
    // async iterators see the value before returning.
    try {
      if (!r.completed && receivers.has(trackedReceiver)) {
        withEmissionStamp(replayStamp, () => r.next(replayValue));
      }
    } catch (_) {}

    const baseSub = createSubscription(() => {
      // Synchronous completion
      if (!r.completed) {
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
        withEmissionStamp(stamp, () => r.complete());
      }
      receivers.delete(trackedReceiver);
    });

    const wrappedSub: Subscription = {
      get unsubscribed() {
        return baseSub.unsubscribed;
      },
      unsubscribe() {
        // Remove receiver synchronously to prevent further deliveries
        receivers.delete(trackedReceiver);
        return baseSub.unsubscribe();
      },
      onUnsubscribe: baseSub.onUnsubscribe,
    };

    return wrappedSub;
  };

  return {
    type: "subject",
    name: "behaviorSubject",
    id,
    get value() {
      return latestValue;
    },
    pipe(...steps: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, steps);
    },
    subscribe: (cb) => register(createReceiver(cb)),
    async query(): Promise<T> {
      return firstValueFrom(this);
    },
    next,
    complete,
    error,
    completed: () => isCompleted,
    [Symbol.asyncIterator]: createAsyncIterator({ register })
  } as BehaviorSubject<T>;
}
