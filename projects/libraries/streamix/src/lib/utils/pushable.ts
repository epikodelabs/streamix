import {
  DONE,
  getCurrentEmissionStamp,
  nextEmissionStamp,
  StrictReceiver
} from "../abstractions";
import { IteratorMetaKind, setIteratorMeta, setValueMeta } from "../abstractions/hooks";
import {
  AsyncIteratorState,
  asyncPull,
  pushComplete,
  pushError,
  pushValue,
  syncPull
} from "./helpers";

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
  const state = new AsyncIteratorState<R>();

  // Create the receiver that will handle pushes
  const receiver: StrictReceiver<R> = {
    next(value: R) {
      const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
      return pushValue(state, iterator, value, stamp, iterator.__onPush);
    },
    
    complete() {
      const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
      pushComplete(state, iterator, stamp, iterator.__onPush);
    },
    
    error(err: any) {
      const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
      pushError(state, iterator, err, stamp, iterator.__onPush);
    },
    
    get completed() {
      return state.completed;
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
      return asyncPull(state, iterator);
    },
    
    async return() {
      state.markCompleted();
      return Promise.resolve(DONE);
    },
    
    async throw(err) {
      state.completed = true;
      if (state.pullReject) {
        const r = state.pullReject;
        state.pullResolve = state.pullReject = null;
        r(err);
      }
      state.clear();
      return Promise.reject(err);
    },
    
    __tryNext() {
      return syncPull(state, iterator);
    },
    
    __hasBufferedValues() {
      return state.hasBufferedValues();
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