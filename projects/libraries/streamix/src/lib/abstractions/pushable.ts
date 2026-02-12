import {
  getCurrentEmissionStamp,
  nextEmissionStamp,
  setIteratorEmissionStamp
} from "./emission";
import { IteratorMetaKind, setIteratorMeta, setValueMeta } from "./hooks";
import { DONE } from "./operator";
import { StrictReceiver } from "./receiver";


/**
 * Async iterator augmented with push methods, passed to operator setup callbacks.
 */
export type AsyncPushable<R> = AsyncIterator<R> & AsyncIterable<R> & {
  push(
    value: R,
    meta?: { valueId: string; operatorIndex: number; operatorName: string },
    tag?: { kind?: IteratorMetaKind; inputValueIds?: string[] }
  ): void;
  error(err: any): void;
  complete(): void;
  completed(): boolean;
};

/**
 * Tags a value with iterator metadata.
 */
function tagValue<T>(
  iterator: AsyncIterator<any>,
  value: T,
  meta: { valueId: string; operatorIndex: number; operatorName: string } | undefined,
  tag?: { kind?: IteratorMetaKind; inputValueIds?: string[] }
): T {
  if (!meta) return value;
  const metaTag = { valueId: meta.valueId, ...tag };
  setIteratorMeta(iterator, metaTag, meta.operatorIndex, meta.operatorName);
  return setValueMeta(value, metaTag, meta.operatorIndex, meta.operatorName);
}

/**
 * Creates an `AsyncPushable` - an async iterator that you can manually
 * push values into with backpressure.
 */
export function createAsyncPushable<R>(): AsyncPushable<R> {
  // Core state
  let pullResolve: ((v: IteratorResult<R>) => void) | null = null;
  let pullReject: ((e: any) => void) | null = null;
  const queue: Array<{ result: IteratorResult<R>; stamp: number }> = [];
  const backpressureQueue: Array<() => void> = [];
  let pendingError: { err: any; stamp: number } | null = null;
  let completed = false;

  // Create the receiver that will handle pushes
  const receiver: StrictReceiver<R> = {
    next(value: R) {
      if (completed) return;
      
      const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
      const result: IteratorResult<R> = { done: false, value };
      
      if (pullResolve) {
        const r = pullResolve;
        pullResolve = pullReject = null;
        setIteratorEmissionStamp(iterator, stamp);
        r(result);
        iterator.__onPush?.();
        return;
      }
      
      queue.push({ result, stamp });
      
      if (typeof iterator.__onPush === "function") {
        iterator.__onPush();
        return;
      }
      
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
      
      queue.push({ result: DONE, stamp });
      iterator.__onPush?.();
    },
    
    error(err: any) {
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
    }
  };

  // Create the iterator
  const iterator: AsyncIterator<R> & {
    [Symbol.asyncIterator]?: () => AsyncIterator<R>;
    __tryNext?: () => IteratorResult<R> | null;
    __hasBufferedValues?: () => boolean;
    __onPush?: () => void;
    push?: any;
    error?: any;
    complete?: any;
    completed?: any;
  } = {
    next() {
      
      // Sync path: values already queued
      if (queue.length > 0) {
        const { result, stamp } = queue.shift()!;
        setIteratorEmissionStamp(iterator, stamp);
        backpressureQueue.shift()?.();
        return Promise.resolve(result);
      }
      
      // Sync path: pending error
      if (pendingError) {
        const { err, stamp } = pendingError;
        pendingError = null;
        setIteratorEmissionStamp(iterator, stamp);
        return Promise.reject(err);
      }
      
      // Sync path: already completed
      if (completed) {
        return Promise.resolve(DONE);
      }
      
      // Async path: wait for push
      return new Promise((res, rej) => {
        pullResolve = res;
        pullReject = rej;
      });
    },
    
    async return() {
      completed = true;
      
      if (pullResolve) {
        const r = pullResolve;
        pullResolve = pullReject = null;
        r(DONE);
      }
      
      // Resolve any pending backpressure promises
      for (const resolve of backpressureQueue) resolve();
      backpressureQueue.length = 0;
      
      return Promise.resolve(DONE);
    },
    
    async throw(err) {
      completed = true;
      if (pullReject) {
        const r = pullReject;
        pullResolve = pullReject = null;
        r(err);
      }
      
      // Resolve any pending backpressure promises
      for (const resolve of backpressureQueue) resolve();
      backpressureQueue.length = 0;
      
      return Promise.reject(err);
    },
    
    // Sync pull (non-standard)
    __tryNext() {
      if (queue.length > 0) {
        const { result, stamp } = queue.shift()!;
        setIteratorEmissionStamp(iterator, stamp);
        backpressureQueue.shift()?.();
        return result;
      }
      
      if (pendingError) {
        const { err, stamp } = pendingError;
        pendingError = null;
        setIteratorEmissionStamp(iterator, stamp);
        throw err;
      }
      
      if (completed) {
        return DONE;
      }
      
      return null;
    },
    
    // Check if there are buffered values (non-standard)
    __hasBufferedValues() {
      return queue.length > 0 || pendingError != null || completed;
    }
  };

  // Make it iterable
  iterator[Symbol.asyncIterator] = function() {
    return this;
  };

  // Augment with push API
  iterator.push = function(
    value: R,
    meta?: { valueId: string; operatorIndex: number; operatorName: string },
    tag?: { kind?: IteratorMetaKind; inputValueIds?: string[] }
  ): void | Promise<void> {
    const v = tagValue(iterator, value, meta, tag);
    return receiver.next(v);
  };

  iterator.error = function(err: any) {
    receiver.error(err);
  };

  iterator.complete = function() {
    receiver.complete();
  };

  iterator.completed = function() {
    return receiver.completed;
  };

  // Add optional hook for push notifications
  iterator.__onPush = () => {};

  return iterator as AsyncPushable<R>;
}