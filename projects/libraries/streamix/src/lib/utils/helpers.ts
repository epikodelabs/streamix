import {
    DONE,
    setIteratorEmissionStamp,
} from "../abstractions";

/**
 * Shared queue item structure used across all async iterator implementations
 */
export interface QueueItem<T> {
  result: IteratorResult<T>;
  stamp: number;
}

/**
 * Pending error with timestamp
 */
export interface PendingError {
  err: any;
  stamp: number;
}

/**
 * Core state management for async iterators with pull/push coordination
 */
export class AsyncIteratorState<T> {
  readonly queue: QueueItem<T>[] = [];
  readonly backpressureQueue: Array<() => void> = [];
  
  pullResolve: ((v: IteratorResult<T>) => void) | null = null;
  pullReject: ((e: any) => void) | null = null;
  pendingError: PendingError | null = null;
  completed = false;

  /**
   * Check if there are any buffered values, errors, or completion
   */
  hasBufferedValues(): boolean {
    return this.queue.length > 0 || this.pendingError != null || this.completed;
  }

  /**
   * Clear all pending resolvers and backpressure
   */
  clear(): void {
    if (this.pullResolve) {
      this.pullResolve(DONE);
      this.pullResolve = null;
      this.pullReject = null;
    }
    for (const resolve of this.backpressureQueue) {
      resolve();
    }
    this.backpressureQueue.length = 0;
  }

  /**
   * Mark as completed and clear state
   */
  markCompleted(): void {
    this.completed = true;
    this.clear();
  }

  /**
   * Enqueue a value
   */
  enqueueValue(value: T, stamp: number): void {
    this.queue.push({ 
      result: { done: false, value }, 
      stamp 
    });
  }

  /**
   * Enqueue completion
   */
  enqueueCompletion(stamp: number): void {
    this.queue.push({ 
      result: DONE, 
      stamp 
    });
  }
}

/**
 * Synchronous pull handler - implements __tryNext logic
 */
export function syncPull<T>(
  state: AsyncIteratorState<T>,
  iterator: any,
  onDone?: () => void
): IteratorResult<T> | null {
  // Check queue first
  if (state.queue.length > 0) {
    const { result, stamp } = state.queue.shift()!;
    setIteratorEmissionStamp(iterator, stamp);
    state.backpressureQueue.shift()?.();
    
    if (result.done) {
      onDone?.();
    }
    
    return result;
  }

  // Check pending error
  if (state.pendingError) {
    const { err, stamp } = state.pendingError;
    state.pendingError = null;
    setIteratorEmissionStamp(iterator, stamp);
    throw err;
  }

  // Check completion
  if (state.completed) {
    onDone?.();
    return DONE;
  }

  return null;
}

/**
 * Asynchronous pull handler - implements next() logic
 */
export async function asyncPull<T>(
  state: AsyncIteratorState<T>,
  iterator: any,
  onDone?: () => void
): Promise<IteratorResult<T>> {
  // Sync path: values already queued
  if (state.queue.length > 0) {
    const { result, stamp } = state.queue.shift()!;
    setIteratorEmissionStamp(iterator, stamp);
    state.backpressureQueue.shift()?.();
    
    if (result.done) {
      onDone?.();
    }
    
    return result;
  }

  // Sync path: pending error
  if (state.pendingError) {
    const { err, stamp } = state.pendingError;
    state.pendingError = null;
    setIteratorEmissionStamp(iterator, stamp);
    throw err;
  }

  // Sync path: already completed
  if (state.completed) {
    onDone?.();
    return DONE;
  }

  // Async path: wait for push
  return new Promise((res, rej) => {
    state.pullResolve = res;
    state.pullReject = rej;
  });
}

/**
 * Push a value with backpressure support
 */
export function pushValue<T>(
  state: AsyncIteratorState<T>,
  iterator: any,
  value: T,
  stamp: number,
  onPush?: () => void
): void | Promise<void> {
  if (state.completed) return;

  const result: IteratorResult<T> = { done: false, value };

  // If someone is waiting, resolve immediately
  if (state.pullResolve) {
    const r = state.pullResolve;
    state.pullResolve = state.pullReject = null;
    setIteratorEmissionStamp(iterator, stamp);
    r(result);
    onPush?.();
    return;
  }

  // Otherwise queue it
  state.enqueueValue(value, stamp);

  // If there's a push handler, call it (no backpressure)
  if (onPush) {
    onPush();
    return;
  }

  // Otherwise, return backpressure promise
  return new Promise<void>((resolve) => state.backpressureQueue.push(resolve));
}

/**
 * Push a completion signal
 */
export function pushComplete<T>(
  state: AsyncIteratorState<T>,
  iterator: any,
  stamp: number,
  onPush?: () => void
): void {
  if (state.completed) return;
  state.completed = true;

  // If someone is waiting, resolve immediately
  if (state.pullResolve) {
    const r = state.pullResolve;
    state.pullResolve = state.pullReject = null;
    setIteratorEmissionStamp(iterator, stamp);
    r(DONE);
    return;
  }

  // Otherwise queue it
  state.enqueueCompletion(stamp);
  onPush?.();
}

/**
 * Push an error signal
 */
export function pushError<T>(
  state: AsyncIteratorState<T>,
  iterator: any,
  err: any,
  stamp: number,
  onPush?: () => void
): void {
  if (state.completed) return;
  state.completed = true;

  // If someone is waiting, reject immediately
  if (state.pullReject) {
    const r = state.pullReject;
    state.pullResolve = state.pullReject = null;
    setIteratorEmissionStamp(iterator, stamp);
    r(err);
    return;
  }

  // Otherwise store it
  state.pendingError = { err, stamp };
  onPush?.();
}

/**
 * Helper to insert items in order by stamp
 */
export function insertOrdered<T extends { stamp: number }>(
  arr: T[],
  item: T
): void {
  let i = arr.length;
  while (i > 0 && arr[i - 1].stamp > item.stamp) i--;
  arr.splice(i, 0, item);
}