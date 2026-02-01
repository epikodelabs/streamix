import {
  createReceiver,
  createSubscription,
  generateStreamId,
  getCurrentEmissionStamp,
  nextEmissionStamp,
  pipeSourceThrough,
  withEmissionStamp,
  type Operator,
  type Receiver,
  type Stream,
  type StrictReceiver,
  type Subscription
} from "../abstractions";
import { firstValueFrom } from "../converters";
import { createAsyncIterator } from "./helpers";

/**
 * BehaviorSubject holds a current value and emits it immediately to new
 * subscribers. It exposes imperative `next`/`complete`/`error` methods and
 * guarantees `value` is always available.
 *
 * @template T
 */
export type BehaviorSubject<T = any> = Stream<T> & {
  next(value: T): void;
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get value(): T; // BehaviorSubject always has a value
};

/**
 * Create a `BehaviorSubject` seeded with `initialValue`.
 *
 * @template T
 * @param {T} initialValue - initial value held by the subject
 * @returns {BehaviorSubject<T>} a new behavior subject
 */
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

    // Synchronous delivery
    const targets = Array.from(receivers).filter((r) => stamp > r.subscribedAt);
    withEmissionStamp(stamp, () => {
      for (const r of targets) {
        r.next(value);
      }
    });
  };

  const complete = () => {
    if (isCompleted) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    terminalItem = { kind: "complete", stamp };

    // Synchronous delivery
    const targets = Array.from(receivers);
    withEmissionStamp(stamp, () => {
      for (const r of targets) {
        r.complete();
      }
    });
    receivers.clear();
  };

  const error = (err: any) => {
    if (isCompleted) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    terminalItem = { kind: "error", error: err, stamp };

    // Synchronous delivery
    const targets = Array.from(receivers);
    withEmissionStamp(stamp, () => {
      for (const r of targets) {
        r.error(err);
      }
    });
    receivers.clear();
  };

  /**
   * Register a receiver to receive emissions from the BehaviorSubject.
   * Handles replaying the current value and terminal state if needed.
   *
   * @param receiver The receiver to register.
   * @returns {Subscription} Subscription object for unsubscription.
   */
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

    return createSubscription(() => {
      // Synchronous completion
      if (!r.completed) {
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
        withEmissionStamp(stamp, () => r.complete());
      }
      receivers.delete(trackedReceiver);
    });
  };

  /**
   * The BehaviorSubject instance returned to consumers.
   *
   * @returns {BehaviorSubject<T>} The subject instance with imperative and stream methods.
   */
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
