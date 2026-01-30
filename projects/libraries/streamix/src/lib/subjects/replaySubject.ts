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
  type Subscription,
} from "../abstractions";
import { firstValueFrom } from "../converters";
import {
  createAsyncIterator,
  createRegister,
  createTryCommit,
  type QueueItem,
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

  const tryCommit = createTryCommit<T>({
    receivers,
    ready,
    queue,
    setLatestValue,
    ownerId: id,
  });

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
    createSubscription,
    tryCommit,
  });

  const next = (value: T) => {
    if (isCompleted) return;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    setLatestValue(value);
    pushReplay(value, stamp);
    queue.push({ kind: "next", value: value as any, stamp } as QueueItem<T>);
    scheduler.enqueue(tryCommit);
  };

  const complete = () => {
    if (isCompleted) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    const item = { kind: "complete", stamp } as QueueItem<T>;
    terminalRef.current = item;
    queue.push(item);
    scheduler.enqueue(tryCommit);
  };

  const error = (err: any) => {
    if (isCompleted) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    const wrappedError = err instanceof Error ? err : new Error(String(err));
    const item = { kind: "error", error: wrappedError, stamp } as QueueItem<T>;
    terminalRef.current = item;
    queue.push(item);
    scheduler.enqueue(tryCommit);
  };

  const deliverReplayAsync = async (
    r: StrictReceiver<T>,
    snapshot: ReplayItem<T>[],
    isActive: () => boolean,
    onDone?: () => void
  ) => {
    let index = 0;
    while (index < snapshot.length) {
      if (!isActive() || r.completed) break;
      const it = snapshot[index++];
      const result = withEmissionStamp(it.stamp, () => r.next(it.value));
      if (result && typeof (result as any).then === "function") {
        await result;
      }
    }
    onDone?.();
  };

  const registerWithReplay = (r: StrictReceiver<T>): Subscription => {
    const snapshot = replay.slice();
    const terminal = terminalRef.current;

    // Late subscribers should get replay values (snapshot) first, then terminal.
    // createRegister's terminal fast-path completes immediately, so we bypass it.
    if (terminal) {
      let active = true;
      const sub = createSubscription(() => {
        active = false;
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
        return withEmissionStamp(stamp, () => r.complete());
      });

      // Deliver replay with backpressure support
      deliverReplayAsync(
        r,
        snapshot,
        () => active,
        () => {
          if (active && !r.completed) {
            deliverTerminal(r, terminal);
          }
        }
      );

      return sub;
    }

    // Normal registration. Pass 'true' to start paused (not in ready set)
    // so live updates form a queue until we replay everything.
    const sub = register(r, snapshot.length > 0);

    if (snapshot.length > 0) {
      // Deliver replay with backpressure support
      deliverReplayAsync(
        r,
        snapshot,
        () => !r.completed && receivers.has(r),
        () => {
          if (!sub.unsubscribed) {
            ready.add(r);
            tryCommit();
          }
        }
      );
    }

    return sub;
  };

  const subscribe = (
    cb?: ((value: T) => any) | Receiver<T>
  ): Subscription => {
    const r = createReceiver(cb) as StrictReceiver<T>;
    return registerWithReplay(r);
  };

  return {
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
    [Symbol.asyncIterator]: createAsyncIterator({
      register: (r) => registerWithReplay(r as StrictReceiver<T>),
    }),
  } as ReplaySubject<T>;
}
