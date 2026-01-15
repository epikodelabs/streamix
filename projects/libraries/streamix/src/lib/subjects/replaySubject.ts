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
  type Stream,
  type StrictReceiver,
  type Subscription,
} from "../abstractions";
import { firstValueFrom } from "../converters";
import {
  createTryCommit,
  QueueItem
} from "./helpers";
import type { Subject } from "./subject";

/* ========================================================================== */
/* ReplaySubject                                                              */
/* ========================================================================== */

type ReplayItem<T> = { value: T; stamp: number };

/**
 * Subject that retains a buffer of past emissions so new subscribers receive
 * the most recent values in order before shifting into live mode.
 *
 * @template T Value type replayed to late subscribers.
 */
export type ReplaySubject<T = any> = Subject<T>;

/**
 * Construct a `ReplaySubject` with an optional buffer `capacity` that limits
 * how many past values are replayed to late subscribers.
 *
 * @template T Value type replayed to subscribers.
 * @param capacity Maximum number of past values stored in the buffer.
 */
export function createReplaySubject<T = any>(
  capacity: number = Infinity
): ReplaySubject<T> {
  const id = generateStreamId();

  const receivers = new Set<StrictReceiver<T>>();
  const ready = new Set<StrictReceiver<T>>();
  const queue: QueueItem<T>[] = [];

  const replay: ReplayItem<T>[] = [];

  let latestValue: T | undefined = undefined;
  let isCompleted = false;
  const terminalRef = { current: null as QueueItem<T> | null };

  /* ------------------------------------------------------------------------ */
  /* Helpers                                                                  */
  /* ------------------------------------------------------------------------ */

  const pushReplay = (value: T, stamp: number) => {
    replay.push({ value, stamp });
    if (replay.length > capacity) replay.shift();
  };
  
  /* Cursor-based replay for async receivers (needed if any replay step returns a Promise) */
  const replayWithCursor = (
    r: StrictReceiver<T>,
    startIndex: number,
    onDone: () => void
  ) => {
    if (r.completed) return onDone();

    const step = (i: number) => {
      if (r.completed) return onDone();
      if (i >= replay.length) return onDone();

      const it = replay[i];
      let res: any;

      withEmissionStamp(it.stamp, () => {
        res = r.next(it.value);
      });

      if (isPromiseLike(res)) {
        ready.delete(r);
        res.finally(() => {
          if (!r.completed && receivers.has(r)) {
            ready.add(r);
          }
          step(i + 1);
          tryCommit();
        });
      } else {
        step(i + 1);
      }
    };

    step(startIndex);
  };

  const deliverTerminalToReceiver = (r: StrictReceiver<T>, t: QueueItem<T>) => {
    withEmissionStamp(t.stamp, () => {
      if (t.kind === "complete") r.complete();
      else if (t.kind === "error") r.error(t.error);
    });
  };

  /* ------------------------------------------------------------------------ */
  /* Commit barrier (same as Subject for LIVE values)                          */
  /* ------------------------------------------------------------------------ */

  const setLatestValue = (v: T) => {
    latestValue = v;
    // Also push into replay buffer
    pushReplay(v, getCurrentEmissionStamp() ?? nextEmissionStamp());
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

  const next = (value?: T) => {
    if (isCompleted) return;

    const current = getCurrentEmissionStamp();
    const base = current ?? nextEmissionStamp();
    const stamp = current === null ? -base : base;

    queue.push({ kind: "next", value: value as T, stamp });
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
    // Late subscriber: replay buffer then terminal, just for this receiver.
    const term = terminalRef.current;
    if (term) {
      // Replay should not depend on being in receivers set.
      // Still respect async receivers by cursor replay.
      const startLen = replay.length;
      // Fast sync path
      let allSync = true;
      for (let i = 0; i < startLen; i++) {
        const it = replay[i];
        let res: any;
        withEmissionStamp(it.stamp, () => {
          res = r.next(it.value);
        });
        if (isPromiseLike(res)) {
          allSync = false;
          const capturedTerm = term;
          res.finally(() => {
            // continue remaining replay, then deliver terminal
            replayWithCursor(r, i + 1, () => deliverTerminalToReceiver(r, capturedTerm!));
          });
          break;
        }
      }
      if (allSync) {
        deliverTerminalToReceiver(r, term);
      }
      return createSubscription();
    }

    receivers.add(r);
    ready.add(r);

    // Replay existing buffered values to THIS receiver only.
    // If any replay step is async, use cursor replay to finish, and mark readiness accordingly.
    if (replay.length > 0) {
      // Attempt sync replay first
      let cursor = 0;
      for (; cursor < replay.length; cursor++) {
        const it = replay[cursor];
        let res: any;
        withEmissionStamp(it.stamp, () => {
          res = r.next(it.value);
        });

        if (isPromiseLike(res)) {
          ready.delete(r);
          const startFrom = cursor + 1;
          res.finally(() => {
            if (!r.completed && receivers.has(r)) ready.add(r);
            replayWithCursor(r, startFrom, () => {
              // when replay finishes, ensure commit can resume
              if (!r.completed && receivers.has(r)) ready.add(r);
              tryCommit();
            });
          });
          break;
        }
      }
    }

    tryCommit();

    return createSubscription(() => {
      receivers.delete(r);
      ready.delete(r);

      const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
      withEmissionStamp(stamp, () => r.complete());

      tryCommit();
    });
  };

  const subscribe = (cb?: ((value: T) => any) | Receiver<T>) =>
    register(createReceiver(cb));

  /* ------------------------------------------------------------------------ */
  /* Async iterator (same as Subject)                                         */
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
          pendingError = null;
          pendingErrorStamp = null;
          setIteratorEmissionStamp(iterator as any, stamp);
          return Promise.reject(err);
        }

        if (pending) {
          const r = pending;
          const stamp = pendingStamp!;
          pending = null;
          pendingStamp = null;
          setIteratorEmissionStamp(iterator as any, stamp);

          if (backpressureResolve) {
            const resolve = backpressureResolve;
            backpressureResolve = null;
            resolve();
          }

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

        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          r({ done: true, value: undefined });
        }

        if (backpressureResolve) {
          backpressureResolve();
          backpressureResolve = null;
        }

        return Promise.resolve({ done: true, value: undefined });
      },

      throw(err) {
        sub?.unsubscribe();
        sub = null;

        if (pullReject) {
          const r = pullReject;
          pullResolve = pullReject = null;
          r(err);
        }

        if (backpressureResolve) {
          backpressureResolve();
          backpressureResolve = null;
        }

        return Promise.reject(err);
      },
    };

    const iteratorReceiver: StrictReceiver<T> = {
      ...receiver,

      next(value: T) {
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();

        if (pullResolve) {
          setIteratorEmissionStamp(iterator as any, stamp);
          const r = pullResolve;
          pullResolve = pullReject = null;
          r({ done: false, value });
          return;
        }

        pending = { done: false, value };
        pendingStamp = stamp;

        return new Promise<void>((resolve) => {
          backpressureResolve = resolve;
        });
      },

      complete() {
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
        if (pullResolve) {
          setIteratorEmissionStamp(iterator as any, stamp);
          const r = pullResolve;
          pullResolve = pullReject = null;
          r({ done: true, value: undefined });
          return;
        }
        pending = { done: true, value: undefined };
        pendingStamp = stamp;
      },

      error(err) {
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
        if (pullReject) {
          setIteratorEmissionStamp(iterator as any, stamp);
          const r = pullReject;
          pullResolve = pullReject = null;
          r(err);
          return;
        }
        pendingError = err;
        pendingErrorStamp = stamp;
      },
    };

    return iterator;
  };

  /* ------------------------------------------------------------------------ */
  /* Public API                                                               */
  /* ------------------------------------------------------------------------ */

  const subject: ReplaySubject<T> = {
    type: "subject",
    name: "replaySubject",
    id,
    get value() {
      return latestValue;
    },
    pipe(...steps: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, steps);
    },
    subscribe,
    async query(): Promise<T> {
      return firstValueFrom(this);
    },
    next,
    complete,
    error,
    completed: () => isCompleted,
    [Symbol.asyncIterator]: asyncIterator,
  };

  return subject;
}
