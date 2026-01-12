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
 * A type representing a replay subject that extends Subject and replays a specified number of previous values to new subscribers.
 * @template T The type of values emitted by the subject.
 */
export type ReplaySubject<T = any> = Subject<T>;

/**
 * Creates a ReplaySubject that replays a specified number of previous values to each new subscriber.
 *
 * `ReplaySubject<T>` features:
 * - Replays last `capacity` values to each new subscriber
 * - No replay beyond the specified capacity
 * - Global async backpressure across all consumers
 * - Async iterator participates in backpressure only after iteration starts (lazy attach)
 *
 * Notes:
 * - Unsubscribe triggers receiver.complete() for cleanup (Streamix convention).
 * @template T The type of values emitted by the subject.
 * @param capacity The maximum number of values to replay to new subscribers. Defaults to Infinity.
 * @returns A ReplaySubject instance that can be subscribed to and iterated over.
 */
export function createReplaySubject<T = any>(
  capacity: number = Infinity
): ReplaySubject<T> {
  const id = generateStreamId();

  let isCompleted = false;
  let hasError = false;
  let errorObj: any = null;

  /* ====================================================================== */
  /* REPLAY BUFFER                                                          */
  /* ====================================================================== */

  const buffer: T[] = [];

  const pushToBuffer = (v: T) => {
    buffer.push(v);
    if (buffer.length > capacity) buffer.shift();
  };

  /* ====================================================================== */
  /* SUBSCRIBERS                                                            */
  /* ====================================================================== */

  type Sub = {
    receiver: StrictReceiver<T>;
    active: boolean;
    replayIndex: number; // where this subscriber is in replay
  };

  const subs: Sub[] = [];

  const cleanupSubs = () => {
    for (let i = subs.length - 1; i >= 0; i--) {
      if (!subs[i].active) subs.splice(i, 1);
    }
  };

  /* ====================================================================== */
  /* GLOBAL SERIALIZED EMISSION QUEUE                                        */
  /* ====================================================================== */

  type Task =
    | { type: "replay"; target: Sub }
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

        /* -------------------------------------------------------------- */
        /* REPLAY (per subscriber)                                       */
        /* -------------------------------------------------------------- */
        if (task.type === "replay") {
          const s = task.target;
          if (!s.active) continue;

          while (s.replayIndex < buffer.length) {
            const v = buffer[s.replayIndex++];
            const stamp = nextEmissionStamp();
            try {
              const r = withEmissionStamp(stamp, () => s.receiver.next(v));
              if (isPromiseLike(r)) await r;
            } catch (e) {
              hasError = true;
              errorObj = e instanceof Error ? e : new Error(String(e));
              queue.length = 0;
              queue.push({ type: "error", error: errorObj });
              break;
            }
          }

          cleanupSubs();
          continue;
        }

        /* -------------------------------------------------------------- */
        /* NEXT                                                          */
        /* -------------------------------------------------------------- */
        if (task.type === "next") {
          if (isCompleted || hasError) continue;

          pushToBuffer(task.value);

          const stamp = nextEmissionStamp();
          const targets = subs.filter(s => s.active);
          const promises: Promise<void>[] = [];

          for (const s of targets) {
            if (!s.active) continue;

            // ensure replay finished first
            if (s.replayIndex < buffer.length - 1) {
              queue.unshift(task);
              queue.unshift({ type: "replay", target: s });
              break;
            }

            try {
              const r = withEmissionStamp(stamp, () =>
                s.receiver.next(task.value)
              );
              if (isPromiseLike(r)) promises.push(r as Promise<void>);
            } catch (e) {
              hasError = true;
              errorObj = e instanceof Error ? e : new Error(String(e));
              break;
            }
          }

          if (queue[0] === task) continue;

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

        /* -------------------------------------------------------------- */
        /* COMPLETE                                                      */
        /* -------------------------------------------------------------- */
        if (task.type === "complete") {
          if (isCompleted || hasError) continue;
          isCompleted = true;

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

        /* -------------------------------------------------------------- */
        /* ERROR                                                         */
        /* -------------------------------------------------------------- */
        if (task.type === "error") {
          if (isCompleted || hasError) continue;
          hasError = true;
          isCompleted = true;
          errorObj = task.error instanceof Error
            ? task.error
            : new Error(String(task.error));

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

  const next = (value: T) => {
    if (isCompleted || hasError) return;
    enqueue({ type: "next", value });
  };

  const complete = () => {
    if (isCompleted || hasError) return;
    enqueue({ type: "complete" });
  };

  const error = (err: any) => {
    if (isCompleted || hasError) return;
    enqueue({ type: "error", error: err });
  };

  /* ====================================================================== */
  /* SUBSCRIPTIONS                                                          */
  /* ====================================================================== */

  const register = (receiver: Receiver<T>): Subscription => {
  const strict = receiver as StrictReceiver<T>;

  // 🔁 Always replay buffer first
  const replayStamp = nextEmissionStamp();
  withEmissionStamp(replayStamp, () => {
    for (const v of buffer) {
      strict.next(v);
    }
  });

  // 🔚 Terminal handling for late subscribers
  if (hasError) {
    strict.error(errorObj);
    return createSubscription();
  }

  if (isCompleted) {
    strict.complete();
    return createSubscription();
  }

  // 🟢 Live subscriber
  const state: Sub = {
    receiver: strict,
    active: true,
    replayIndex: buffer.length, // replay already done
  };

  subs.push(state);

  return createSubscription(() => {
    if (!state.active) return;
    state.active = false;
    strict.complete(); // cleanup invariant
  });
};


  /* ====================================================================== */
  /* ASYNC ITERATOR (lazy attach + replay)                                   */
  /* ====================================================================== */

  let itSub: Sub | null = null;
  const itBuffer: T[] = [];
  let itYield: ((r: IteratorResult<T, void>) => void) | null = null;
  let itAck: (() => void) | null = null;
  let itClosed = false;
  let itError: any = null;

  const iteratorReceiver: StrictReceiver<T> = {
    next(v: T) {
      if (itClosed) return;
      if (itYield) {
        const r = itYield;
        itYield = null;
        r({ done: false, value: v });
      } else {
        itBuffer.push(v);
      }

      return new Promise<void>(res => (itAck = res));
    },
    complete() {
      itClosed = true;
      itAck?.();
      itYield?.({ done: true, value: undefined });
    },
    error(e) {
      itClosed = true;
      itError = e;
      itAck?.();
      itYield?.(Promise.reject(e) as any);
    },
    get completed() {
      return itClosed;
    },
  };

  const iterator: AsyncGenerator<T> = {
    async next() {
      if (itClosed) {
        if (itError) throw itError;
        return { done: true, value: undefined };
      }

      if (!itSub) {
        itSub = {
          receiver: iteratorReceiver,
          active: true,
          replayIndex: Math.max(0, buffer.length - capacity),
        };
        subs.push(itSub);
        enqueue({ type: "replay", target: itSub });
      }

      itAck?.();
      if (itBuffer.length) {
        return { done: false, value: itBuffer.shift()! };
      }

      return await new Promise(r => (itYield = r));
    },

    async return() {
      itClosed = true;
      itAck?.();
      itSub && (itSub.active = false);
      return { done: true, value: undefined };
    },

    [Symbol.asyncIterator]() {
      return this;
    },
  } as any;

  /* ====================================================================== */
  /* SUBJECT                                                                */
  /* ====================================================================== */

  return {
    type: "subject",
    name: "replaySubject",
    id,

    get value() {
      return undefined;
    },

    next,
    complete,
    error,
    completed: () => isCompleted,

    subscribe(cb?: ((v: T) => MaybePromise) | Receiver<T>) {
      return register(createReceiver(cb));
    },

    pipe(...ops: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, ops);
    },

    async query() {
      return firstValueFrom(this);
    },

    [Symbol.asyncIterator]: () => iterator,
  };
}
