import {
  nextEmissionStamp
} from "../abstractions";

import { DONE } from "../abstractions";

import type { Receiver, StrictReceiver, Subscription } from "../abstractions";
import { getCurrentEmissionStamp, isPromiseLike } from "../abstractions";
import {
  AsyncIteratorState,
  asyncPull,
  pushComplete,
  pushError,
  pushValue,
  syncPull
} from "./helpers";

/**
 * Creates a factory that produces fresh `AsyncIterator` instances backed by
 * an internal queue with producer-backpressure.
 *
 * The `register` callback receives a `Receiver<T>` whose `next()`/`complete()`/
 * `error()` methods push into the iterator's queue. `next()` returns a
 * `Promise<void>` (or `void`) â€" the promise acts as a backpressure signal
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
 * @template T Value type.
 * @param opts Registration function and lazy mode.
 * @returns A function that creates a fresh AsyncIterator per call.
 */
export function createAsyncIterator<T>(opts: {
  register: (receiver: Receiver<T>) => Subscription;
}) {
  const { register } = opts;

  // Lazy: only subscribe when consumer pulls
  return () => {
    const state = new AsyncIteratorState<T>();
    let sub: Subscription | null = null;
    let receiver: StrictReceiver<T> | null = null;

    // Store pending pushes before subscription
    const pendingPushes: Array<{
      type: 'next' | 'complete' | 'error';
      value?: T;
      err?: any;
      stamp: number;
    }> = [];

    const ensureSubscribed = () => {
      if (state.completed) return;
      if (!sub && !receiver) {
        // Create receiver that will process both pending and future pushes
        const _receiver: StrictReceiver<T> = {
          next(value: T) {
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

        receiver = _receiver;
        sub = register(_receiver);

        // Replay any pending pushes
        for (const push of pendingPushes) {
          if (push.type === 'next') {
            _receiver.next(push.value!);
          } else if (push.type === 'complete') {
            _receiver.complete();
          } else if (push.type === 'error') {
            _receiver.error(push.err);
          }
        }
        pendingPushes.length = 0;
      }
      return receiver;
    };

    const handleDone = () => {
      const unsubscribePromise = sub?.unsubscribe();
      sub = null;
      if (unsubscribePromise && isPromiseLike(unsubscribePromise)) {
        unsubscribePromise.catch(() => {});
      }
    };

    const iterator: AsyncIterator<T> & {
      __tryNext?: () => IteratorResult<T> | null;
      __hasBufferedValues?: () => boolean;
      __onPush?: () => void;
      __pushNext?: (value: T, stamp: number) => void;
      __pushComplete?: (stamp: number) => void;
      __pushError?: (err: any, stamp: number) => void;
    } = {
      next() {
        ensureSubscribed();
        return asyncPull(state, iterator, handleDone);
      },

      async return() {
        state.markCompleted();
        const unsubscribePromise = sub?.unsubscribe();
        sub = null;
        try {
          await unsubscribePromise;
        } catch {}
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
        } catch {}
        return Promise.reject(err);
      }
    };

    iterator.__hasBufferedValues = () =>
      state.hasBufferedValues() || pendingPushes.length > 0;

    iterator.__tryNext = () => {
      ensureSubscribed();
      return syncPull(state, iterator, handleDone);
    };

    // Methods to push values before subscription
    iterator.__pushNext = (value: T, stamp: number) => {
      if (receiver) {
        receiver.next(value);
      } else {
        pendingPushes.push({ type: 'next', value, stamp });
      }
    };

    iterator.__pushComplete = (stamp: number) => {
      if (receiver) {
        receiver.complete();
      } else {
        pendingPushes.push({ type: 'complete', stamp });
      }
    };

    iterator.__pushError = (err: any, stamp: number) => {
      if (receiver) {
        receiver.error(err);
      } else {
        pendingPushes.push({ type: 'error', err, stamp });
      }
    };

    return iterator;
  };
}