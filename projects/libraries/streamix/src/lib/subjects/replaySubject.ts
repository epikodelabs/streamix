import {
  createReceiver,
  createSubscription,
  DONE,
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
  type Subscription
} from "../abstractions";
import { scheduler } from "../abstractions/scheduler";
import { firstValueFrom } from "../converters";
import {
  createRegister,
  createTryCommit,
  type QueueItem
} from "./helpers";
import type { Subject } from "./subject";

type ReplayItem<T> = { value: T; stamp: number };

export type ReplaySubject<T = any> = Subject<T>;

export function createReplaySubject<T = any>(
  capacity: number = Infinity
): ReplaySubject<T> {
  const id = generateStreamId();
  let latestValue: T | undefined;
  let isCompleted = false;

  const receivers = new Set<StrictReceiver<T>>();
  const ready = new Set<StrictReceiver<T>>();
  const queue: QueueItem<T>[] = [];
  const replay: ReplayItem<T>[] = [];
  const terminalRef: { current: QueueItem<T> | null } = { current: null };

  const pushReplay = (value: T, stamp: number) => {
    replay.push({ value, stamp });
    if (replay.length > capacity) {
      replay.shift();
    }
  };

  const setLatestValue = (v: T) => {
    latestValue = v;
  };

  const tryCommit = createTryCommit<T>({ receivers, ready, queue, setLatestValue });

  const deliverTerminal = (r: StrictReceiver<T>, terminal: QueueItem<T>) => {
    withEmissionStamp(terminal.stamp, () => {
      if (terminal.kind === "complete") {
        r.complete();
        return;
      }
      if (terminal.kind === "error") {
        r.error(terminal.error);
      }
    });
  };

  const register = createRegister<T>({
    receivers,
    ready,
    terminalRef,
    createSubscription: (onUnsubscribe?: () => any) => {
      return createSubscription(async () => {
        if (onUnsubscribe) {
          return scheduler.enqueue(() => onUnsubscribe());
        }
      });
    },
    tryCommit,
  });

  const next = (value: T) => {
    if (isCompleted) return;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    // Keep `.value` in sync with the latest producer call (tests expect this
    // synchronously, even though delivery is scheduled).
    setLatestValue(value);
    pushReplay(value, stamp);
    scheduler.enqueue(() => {
      queue.push({ kind: 'next', value: value as any, stamp } as QueueItem<T>);
      tryCommit();
    });
  };

  const complete = () => {
    if (isCompleted) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    const item = { kind: 'complete', stamp } as QueueItem<T>;
    terminalRef.current = item;
    scheduler.enqueue(() => {
      queue.push(item);
      tryCommit();
    });
  };

  const error = (err: any) => {
    if (isCompleted) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    const item = { kind: 'error', error: err, stamp } as QueueItem<T>;
    terminalRef.current = item;
    scheduler.enqueue(() => {
      queue.push(item);
      tryCommit();
    });
  };

  const subscribe = (cb?: ((value: T) => any) | Receiver<T>): Subscription => {
    const r = createReceiver(cb) as StrictReceiver<T>;
    const snapshot = replay.slice();
    const terminal = terminalRef.current;

    // Late subscribers should get replay values (snapshot) first, then terminal.
    // createRegister's terminal fast-path completes immediately, so we bypass it.
    if (terminal) {
      let active = true;
      const sub = createSubscription(() => {
        active = false;
        return r.complete();
      });

      void scheduler.enqueue(async () => {
        for (const it of snapshot) {
          if (!active || r.completed) return;
          const res = withEmissionStamp(it.stamp, () => r.next(it.value));
          if (isPromiseLike(res)) await res;
        }

        if (!active || r.completed) return;
        deliverTerminal(r, terminal);
      });

      return sub;
    }

    // Normal registration
    const sub = register(r);

    if (snapshot.length > 0) {
      // Block live delivery until replay finishes to avoid interleaving.
      ready.delete(r);

      void scheduler.enqueue(async () => {
        for (const it of snapshot) {
          if (r.completed || !receivers.has(r)) return;
          const res = withEmissionStamp(it.stamp, () => r.next(it.value));
          if (isPromiseLike(res)) await res;
        }

        if (r.completed || !receivers.has(r)) return;
        ready.add(r);
        tryCommit();
      });
    }

    return sub;
  };

  // Iterator needs deterministic ordering: yield buffered replay values first,
  // then consume only live emissions (no replay re-entry).
  const registerLive = (r: StrictReceiver<T>): Subscription => {
    // Mark subscription moment so live delivery doesn't include earlier emissions.
    (r as any).subscribedAt = nextEmissionStamp();
    receivers.add(r);
    ready.add(r);
    tryCommit();

    return createSubscription(() => {
      receivers.delete(r);
      ready.delete(r);
      tryCommit();
    });
  };

  const asyncIterator = (): AsyncIterator<T> & {
    __tryNext?: () => IteratorResult<T> | null;
    __hasBufferedValues?: () => boolean;
    __onPush?: () => void;
  } => {
    const replayStart =
      capacity === Infinity ? 0 : Math.max(0, replay.length - capacity);
    const snapshot = replay.slice(replayStart);
    const terminal = terminalRef.current;

    let pullResolve: ((v: IteratorResult<T>) => void) | null = null;
    let pullReject: ((e: any) => void) | null = null;
    const localQueue: Array<{ result: IteratorResult<T>; stamp: number }> = [];
    const backpressureQueue: Array<() => void> = [];
    let pendingError: { err: any; stamp: number } | null = null;
    let terminalError: { err: any; stamp: number } | null = null;
    let completed = false;
    let sub: Subscription | null = null;

    const iterator: any = {
      next() {
        if (pendingError) {
          const { err, stamp } = pendingError;
          pendingError = null;
          setIteratorEmissionStamp(iterator, stamp);
          return Promise.reject(err);
        }

        if (localQueue.length > 0) {
          const { result, stamp } = localQueue.shift()!;
          setIteratorEmissionStamp(iterator, stamp);
          backpressureQueue.shift()?.();
          return Promise.resolve(result);
        }

        if (terminalError) {
          const { err, stamp } = terminalError;
          terminalError = null;
          setIteratorEmissionStamp(iterator, stamp);
          return Promise.reject(err);
        }

        if (completed) return Promise.resolve(DONE);

        return new Promise((res, rej) => {
          pullResolve = res;
          pullReject = rej;
        });
      },

      async return() {
        completed = true;
        await sub?.unsubscribe();
        sub = null;

        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          r(DONE);
        }

        for (const resolve of backpressureQueue) resolve();
        backpressureQueue.length = 0;

        return DONE;
      },

      async throw(err: any) {
        completed = true;
        await sub?.unsubscribe();
        sub = null;

        if (pullReject) {
          const r = pullReject;
          pullResolve = pullReject = null;
          r(err);
        }

        for (const resolve of backpressureQueue) resolve();
        backpressureQueue.length = 0;

        throw err;
      },

      [Symbol.asyncIterator]() {
        return this;
      },
    };

    iterator.__hasBufferedValues = () =>
      localQueue.length > 0 || pendingError != null || completed;

    iterator.__tryNext = () => {
      if (pendingError) {
        const { err, stamp } = pendingError;
        pendingError = null;
        setIteratorEmissionStamp(iterator, stamp);
        throw err;
      }

      if (localQueue.length > 0) {
        const { result, stamp } = localQueue.shift()!;
        setIteratorEmissionStamp(iterator, stamp);
        backpressureQueue.shift()?.();
        return result;
      }

      return completed ? DONE : null;
    };

    const iteratorReceiver: StrictReceiver<T> = {
      next(value: T) {
        if (completed) return;
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
        const result: IteratorResult<T> = { done: false, value };

        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          setIteratorEmissionStamp(iterator, stamp);
          r(result);
          return;
        }

        localQueue.push({ result, stamp });
        iterator.__onPush?.();
        return new Promise<void>((resolve) => backpressureQueue.push(resolve));
      },
      complete() {
        if (completed) return;
        completed = true;
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();

        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          setIteratorEmissionStamp(iterator, stamp);
          r(DONE);
          return;
        }

        localQueue.push({ result: DONE, stamp });
        iterator.__onPush?.();
      },
      error(err) {
        if (completed) return;
        completed = true;
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();

        if (pullReject) {
          const r = pullReject;
          pullResolve = pullReject = null;
          setIteratorEmissionStamp(iterator, stamp);
          r(err);
          return;
        }

        pendingError = { err, stamp };
        iterator.__onPush?.();
      },
      get completed() {
        return completed;
      },
    };

    // Seed replay snapshot first (stable ordering).
    for (const it of snapshot) {
      localQueue.push({ result: { done: false, value: it.value }, stamp: it.stamp });
    }

    if (terminal) {
      if (terminal.kind === "complete") {
        completed = true;
      } else if (terminal.kind === "error") {
        terminalError = { err: terminal.error, stamp: terminal.stamp };
        completed = true;
      }
    } else {
      sub = registerLive(iteratorReceiver);
    }
    return iterator;
  };

  
  return {
    type: "subject",
    name: "replaySubject",
    id,
    get value() { return latestValue; },
    pipe(...steps: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, steps);
    },
    subscribe,
    async query(): Promise<T> { return firstValueFrom(this); },
    next,
    complete,
    error,
    completed: () => isCompleted,
    [Symbol.asyncIterator]: asyncIterator
  } as ReplaySubject<T>;
}
