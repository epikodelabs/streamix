import { DONE, type MaybePromise } from "../atoms";

type Observer<T> = {
  next: (value: T) => MaybePromise;
  error: (err: any) => MaybePromise;
  complete: () => MaybePromise;
  readonly disposed: boolean;
};
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
  push(value: R): void | Promise<void>;
  error(err: any): void;
  disposed: boolean;
  dispose(): void;
};

/**
 * Creates an `AsyncPushable` - an async iterator that you can manually
 * push values into with backpressure.
 */
export function createAsyncPushable<R>(): AsyncPushable<R> {
  const state = new AsyncIteratorState<R>();

  // Create the receiver that will handle pushes
  const receiver: Observer<R> = {
    next(value: R) {
      return pushValue(state, iterator, value, iterator.__onPush);
    },
    
    complete() {
      pushComplete(state, iterator, iterator.__onPush);
    },
    
    error(err: any) {
      pushError(state, iterator, err, iterator.__onPush);
    },
    
    get disposed() {
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
    disposed?: boolean;
    dispose?: () => void;
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
  iterator.push = function(value: R): void | Promise<void> {
    return receiver.next(value);
  };

  iterator.error = function(err: any) {
    receiver.error(err);
  };

  iterator.disposed = false;

  iterator.dispose = function() {
    if (iterator.disposed) return;
    iterator.disposed = true;
    state.markCompleted();
    if (iterator.__onPush) {
      try {
        iterator.__onPush();
      } catch {
        // ignore
      }
    }
  };

  // Add optional hook for push notifications
  iterator.__onPush = () => {};

  return iterator as AsyncPushable<R>;
}
