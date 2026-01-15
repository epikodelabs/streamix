import {
  createReceiver,
  createSubscription,
  generateStreamId,
  getCurrentEmissionStamp,
  nextEmissionStamp,
  pipeSourceThrough,
  type Operator,
  type Receiver,
  type Stream,
  type StrictReceiver
} from "../abstractions";
import { firstValueFrom } from "../converters";
import {
  createAsyncIterator,
  createRegister,
  createTryCommit,
  type QueueItem,
} from "./helpers";

/* ========================================================================== */
/* Subject                                                                    */
/* ========================================================================== */

/**
 * Hot stream that exposes the full `Stream` contract while also allowing
 * values, errors, or completion to be pushed imperatively.
 *
 * @template T Value type emitted by the subject.
 */
export type Subject<T = any> = Stream<T> & {
  next(value?: T): void;
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get value(): T | undefined;
};

/**
 * Create a bare subject that immediately forwards pushes to every active
 * subscriber and retains the most recent value for late subscribers.
 *
 * @template T Value type carried by the subject.
 */
export function createSubject<T = any>(): Subject<T> {
  const id = generateStreamId();

  const receivers = new Set<StrictReceiver<T>>();
  const ready = new Set<StrictReceiver<T>>();
  const queue: QueueItem<T>[] = [];

  let latestValue: T | undefined;
  let isCompleted = false;
  // Store terminal state for late subscribers (wrapped ref for helpers)
  const terminalRef = { current: null as QueueItem<T> | null };

  /* ------------------------------------------------------------------------ */
  /* Commit barrier (stamp-ordered, terminal-aware)                           */
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

  const next = (value?: T) => {
    if (isCompleted) return;

    // OPTIONAL: If you want Hot Subject behavior (drop if no listeners),
    // uncomment the check below. Current behavior behaves like an infinite ReplaySubject until first sub.
    // if (receivers.size === 0) return; 

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
    const item = { kind: "complete", stamp } as QueueItem<T>;
    terminalRef.current = item;
    queue.push(item);
    tryCommit();
  };

  const error = (err: any) => {
    if (isCompleted) return;
    isCompleted = true;

    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    const errorValue = err instanceof Error ? err : new Error(String(err));

    const item = { kind: "error", error: errorValue, stamp } as QueueItem<T>;
    terminalRef.current = item;
    queue.push(item);
    tryCommit();
  };

  /* ------------------------------------------------------------------------ */
  /* Subscription                                                             */
  /* ------------------------------------------------------------------------ */

  const register = createRegister<T>({
    receivers,
    ready,
    terminalRef,
    createSubscription,
    tryCommit,
  });

  const subscribe = (cb?: ((value: T) => any) | Receiver<T>) =>
    register(createReceiver(cb));

  /* ------------------------------------------------------------------------ */
  /* Async iterator                                                           */
  /* ------------------------------------------------------------------------ */

  const asyncIterator = createAsyncIterator<T>({ register });

  const subject: Subject<T> = {
    type: "subject",
    name: "subject",
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
    [Symbol.asyncIterator]: asyncIterator,
  };

  return subject;
}
