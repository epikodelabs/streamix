import {
  nextEmissionStamp,
  setIteratorEmissionStamp
} from "../abstractions";

import { DONE } from "../abstractions";

import type { Receiver, StrictReceiver, Subscription } from "../abstractions";
import { getCurrentEmissionStamp, isPromiseLike } from "../abstractions";

/**
 * Creates a factory that produces fresh `AsyncIterator` instances backed by
 * an internal queue with producer-backpressure.
 *
 * The `register` callback receives a `Receiver<T>` whose `next()`/`complete()`/
 * `error()` methods push into the iterator's queue. `next()` returns a
 * `Promise<void>` (or `void`) – the promise acts as a backpressure signal
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
    let pullResolve: ((v: IteratorResult<T>) => void) | null = null;
    let pullReject: ((e: any) => void) | null = null;
    const queue: Array<{ result: IteratorResult<T>; stamp: number }> = [];
    const backpressureQueue: Array<() => void> = [];
    let pendingError: { err: any; stamp: number } | null = null;
    let completed = false;
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
      if (completed) return;
      if (!sub && !receiver) {
        // Create receiver that will process both pending and future pushes
        const _receiver: StrictReceiver<T> = {
          next(value: T) {
            if (completed) return;
            const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
            const result: IteratorResult<T> = { done: false, value };
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
        if (queue.length > 0) {
          const { result, stamp } = queue.shift()!;
          setIteratorEmissionStamp(iterator, stamp);
          backpressureQueue.shift()?.();
          if (result.done) {
            const unsubscribePromise = sub?.unsubscribe();
            sub = null;
            if (unsubscribePromise && isPromiseLike(unsubscribePromise)) {
              unsubscribePromise.catch(() => {});
            }
          }
          return Promise.resolve(result);
        }
        if (pendingError) {
          const { err, stamp } = pendingError;
          pendingError = null;
          setIteratorEmissionStamp(iterator, stamp);
          return Promise.reject(err);
        }
        if (completed) {
          const unsubscribePromise = sub?.unsubscribe();
          sub = null;
          if (unsubscribePromise && isPromiseLike(unsubscribePromise)) {
            unsubscribePromise.catch(() => {});
          }
          return Promise.resolve(DONE);
        }
        return new Promise((res, rej) => {
          pullResolve = res;
          pullReject = rej;
        });
      },
      async return() {
        completed = true;
        const unsubscribePromise = sub?.unsubscribe();
        sub = null;
        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          r(DONE);
        }
        for (const resolve of backpressureQueue) resolve();
        backpressureQueue.length = 0;
        try {
          await unsubscribePromise;
        } catch {
        }
        return Promise.resolve(DONE);
      },
      async throw(err) {
        completed = true;
        const unsubscribePromise = sub?.unsubscribe();
        sub = null;
        if (pullReject) {
          const r = pullReject;
          pullResolve = pullReject = null;
          r(err);
        }
        for (const resolve of backpressureQueue) resolve();
        backpressureQueue.length = 0;
        try {
          await unsubscribePromise;
        } catch {
        }
        return Promise.reject(err);
      }
    };

    iterator.__hasBufferedValues = () =>
      queue.length > 0 || pendingError != null || completed || pendingPushes.length > 0;

    iterator.__tryNext = () => {
      ensureSubscribed();
      if (queue.length > 0) {
        const { result, stamp } = queue.shift()!;
        setIteratorEmissionStamp(iterator, stamp);
        backpressureQueue.shift()?.();
        if (result.done) {
          const unsubscribePromise = sub?.unsubscribe();
          sub = null;
          if (unsubscribePromise && isPromiseLike(unsubscribePromise)) {
            unsubscribePromise.catch(() => {});
          }
        }
        return result;
      }
      if (pendingError) {
        const { err, stamp } = pendingError;
        pendingError = null;
        setIteratorEmissionStamp(iterator, stamp);
        throw err;
      }
      if (completed) {
        const unsubscribePromise = sub?.unsubscribe();
        sub = null;
        if (unsubscribePromise && isPromiseLike(unsubscribePromise)) {
          unsubscribePromise.catch(() => {});
        }
        return DONE;
      }
      return null;
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

