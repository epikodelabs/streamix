import {
  createReceiver,
  createSubscription,
  generateStreamId,
  isPromiseLike,
  type MaybePromise,
  nextEmissionStamp,
  type Operator,
  pipeSourceThrough,
  type Receiver,
  type Stream,
  type StrictReceiver,
  type Subscription,
  withEmissionStamp,
} from "../abstractions";
import { firstValueFrom } from "../converters";
import type { Subject } from "./subject";

/**
 * A type representing a behavior subject that extends Subject and provides access to the current value.
 * @template T The type of values emitted by the subject.
 */
export type BehaviorSubject<T = any> = Subject<T> & {
  readonly value: T;
};

/**
 * `BehaviorSubject<T>` — push-based multicast stream with:
 * - current value (always available)
 * - immediate current-value emission to new subscribers
 * - global async backpressure across all receivers
 * - async iterator participates in backpressure only after iteration starts (lazy attach)
 *
 * Notes:
 * - No replay besides the single "current value" on subscription/iterator attach.
 * - Unsubscribe triggers receiver.complete() for cleanup (Streamix convention).
 * @template T The type of values emitted by the subject.
 * @param initialValue The initial value for the behavior subject.
 * @returns A BehaviorSubject instance that can be subscribed to and iterated over.
 */
export function createBehaviorSubject<T>(initialValue: T): BehaviorSubject<T> {
  const id = generateStreamId();

  let isCompleted = false;
  let hasError = false;
  let errorObj: any = null;

  // current value
  let latestValue: T = initialValue;

  /* ====================================================================== */
  /* SUBSCRIBERS                                                            */
  /* ====================================================================== */

  type Sub = {
    receiver: StrictReceiver<T>;
    active: boolean;
    // Behavior semantics: ensure we emit current value only once to this receiver
    seeded: boolean;
  };

  const subs: Sub[] = [];

  const cleanupSubs = () => {
    for (let i = subs.length - 1; i >= 0; i--) {
      if (!subs[i].active) subs.splice(i, 1);
    }
  };

  /* ====================================================================== */
  /* GLOBAL SERIALIZED EMISSION QUEUE + BACKPRESSURE                         */
  /* ====================================================================== */

  type Task =
    | { type: "seed"; target: Sub }           // emit current value to a new subscriber
    | { type: "next"; value: T }
    | { type: "complete" }
    | { type: "error"; error: any };

  const queue: Task[] = [];
  let draining = false;

  const drain = async () => {
    if (draining) return;
    draining = true;

    try {
      while (queue.length) {
        const task = queue.shift()!;

        // ------------------------------------------------------------------
        // SEED (current value to new subscriber once)
        // ------------------------------------------------------------------
        if (task.type === "seed") {
          const s = task.target;
          if (!s.active) continue;
          if (s.seeded) continue;

          // If already terminal, deliver terminal immediately (no value replay except optional current)
          if (hasError) {
            s.active = false;
            try {
              s.receiver.error(errorObj);
            } finally {
              // nothing
            }
            continue;
          }
          if (isCompleted) {
            s.active = false;
            try {
              s.receiver.complete();
            } finally {
              // nothing
            }
            continue;
          }

          // Emit current value ONCE
          const stamp = nextEmissionStamp();
          s.seeded = true;

          try {
            const r = withEmissionStamp(stamp, () => s.receiver.next(latestValue));
            if (isPromiseLike(r)) {
              await r;
            }
          } catch (e) {
            hasError = true;
            errorObj = e instanceof Error ? e : new Error(String(e));
            // after an error in any receiver, error the stream deterministically
            queue.length = 0;
            queue.push({ type: "error", error: errorObj });
          }

          cleanupSubs();
          continue;
        }

        // ------------------------------------------------------------------
        // NEXT (broadcast with global backpressure)
        // ------------------------------------------------------------------
        if (task.type === "next") {
          if (isCompleted || hasError) continue;

          latestValue = task.value;

          const stamp = nextEmissionStamp();
          const targets = subs.filter(s => s.active);
          const promises: Promise<void>[] = [];

          for (const s of targets) {
            if (!s.active) continue;

            // Ensure behavior seed happened (for safety). If a subscriber
            // was registered and nexts arrive before seed processed, it
            // MUST still get current first. So we enforce:
            // - if not seeded yet, queue a seed *before* delivering this next.
            if (!s.seeded) {
              // Put current task back and seed first
              queue.unshift(task);
              queue.unshift({ type: "seed", target: s });
              // restart outer loop for deterministic ordering
              break;
            }

            try {
              const r = withEmissionStamp(stamp, () => s.receiver.next(task.value));
              if (isPromiseLike(r)) promises.push(r as Promise<void>);
            } catch (e) {
              hasError = true;
              errorObj = e instanceof Error ? e : new Error(String(e));
              break;
            }
          }

          // If we inserted a seed above, we broke early; just continue draining.
          if (queue[0] === task) {
            // we re-queued the same task at front; continue loop
            continue;
          }

          if (!hasError && promises.length) {
            try {
              await Promise.all(promises);
            } catch (e) {
              hasError = true;
              errorObj = e instanceof Error ? e : new Error(String(e));
            }
          }

          if (hasError) {
            queue.length = 0;
            queue.push({ type: "error", error: errorObj });
          }

          cleanupSubs();
          continue;
        }

        // ------------------------------------------------------------------
        // COMPLETE
        // ------------------------------------------------------------------
        if (task.type === "complete") {
          if (isCompleted || hasError) continue;
          isCompleted = true;

          // Important for iterators: completion should not deadlock drain;
          // if iterator was blocking, its receiver.complete will resolve the ack (see iterator section).
          const stamp = nextEmissionStamp();
          const targets = subs.filter(s => s.active);

          withEmissionStamp(stamp, () => {
            for (const s of targets) {
              if (!s.active) continue;
              s.active = false;
              s.receiver.complete();
            }
          });

          cleanupSubs();
          continue;
        }

        // ------------------------------------------------------------------
        // ERROR
        // ------------------------------------------------------------------
        if (task.type === "error") {
          if (isCompleted || hasError) continue;
          hasError = true;
          isCompleted = true;
          errorObj = task.error instanceof Error ? task.error : new Error(String(task.error));

          const stamp = nextEmissionStamp();
          const targets = subs.filter(s => s.active);

          withEmissionStamp(stamp, () => {
            for (const s of targets) {
              if (!s.active) continue;
              s.active = false;
              s.receiver.error(errorObj);
            }
          });

          cleanupSubs();
          continue;
        }
      }
    } finally {
      draining = false;
    }
  };

  const enqueue = (t: Task) => {
    queue.push(t);
    drain();
  };

  /* ====================================================================== */
  /* PRODUCER API                                                           */
  /* ====================================================================== */

  const next = (value: T): void => {
    if (isCompleted || hasError) return;
    enqueue({ type: "next", value });
  };

  const complete = (): void => {
    if (isCompleted || hasError) return;
    enqueue({ type: "complete" });
  };

  const error = (err: any): void => {
    if (isCompleted || hasError) return;
    enqueue({ type: "error", error: err instanceof Error ? err : new Error(String(err)) });
  };

  /* ====================================================================== */
  /* SUBSCRIPTIONS                                                          */
  /* ====================================================================== */

  const register = (receiver: Receiver<T>): Subscription => {
    const strict = receiver as StrictReceiver<T>;

    if (hasError) {
      strict.error(errorObj);
      return createSubscription();
    }
    if (isCompleted) {
      strict.complete();
      return createSubscription();
    }

    const state: Sub = { receiver: strict, active: true, seeded: false };
    subs.push(state);

    // Seed current value via the global queue so it respects backpressure ordering.
    enqueue({ type: "seed", target: state });

    return createSubscription(() => {
      if (!state.active) return;
      state.active = false;
      // Streamix convention: unsubscribe => complete() for cleanup
      strict.complete();
    });
  };

  const subscribe = (cb?: ((v: T) => MaybePromise) | Receiver<T>): Subscription => {
    return register(createReceiver(cb));
  };

  /* ====================================================================== */
  /* ASYNC ITERATOR (lazy attach + participates in global backpressure)      */
  /* ====================================================================== */

  // Iterator buffer & coordination.
  const itBuffer: T[] = [];
  let itYieldResolve: ((r: IteratorResult<T, void>) => void) | null = null;

  // Backpressure ack: subject waits on iteratorReceiver.next() promise until consumer asks again.
  let itAckResolve: (() => void) | null = null;

  let itClosed = false;
  let itClosedError: any = null;

  const clearItAck = () => {
    if (itAckResolve) {
      const r = itAckResolve;
      itAckResolve = null;
      r();
    }
  };

  const pushToIterator = (value: T) => {
    if (itYieldResolve) {
      const r = itYieldResolve;
      itYieldResolve = null;
      r({ done: false, value });
    } else {
      itBuffer.push(value);
    }
  };

  // Iterator is modeled as a subscriber so it participates in global backpressure.
  // Behavior semantics: it should receive current value first, then subsequent values.
  // We reuse the same seed mechanism by registering a Sub and queueing seed for it.
  let itSubState: Sub | null = null;

  const iteratorReceiver: StrictReceiver<T> = {
    next(value: T) {
      if (itClosed) return;

      pushToIterator(value);

      // Backpressure: hold subject until consumer calls iterator.next() again.
      return new Promise<void>((resolve) => {
        itAckResolve = resolve;
      });
    },
    complete() {
      itClosed = true;
      clearItAck();

      if (itYieldResolve) {
        const r = itYieldResolve;
        itYieldResolve = null;
        r({ done: true, value: undefined });
      }
    },
    error(e: Error) {
      itClosed = true;
      itClosedError = e;
      clearItAck();

      // If consumer is awaiting, next() should reject.
      if (itYieldResolve) {
        const r = itYieldResolve;
        itYieldResolve = null;
        // Resolve with a promise rejection (common pattern in your codebase)
        r(Promise.reject(e) as any);
      }
    },
    get completed() {
      return itClosed;
    },
  };

  const ensureIteratorAttached = () => {
    if (itSubState || itClosed) return;
    if (hasError) {
      itClosed = true;
      itClosedError = errorObj;
      return;
    }
    if (isCompleted) {
      itClosed = true;
      return;
    }

    itSubState = { receiver: iteratorReceiver, active: true, seeded: false };
    subs.push(itSubState);

    // Seed current value for iterator first (Behavior semantics)
    enqueue({ type: "seed", target: itSubState });
  };

  const iterator: AsyncGenerator<T, void, unknown> = {
    async next() {
      if (itClosed) {
        if (itClosedError) throw itClosedError;
        return { done: true, value: undefined };
      }

      ensureIteratorAttached();

      // Consumer is ready for the next value => release backpressure from prior value.
      clearItAck();

      // If we already buffered values (including seeded current), yield immediately.
      if (itBuffer.length > 0) {
        return { done: false, value: itBuffer.shift()! };
      }

      // Otherwise wait until iteratorReceiver.next pushes a value.
      return await new Promise<IteratorResult<T, void>>((resolve) => {
        itYieldResolve = resolve;
      });
    },

    async return(value?: any) {
      itClosed = true;
      clearItAck();

      if (itSubState) {
        itSubState.active = false;
        itSubState = null;
      }

      if (itYieldResolve) {
        const r = itYieldResolve;
        itYieldResolve = null;
        r({ done: true, value: undefined });
      }

      return { done: true, value };
    },

    async throw(err?: any) {
      itClosed = true;
      itClosedError = err;
      clearItAck();

      if (itSubState) {
        itSubState.active = false;
        itSubState = null;
      }

      if (itYieldResolve) {
        const r = itYieldResolve;
        itYieldResolve = null;
        r(Promise.reject(err) as any);
      }

      return { done: true, value: undefined };
    },

    [Symbol.asyncIterator]() {
      return this;
    },

    [Symbol.asyncDispose]: async () => {
      // Dispose the iterator itself, not the whole subject.
      itClosed = true;
      clearItAck();
      if (itSubState) {
        itSubState.active = false;
        itSubState = null;
      }
    },
  } as any;

  (iterator as any).__streamix_streamId = id;

  /* ====================================================================== */
  /* SUBJECT OBJECT                                                         */
  /* ====================================================================== */

  const subject: BehaviorSubject<T> = {
    type: "subject",
    name: "behaviorSubject",
    id,

    get value() {
      return latestValue;
    },

    next,
    complete,
    error,
    completed: () => isCompleted,

    subscribe,

    pipe(...ops: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, ops);
    },

    async query(): Promise<T> {
      return firstValueFrom(this);
    },

    [Symbol.asyncIterator]: () => iterator,
  };

  return subject;
}
