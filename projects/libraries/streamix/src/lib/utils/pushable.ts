import {
  DONE
} from "../atoms";
import {
  AsyncIteratorState,
  asyncPull,
  pushComplete,
  pushError,
  pushValue,
  syncPull
} from "./helpers";
import { normalizeError } from "../atoms/atom";

/**
 * Async iterator augmented with push methods, passed to operator setup callbacks.
 */
export type AsyncPushable<R> = AsyncIterator<R> & AsyncIterable<R> & {
  push(value: R): void | Promise<void>;
  fail(err: any): void;
  dispose(): void;
  get disposed(): boolean;
};

/**
 * Creates an `AsyncPushable` - an async iterator that you can manually
 * push values into with backpressure.
 */
export function createAsyncPushable<R>(options?: { conflate?: boolean }): AsyncPushable<R> {
  const state = new AsyncIteratorState<R>();
  const conflate = options?.conflate ?? false;

  // Create the receiver that will handle pushes
  const receiver = {
    next(value: R) {
      return pushValue(state, iterator, value, iterator.__onPush);
    },
    
    dispose() {
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
    fail?: any;
    dispose?: any;
    disposed?: boolean;
  } = {
    next() {
      return asyncPull(state, iterator);
    },
    
    async return() {
      state.markCompleted();
      return Promise.resolve(DONE);
    },
    
    async throw(err) {
      const error = normalizeError(err);
      state.completed = true;
      state.pendingError = null;
      state.queue.length = 0;
      if (state.pullReject) {
        const r = state.pullReject;
        state.pullResolve = state.pullReject = null;
        r(error);
      }
      state.clear();
      return Promise.reject(error);
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
    if (state.completed) return;

    if (conflate) {
      // A consumer is already waiting: deliver immediately.
      if (state.pullResolve) {
        const r = state.pullResolve;
        state.pullResolve = state.pullReject = null;
        r({ done: false, value });
        iterator.__onPush?.();
        return;
      }

      // Consumer is behind: keep only the latest buffered value.
      if (state.queue.length > 0) {
        state.queue[state.queue.length - 1] = { result: { done: false, value } };
        iterator.__onPush?.();
        return;
      }
    }

    return receiver.next(value);
  };

  iterator.error = function(err: any) {
    receiver.error(err);
  };

  iterator.fail = function(err: any) {
    receiver.error(err);
  };

  iterator.dispose = function() {
    receiver.dispose();
  };

  Object.defineProperty(iterator, "disposed", {
    get: () => receiver.disposed
  });

  // Add optional hook for push notifications
  iterator.__onPush = () => {};

  return iterator as AsyncPushable<R>;
}
