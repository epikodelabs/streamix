import {
  createReceiver,
  createSubscription,
  generateStreamId,
  getCurrentEmissionStamp,
  isPromiseLike,
  nextEmissionStamp,
  pipeSourceThrough,
  withEmissionStamp,
  type Operator,
  type Receiver,
  type StrictReceiver,
  type Subscription
} from "../abstractions";
import { firstValueFrom } from "../converters";
import {
  createAsyncIterator,
  createTryCommit,
  type QueueItem,
} from "./helpers";
import type { Subject } from "./subject";

/* ========================================================================== */
/* BehaviorSubject                                                            */
/* ========================================================================== */

export type BehaviorSubject<T = any> = Subject<T> & {
  get value(): T;
};

export function createBehaviorSubject<T>(initialValue: T): BehaviorSubject<T> {
  const id = generateStreamId();

  const receivers = new Set<StrictReceiver<T>>();
  const ready = new Set<StrictReceiver<T>>();
  const queue: QueueItem<T>[] = [];

  let latestValue: T = initialValue;
  let isCompleted = false;
  const terminalRef = { current: null as QueueItem<T> | null };

  /* ------------------------------------------------------------------------ */
  /* Commit barrier (IDENTICAL to Subject)                                     */
  /* ------------------------------------------------------------------------ */

  const setLatestValue = (v: T) => {
    latestValue = v;
  };

  const tryCommit = createTryCommit<T>({
    receivers,
    ready,
    queue,
    setLatestValue,
  });

  /* ------------------------------------------------------------------------ */
  /* Producer API                                                             */
  /* ------------------------------------------------------------------------ */

  const next = (value: T) => {
    if (isCompleted) return;

    const current = getCurrentEmissionStamp();
    const base = current ?? nextEmissionStamp();
    const stamp = current === null ? -base : base;

    queue.push({ kind: "next", value, stamp });
    tryCommit();
  };

  const complete = () => {
    if (isCompleted) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    const item: QueueItem<T> = { kind: "complete", stamp };
    terminalRef.current = item;
    queue.push(item);
    tryCommit();
  };

  const error = (err: any) => {
    if (isCompleted) return;
    isCompleted = true;

    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    const item: QueueItem<T> = {
      kind: "error",
      error: err instanceof Error ? err : new Error(String(err)),
      stamp,
    };
    terminalRef.current = item;
    queue.push(item);
    tryCommit();
  };

  /* ------------------------------------------------------------------------ */
  /* Subscription                                                             */
  /* ------------------------------------------------------------------------ */

  const register = (receiver: Receiver<T>): Subscription => {
    const r = receiver as StrictReceiver<T>;
    const item = terminalRef.current;
    if (item) {
      if (item.kind === "complete") {
        withEmissionStamp(item.stamp, () => r.complete());
      } else if (item.kind === "error") {
        const err = item.error;
        withEmissionStamp(item.stamp, () => r.error(err));
      }
      return createSubscription();
    }

    receivers.add(r);
    ready.add(r);

    /* BehaviorSubject semantic: emit latest value directly to THIS receiver only */
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    withEmissionStamp(stamp, () => {
      const res = r.next(latestValue);
      if (isPromiseLike(res)) {
        ready.delete(r);
        res.finally(() => {
          if (!r.completed && receivers.has(r)) {
            ready.add(r);
            tryCommit();
          }
        });
      }
    });

    tryCommit();

    return createSubscription(() => {
      receivers.delete(r);
      ready.delete(r);

      const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
      withEmissionStamp(stamp, () => r.complete());

      tryCommit();
    });
  };


  const subscribe = (cb?: ((v: T) => any) | Receiver<T>) =>
    register(createReceiver(cb));

  /* ------------------------------------------------------------------------ */
  /* Async iterator                                                           */
  /* ------------------------------------------------------------------------ */

  const asyncIterator = createAsyncIterator<T>({ register });

  /* ------------------------------------------------------------------------ */
  /* Public API                                                               */
  /* ------------------------------------------------------------------------ */

  return {
    type: "subject",
    name: "behaviorSubject",
    id,
    get value() {
      return latestValue;
    },
    pipe(...ops: Operator<any, any>[]) {
      return pipeSourceThrough(this, ops);
    },
    subscribe,
    async query() {
      return firstValueFrom(this);
    },
    next,
    complete,
    error,
    completed: () => isCompleted,
    [Symbol.asyncIterator]: asyncIterator,
  };
}
