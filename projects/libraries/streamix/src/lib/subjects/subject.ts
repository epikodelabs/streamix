import {
  createReceiver,
  createSubscription,
  generateStreamId,
  getCurrentEmissionStamp,
  nextEmissionStamp,
  pipeSourceThrough,
  scheduler,
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

export function createSubject<T = any>(options?: { scheduleCommit?: (commitFn: () => void) => void }): Subject<T> {
  const id = generateStreamId();
  let latestValue: T | undefined;
  let isCompleted = false;

  const receivers = new Set<StrictReceiver<T>>();
  const ready = new Set<StrictReceiver<T>>();
  const queue: QueueItem<T>[] = [];
  const terminalRef: { current: QueueItem<T> | null } = { current: null };

  const setLatestValue = (v: T) => (latestValue = v);

  const tryCommit = createTryCommit<T>({ 
    receivers, 
    ready, 
    queue, 
    setLatestValue, 
    ownerId: id,
    scheduleCommit: options?.scheduleCommit
  });

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
    scheduler.enqueue(tryCommit);
  };

  const complete = () => {
    if (isCompleted) return;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    isCompleted = true;
    terminalRef.current = { kind: 'complete', stamp } as QueueItem<T>;
    queue.push({ kind: 'complete', stamp } as QueueItem<T>);
    scheduler.enqueue(tryCommit);
  };

  const error = (err: any) => {
    if (isCompleted) return;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    isCompleted = true;
    const wrappedError = err instanceof Error ? err : new Error(String(err));
    terminalRef.current = { kind: 'error', error: wrappedError, stamp } as QueueItem<T>;
    queue.push({ kind: 'error', error: wrappedError, stamp } as QueueItem<T>);
    scheduler.enqueue(tryCommit);
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
