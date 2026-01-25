import {
  createReceiver,
  createSubscription,
  DONE,
  generateStreamId,
  getCurrentEmissionStamp,
  nextEmissionStamp,
  pipeSourceThrough,
  setIteratorEmissionStamp,
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
    // Note: Replay buffer is populated during tryCommit to ensure 
    // it reflects actual delivered values and stamps.
    pushReplay(v, getCurrentEmissionStamp() ?? nextEmissionStamp());
  };

  const tryCommit = createTryCommit<T>({ receivers, ready, queue, setLatestValue });

  // Replay helper that respects backpressure and is scheduled
  const replayToReceiver = (r: StrictReceiver<T>, index: number) => {
    if (index >= replay.length || r.completed || !receivers.has(r)) {
      ready.add(r);
      tryCommit();
      return;
    }

    const item = replay[index];
    // Delivery happens in a scheduler task
    scheduler.enqueue(() => {
      if (r.completed || !receivers.has(r)) return;
      
      const res = r.next(item.value);
      if (res instanceof Promise) {
        res.finally(() => replayToReceiver(r, index + 1));
      } else {
        replayToReceiver(r, index + 1);
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
    scheduler.enqueue(() => {
      if (isCompleted) return;
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

  const replayToReceiverThenTerminal = (
    r: StrictReceiver<T>,
    index: number,
    terminal: QueueItem<T>
  ) => {
    if (index >= replay.length || r.completed || !receivers.has(r)) {
      // Replay done, now deliver terminal
      scheduler.enqueue(() => {
        if (r.completed || !receivers.has(r)) return;

        if (terminal.kind === 'complete') {
          r.complete?.();
        } else if (terminal.kind === 'error') {
          r.error?.(terminal.error);
        }
      });
      return;
    }

    const item = replay[index];
    scheduler.enqueue(() => {
      if (r.completed || !receivers.has(r)) return;

      const res = r.next(item.value);
      if (res instanceof Promise) {
        res.finally(() => replayToReceiverThenTerminal(r, index + 1, terminal));
      } else {
        replayToReceiverThenTerminal(r, index + 1, terminal);
      }
    });
  };

  const subscribe = (cb?: ((value: T) => any) | Receiver<T>): Subscription => {
    const r = createReceiver(cb) as StrictReceiver<T>;

    // For terminated subjects with replay buffer, handle specially
    if (terminalRef.current && replay.length > 0) {
      // Don't use register() yet - manually add to receivers
      receivers.add(r);

      const sub = createSubscription(() => {
        receivers.delete(r);
        ready.delete(r);
        tryCommit();
      });

      // Replay values, then deliver terminal
      replayToReceiverThenTerminal(r, 0, terminalRef.current);
      return sub;
    }

    // Normal registration
    const sub = register(r);

    if (replay.length > 0) {
      ready.delete(r);
      replayToReceiver(r, 0);
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

    let pullResolve: ((v: IteratorResult<T>) => void) | null = null;
    let pullReject: ((e: any) => void) | null = null;
    const localQueue: Array<{ result: IteratorResult<T>; stamp: number }> = [];
    const backpressureQueue: Array<() => void> = [];
    let pendingError: { err: any; stamp: number } | null = null;
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

        if (completed) return Promise.resolve(DONE);

        return new Promise((res, rej) => {
          pullResolve = res;
          pullReject = rej;
        });
      },

      async return() {
        completed = true;
        sub?.unsubscribe();
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
        sub?.unsubscribe();
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

    sub = registerLive(iteratorReceiver);
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
