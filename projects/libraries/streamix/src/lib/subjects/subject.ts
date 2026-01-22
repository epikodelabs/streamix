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

export type Subject<T = any> = Stream<T> & {
  next(value: T): void;
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get value(): T | undefined;
};

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

  const register = createRegister<T>({
    receivers,
    ready,
    terminalRef,
    createSubscription: (onUnsubscribe?: () => any) => createSubscription(onUnsubscribe),
    tryCommit,
  });

  const next = (value: T) => {
    if (isCompleted) return;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    queue.push({ kind: 'next', value: value as any, stamp } as QueueItem<T>);
    tryCommit();
  };

  const complete = () => {
    if (isCompleted) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    // Record terminal and enqueue it so current receivers get the terminal
    // delivery via the normal commit loop; also ensure late subscribers
    // observe the terminal immediately via `terminalRef` in `register`.
    terminalRef.current = { kind: 'complete', stamp } as QueueItem<T>;
    queue.push({ kind: 'complete', stamp } as QueueItem<T>);
    tryCommit();
  };

  const error = (err: any) => {
    if (isCompleted) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
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
