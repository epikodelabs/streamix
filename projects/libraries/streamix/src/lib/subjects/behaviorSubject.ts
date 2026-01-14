import {
  createReceiver,
  createSubscription,
  generateStreamId,
  getCurrentEmissionStamp,
  isPromiseLike,
  nextEmissionStamp,
  pipeSourceThrough,
  setIteratorEmissionStamp,
  withEmissionStamp,
  type Operator,
  type Receiver,
  type StrictReceiver,
  type Subscription
} from "../abstractions";
import { firstValueFrom } from "../converters";
import type { Subject } from "./subject";

/* ========================================================================== */
/* BehaviorSubject                                                            */
/* ========================================================================== */

type QueueItem<T> =
  | { kind: "next"; value: T; stamp: number }
  | { kind: "complete"; stamp: number }
  | { kind: "error"; error: Error; stamp: number };

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
  let terminal: QueueItem<T> | null = null;
  let isCommitting = false;

  /* ------------------------------------------------------------------------ */
  /* Commit barrier (IDENTICAL to Subject)                                     */
  /* ------------------------------------------------------------------------ */

  const tryCommit = () => {
    if (isCommitting) return;
    isCommitting = true;

    try {
      while (queue.length > 0 && ready.size === receivers.size) {
        const item = queue.shift()!;
        const targets = Array.from(ready);
        ready.clear();

        const stamp = item.stamp;
        let pendingAsync = 0;

        withEmissionStamp(stamp, () => {
          if (item.kind === "next") {
            latestValue = item.value;

            for (const r of targets) {
              const res = r.next(item.value);
              if (isPromiseLike(res)) {
                pendingAsync++;
                res.finally(() => {
                  if (!r.completed && receivers.has(r)) {
                    ready.add(r);
                    tryCommit();
                  }
                });
              } else {
                if (!r.completed && receivers.has(r)) {
                  ready.add(r);
                }
              }
            }
          } else {
            for (const r of targets) {
              item.kind === "complete"
                ? r.complete()
                : r.error(item.error);
            }
            receivers.clear();
            ready.clear();
            queue.length = 0;
            return;
          }
        });

        if (pendingAsync > 0) break;
      }
    } finally {
      isCommitting = false;
    }
  };

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
    terminal = item;
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
    terminal = item;
    queue.push(item);
    tryCommit();
  };

  /* ------------------------------------------------------------------------ */
  /* Subscription                                                             */
  /* ------------------------------------------------------------------------ */

  const register = (receiver: Receiver<T>): Subscription => {
    const r = receiver as StrictReceiver<T>;

    if (terminal) {
      withEmissionStamp(terminal.stamp, () => {
        terminal!.kind === "complete"
          ? r.complete()
          : (terminal!.kind === "error" ? r.error(terminal!.error) : void 0);
      });
      return createSubscription();
    }

    receivers.add(r);
    ready.add(r);

    /* ✅ BehaviorSubject semantic:
       emit latest value directly to THIS receiver only */
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

      withEmissionStamp(
        getCurrentEmissionStamp() ?? nextEmissionStamp(),
        () => r.complete()
      );

      tryCommit();
    });
  };


  const subscribe = (cb?: ((v: T) => any) | Receiver<T>) =>
    register(createReceiver(cb));

  /* ------------------------------------------------------------------------ */
  /* Async iterator                                                           */
  /* ------------------------------------------------------------------------ */

  const asyncIterator = (): AsyncIterator<T> => {
    const receiver = createReceiver<T>();

    let pullResolve: ((v: IteratorResult<T>) => void) | null = null;
    let pullReject: ((e: any) => void) | null = null;
    let backpressureResolve: (() => void) | null = null;

    let pending: IteratorResult<T> | null = null;
    let pendingStamp: number | null = null;
    let pendingError: any = null;
    let pendingErrorStamp: number | null = null;

    let sub: Subscription | null = null;

    const iterator: AsyncIterator<T> = {
      next() {
        if (!sub) sub = register(iteratorReceiver);

        if (pendingError) {
          const err = pendingError;
          const stamp = pendingErrorStamp!;
          pendingError = pendingErrorStamp = null;
          setIteratorEmissionStamp(iterator as any, stamp);
          return Promise.reject(err);
        }

        if (pending) {
          const r = pending;
          const stamp = pendingStamp!;
          pending = pendingStamp = null;
          setIteratorEmissionStamp(iterator as any, stamp);

          backpressureResolve?.();
          backpressureResolve = null;

          return Promise.resolve(r);
        }

        return new Promise((res, rej) => {
          pullResolve = res;
          pullReject = rej;
        });
      },

      return() {
        sub?.unsubscribe();
        sub = null;
        pullResolve?.({ done: true, value: undefined });
        pullResolve = pullReject = null;
        backpressureResolve?.();
        backpressureResolve = null;
        return Promise.resolve({ done: true, value: undefined });
      },

      throw(err) {
        sub?.unsubscribe();
        sub = null;
        pullReject?.(err);
        pullResolve = pullReject = null;
        backpressureResolve?.();
        backpressureResolve = null;
        return Promise.reject(err);
      },
    };

    const iteratorReceiver: StrictReceiver<T> = {
      ...receiver,

      next(value: T) {
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();

        if (pullResolve) {
          setIteratorEmissionStamp(iterator as any, stamp);
          pullResolve({ done: false, value });
          pullResolve = pullReject = null;
          return;
        }

        pending = { done: false, value };
        pendingStamp = stamp;

        return new Promise<void>(resolve => {
          backpressureResolve = resolve;
        });
      },

      complete() {
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
        if (pullResolve) {
          setIteratorEmissionStamp(iterator as any, stamp);
          pullResolve({ done: true, value: undefined });
          pullResolve = pullReject = null;
        } else {
          pending = { done: true, value: undefined };
          pendingStamp = stamp;
        }
      },

      error(err) {
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
        if (pullReject) {
          setIteratorEmissionStamp(iterator as any, stamp);
          pullReject(err);
          pullResolve = pullReject = null;
        } else {
          pendingError = err;
          pendingErrorStamp = stamp;
        }
      },
    };

    return iterator;
  };

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
