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

type ReplayItem<T> = { value: T; stamp: number };

/**
 * A subject that replays buffered emissions to new subscribers before continuing
 * with live delivery. The buffering logic preserves insertion order, stamps each
 * value to maintain deterministic delivery when mixing synchronous and
 * asynchronous receiver handlers, and prevents replay from mutating the live
 * queue state.
 */
export type ReplaySubject<T = any> = Subject<T>;

/**
 * Constructs a replay subject whose buffer is limited to `capacity` entries.
 * Late subscribers see the last `capacity` emissions in chronological order
 * (or every emission when `capacity` is `Infinity`) before the subject switches
 * to the live commit queue. Buffer population and terminal delivery reuse the
 * same emission stamps as the live queue, ensuring iterator consumers observe
 * consistent timestamps from replayed and live events.
 *
 * @param capacity Maximum number of past values retained for replay; defaults
 *   to `Infinity` for an unbounded history.
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

  const pushReplay = (value: T, stamp: number) => {
    replay.push({ value, stamp });
    if (replay.length > capacity) {
      replay.shift();
    }
  };
  
  const replayWithCursor = (
    r: StrictReceiver<T>,
    startIndex: number,
    onDone: () => void
  ) => {
    const step = (i: number) => {
      if (r.completed || !receivers.has(r)) return onDone();
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
            replayWithCursor(r, i + 1, onDone);
          } else {
            onDone();
          }
        });
      } else {
        if (!receivers.has(r)) {
          return onDone();
        }
        step(i + 1);
      }
    };

    if (r.completed || !receivers.has(r)) return onDone();
    step(startIndex);
  };

  const deliverTerminalToReceiver = (r: StrictReceiver<T>, t: QueueItem<T>) => {
    withEmissionStamp(t.stamp, () => {
      if (t.kind === "complete") r.complete();
      else if (t.kind === "error") r.error(t.error);
    });
  };

  const setLatestValue = (v: T) => {
    latestValue = v;
    pushReplay(v, getCurrentEmissionStamp() ?? nextEmissionStamp());
  };

  const tryCommit = createTryCommit<T>({
    receivers,
    ready,
    queue,
    setLatestValue,
  });

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

  const register = (receiver: Receiver<T>): Subscription => {
    const r = receiver as StrictReceiver<T>;
    const term = terminalRef.current;
    if (term) {
      const replayStart = capacity === Infinity ? 0 : Math.max(0, replay.length - capacity);
      const cleanup = () => {
        receivers.delete(r);
        ready.delete(r);
      };

      const deliverTerminal = () => {
        cleanup();
        deliverTerminalToReceiver(r, term);
      };

      receivers.add(r);
      ready.add(r);

      replayWithCursor(r, replayStart, deliverTerminal);

      return createSubscription(cleanup);
    }

    receivers.add(r);
    ready.add(r);

    if (replay.length > 0) {
      const replayStart = capacity === Infinity ? 0 : Math.max(0, replay.length - capacity);
      for (let cursor = replayStart; cursor < replay.length; cursor++) {
        if (!receivers.has(r)) {
          break;
        }
        const it = replay[cursor];
        let res: any;
        withEmissionStamp(it.stamp, () => {
          res = r.next(it.value);
        });

        if (isPromiseLike(res)) {
          ready.delete(r);
          const startFrom = cursor + 1;
          res.finally(() => {
            if (receivers.has(r)) {
              ready.add(r);
              replayWithCursor(r, startFrom, () => {
                if (receivers.has(r)) {
                  ready.add(r);
                }
                tryCommit();
              });
            } else {
              tryCommit();
            }
          });
          break;
        }

        if (!receivers.has(r)) {
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
