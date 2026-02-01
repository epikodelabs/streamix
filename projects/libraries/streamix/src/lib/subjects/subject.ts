import {
  createReceiver,
  createSubscription,
  generateStreamId,
  getCurrentEmissionStamp,
  nextEmissionStamp,
  pipeSourceThrough,
  type Operator,
  type Stream,
  type StrictReceiver
} from "../abstractions";
import { firstValueFrom } from "../converters";
import { createAsyncIterator, createRegister, createTryCommit, type QueueItem } from "./helpers";

/**
 * Subject is a hot, multicast stream that allows imperatively pushing values
 * with `next`, signalling completion with `complete`, or errors with
 * `error`. It implements `Stream<T>` and exposes the current value via
 * the `value` getter when available.
 *
 * @template T
 */
export type Subject<T = any> = Stream<T> & {
  next(value: T): void;
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get value(): T | undefined;
};

/**
 * Create a plain `Subject` which buffers emissions and delivers them to
 * current subscribers. The returned subject can be used as an async
 * iterable and as an imperative emitter via `next`/`complete`/`error`.
 *
 * @template T
 * @returns {Subject<T>} A new subject instance.
 */
export function createSubject<T = any>(): Subject<T> {
  const id = generateStreamId();
  let latestValue: T | undefined;
  let isCompleted = false;

  const receivers = new Set<StrictReceiver<T>>();
  const ready = new Set<StrictReceiver<T>>();
  const queue: QueueItem<T>[] = [];
  const terminalRef: { current: QueueItem<T> | null } = { current: null };

  const setLatestValue = (v: T) => (latestValue = v);

  const tryCommit = createTryCommit<T>({ receivers, ready, queue, setLatestValue });

  /**
   * Register a receiver to receive emissions from the Subject.
   * Handles replaying the current value and terminal state if needed.
   *
   * @param receiver The receiver to register.
   * @returns {Subscription} Subscription object for unsubscription.
   */
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
    queue.push({ kind: 'next', value: value as any, stamp } as QueueItem<T>);
    tryCommit();
  };

  const complete = () => {
    if (isCompleted) return;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    isCompleted = true;
    terminalRef.current = { kind: 'complete', stamp } as QueueItem<T>;
    queue.push({ kind: 'complete', stamp } as QueueItem<T>);
    tryCommit();
  };

  const error = (err: any) => {
    if (isCompleted) return;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    isCompleted = true;
    terminalRef.current = { kind: 'error', error: err, stamp } as QueueItem<T>;
    queue.push({ kind: 'error', error: err, stamp } as QueueItem<T>);
    tryCommit();
  };

  return {
    type: "subject",
    name: "subject",
    id,
    get value() { return latestValue; },
    pipe(...steps: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, steps);
    },
    subscribe: (cb) => register(createReceiver(cb)),
    async query(): Promise<T> { return firstValueFrom(this); },
    next,
    complete,
    error,
    completed: () => isCompleted,
    [Symbol.asyncIterator]: createAsyncIterator({ register })
  } as Subject<T>;
}
