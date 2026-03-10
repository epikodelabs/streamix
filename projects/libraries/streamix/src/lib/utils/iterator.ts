import { DONE } from "../abstractions";

import type { Receiver, StrictReceiver, Subscription } from "../abstractions";
import { isPromiseLike } from "../abstractions";
import {
  AsyncIteratorState,
  asyncPull,
  pushComplete,
  pushDropped,
  pushError, // <-- new helper
  pushValue,
  syncPull
} from "./helpers";

/**
 * Extended iterator result that carries an optional `dropped` flag.
 * When `dropped: true`, the emission was suppressed by a filter operator
 * but the iterator still yields to allow backpressure signalling and
 * introspection without terminating the stream.
 */
export type AsyncIteratorYieldResult<T> =
  | { value: T; done?: false; dropped?: never }
  | { value: T; done?: false; dropped: true };

export type AsyncIteratorResult<T> =
  | AsyncIteratorYieldResult<T>
  | { value: undefined; done: true };

/**
 * Creates a factory that produces fresh `AsyncIterator` instances backed by
 * an internal queue with producer-backpressure.
 *
 * The `register` callback receives a `Receiver<T>` whose `next()`/`complete()`/
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
 * `__pushDropped(value)` pushes a value that will be yielded with
 * `dropped: true` — useful for filter operators that need to release
 * backpressure without surfacing the value to the consumer as a real emission.
 *
 * @template T Value type.
 * @param opts Registration function and lazy mode.
 * @returns A function that creates a fresh AsyncIterator per call.
 */
export function createAsyncIterator<T>(opts: {
  register: (receiver: Receiver<T>) => Subscription;
}) {
  const { register } = opts;

  return () => {
    const state = new AsyncIteratorState<T>();
    let sub: Subscription | null = null;
    let receiver: StrictReceiver<T> | null = null;

    const pendingPushes: Array<{
      type: 'next' | 'complete' | 'error' | 'dropped';
      value?: T;
      err?: any;
    }> = [];

    const ensureSubscribed = () => {
      if (state.completed) return;
      if (!sub && !receiver) {
        const _receiver: StrictReceiver<T> = {
          next(value: T) {
            return pushValue(state, iterator, value, iterator.__onPush);
          },
          complete() {
            pushComplete(state, iterator, iterator.__onPush);
          },
          error(err: any) {
            pushError(state, iterator, err, iterator.__onPush);
          },
          get completed() {
            return state.completed;
          }
        };

        receiver = _receiver;
        sub = register(_receiver);

        for (const push of pendingPushes) {
          if (push.type === 'next') {
            _receiver.next(push.value!);
          } else if (push.type === 'dropped') {
            // Replay dropped pushes directly — no receiver method needed
            pushDropped(state, iterator, push.value!, iterator.__onPush);
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

    const iterator: AsyncIterator<T, undefined, undefined> & {
      __tryNext?: () => AsyncIteratorResult<T> | null;
      __hasBufferedValues?: () => boolean;
      __onPush?: () => void;
      __pushNext?: (value: T) => void;
      __pushDropped?: (value: T) => void;  // <-- new
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
      return syncPull(state, iterator, handleDone) as AsyncIteratorResult<T> | null;
    };

    iterator.__pushNext = (value: T) => {
      if (receiver) {
        receiver.next(value);
      } else {
        pendingPushes.push({ type: 'next', value });
      }
    };

    // Push a value that will be yielded with dropped: true.
    // Releases backpressure on the producer without surfacing the
    // value as a real emission to downstream consumers.
    iterator.__pushDropped = (value: T) => {
      if (receiver) {
        pushDropped(state, iterator, value, iterator.__onPush);
      } else {
        pendingPushes.push({ type: 'dropped', value });
      }
    };

    iterator.__pushComplete = () => {
      if (receiver) {
        receiver.complete();
      } else {
        pendingPushes.push({ type: 'complete' });
      }
    };

    iterator.__pushError = (err: any) => {
      if (receiver) {
        receiver.error(err);
      } else {
        pendingPushes.push({ type: 'error', err });
      }
    };

    return iterator;
  };
}