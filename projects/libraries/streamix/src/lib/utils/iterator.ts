import { DONE, isPromiseLike, type MaybePromise, type Subscription } from "../atoms";
import {
  AsyncIteratorState,
  asyncPull,
  pushComplete,
  pushError,
  pushValue,
  syncPull
} from "./helpers";

type Observer<T> = {
  next: (value: T) => MaybePromise;
  fail: (err: any) => MaybePromise;
  complete: () => MaybePromise;
  readonly disposed: boolean;
};

export type AsyncIteratorYieldResult<T> = { value: T; done?: false };

export type AsyncIteratorResult<T> =
  | AsyncIteratorYieldResult<T>
  | { value: undefined; done: true };

/**
 * Creates a factory that produces fresh `AsyncIterator` instances backed by
 * an internal queue with producer-backpressure.
 *
 * The `register` callback receives an `Observer<T>` whose `next()`/`complete()`/
 * `error()` methods push into the iterator's queue. `next()` returns a
 * `Promise<void>` (or `void`) — the promise acts as a backpressure signal
 * from the consumer: it resolves only when the consumer pulls the value with
 * `next()` or `__tryNext()`.
 *
 * Each call of the returned factory function creates an independent iterator
 * with its own buffer and subscription.
 *
 * When `lazy: true`, registration is deferred until the consumer actually pulls
 * (either `next()` or `__tryNext>`), which avoids hidden subscriptions for
 * iterators that are constructed but never consumed.
 *
 * Each call of the returned factory function creates an independent iterator
 * with its own buffer and subscription.
 *
 * @template T Value type.
 * @param opts Registration function and lazy mode.
 * @returns A function that creates a fresh AsyncIterator per call.
 */
export function createAsyncIterator<T>(opts: {
  register: (observer: Observer<T>) => Subscription;
}) {
  const { register } = opts;

  return () => {
    const state = new AsyncIteratorState<T>();
    let sub: Subscription | null = null;
    let observer: Observer<T> | null = null;

    const pendingPushes: Array<{
      type: 'next' | 'complete' | 'error';
      value?: T;
      err?: any;
    }> = [];

    const ensureSubscribed = () => {
      if (state.completed) return;
      if (!sub && !observer) {
        const _observer: Observer<T> = {
          next(value: T) {
            return pushValue(state, iterator, value, iterator.__onPush);
          },
          complete() {
            pushComplete(state, iterator, iterator.__onPush);
          },
          fail(err: any) {
            pushError(state, iterator, err, iterator.__onPush);
          },
          get disposed() {
            return state.completed;
          }
        };

        observer = _observer;
        sub = register(_observer);

        for (const push of pendingPushes) {
          if (push.type === 'next') {
            _observer.next(push.value!);
          } else if (push.type === 'complete') {
            _observer.complete();
          } else if (push.type === 'error') {
            _observer.fail(push.err);
          }
        }
        pendingPushes.length = 0;
      }
      return observer;
    };

    const handleDone = () => {
      const unsubscribePromise = sub?.unsubscribe();
      sub = null;
      if (unsubscribePromise && isPromiseLike(unsubscribePromise)) {
        (unsubscribePromise as Promise<unknown>).catch((err: any) => {
          console.log('AsyncIterator handleDone error', err);
        });
      }
    };


    const iterator: AsyncIterator<T, undefined, undefined> & {
      __tryNext?: () => AsyncIteratorResult<T> | null;
      __hasBufferedValues?: () => boolean;
      __onPush?: () => void;
      __pushNext?: (value: T) => void;
      __pushComplete?: () => void;
      __pushError?: (err: any) => void;
    } = {
      next(): Promise<AsyncIteratorResult<T>> {
        ensureSubscribed();
        return asyncPull(state, iterator, handleDone) as Promise<AsyncIteratorResult<T>>;
      },

      async return() {
        state.markCompleted();
        const unsubscribePromise = sub?.unsubscribe();
        sub = null;
        try {
          await unsubscribePromise;
        } catch (err: any) {
          console.log('AsyncIterator return error', err);
        }
        return Promise.resolve(DONE);
      },

      async throw(err) {
        state.completed = true;
        const unsubscribePromise = sub?.unsubscribe();
        sub = null;
        if (state.pullReject) {
          const r = state.pullReject;
          state.pullResolve = state.pullReject = null;
          r(err);
        }
        state.clear();
        try {
          await unsubscribePromise;
        } catch (e: any) {
          console.log('AsyncIterator throw error', e);
        }
        return Promise.reject(err);
      }
    };

    iterator.__hasBufferedValues = () =>
      state.hasBufferedValues() || pendingPushes.length > 0;

    iterator.__tryNext = () => {
      ensureSubscribed();
      return syncPull(state, iterator, handleDone) as AsyncIteratorResult<T> | null;
    };

    iterator.__pushNext = (value: T) => {
      if (observer) {
        observer.next(value);
      } else {
        pendingPushes.push({ type: 'next', value });
      }
    };

    iterator.__pushComplete = () => {
      if (observer) {
        observer.complete();
      } else {
        pendingPushes.push({ type: 'complete' });
      }
    };

    iterator.__pushError = (err: any) => {
      if (observer) {
        observer.fail(err);
      } else {
        pendingPushes.push({ type: 'error', err });
      }
    };

    return iterator;
  };
}