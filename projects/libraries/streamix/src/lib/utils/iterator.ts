import { DONE, isPromiseLike, type MaybePromise, type Subscription } from "../atoms";
import {
  AsyncIteratorState,
  asyncPull,
  pushComplete,
  pushError,
  pushValue,
  syncPull
} from "./helpers";
import { normalizeError } from "../atoms/atom";
import { createSourceReadiness, type SourceCapabilities, type StreamixSource, type SyncPoll } from "./source-protocol";

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
 * Creates a factory that produces fresh `StreamixSource` instances backed by
 * an internal queue with producer-backpressure.
 *
 * The `register` callback receives an `Observer<T>` whose `next()`/`complete()`/
 * `error()` methods push into the iterator's queue. `next()` returns a
 * `Promise<void>` (or `void`) — the promise acts as a backpressure signal
 * from the consumer: it resolves only when the consumer pulls the value with
 * `next()` or `pollSync()`.
 *
 * Each call of the returned factory function creates an independent iterator
 * with its own buffer and subscription.
 *
 * Registration is deferred until the consumer actually pulls
 * (either `next()` or `pollSync()`), which avoids hidden subscriptions for
 * iterators that are constructed but never consumed.
 *
 * @template T Value type.
 * @param opts Producer registration function.
 * @returns A function that creates a fresh iterator per call.
 */
export function createAsyncIterator<T>(opts: {
  register: (observer: Observer<T>) => Subscription;
}) {
  const { register } = opts;

  return () => {
    const state = new AsyncIteratorState<T>();
    let unsubscribe: Subscription | null = null;
    let observer: Observer<T> | null = null;

    const readiness = createSourceReadiness();

    const ensureSubscribed = () => {
      if (state.completed) return;
      if (!unsubscribe && !observer) {
        const _observer: Observer<T> = {
          next(value: T) {
            return pushValue(state, iterator, value, readiness.hasListeners ? readiness.notify : undefined);
          },
          complete() {
            pushComplete(state, iterator, readiness.notify);
          },
          fail(err: any) {
            pushError(state, iterator, err, readiness.notify);
          },
          get disposed() {
            return state.completed;
          }
        };

        observer = _observer;
        unsubscribe = register(_observer);
      }
      return observer;
    };

    const handleDone = () => {
      const unsubscribe$ = unsubscribe?.();
      unsubscribe = null;
      if (unsubscribe$ && isPromiseLike(unsubscribe$)) {
        (unsubscribe$ as Promise<unknown>).catch(() => {});
      }
    };


    const iterator: AsyncIterator<T, undefined, undefined> & SourceCapabilities<T> = {
      next(): Promise<AsyncIteratorResult<T>> {
        ensureSubscribed();
        return asyncPull(state, iterator, handleDone) as Promise<AsyncIteratorResult<T>>;
      },

      async return() {
        ensureSubscribed();
        state.markCompleted();
        const unsubscribe$ = unsubscribe?.();
        unsubscribe = null;
        try {
          await unsubscribe$;
        } catch {}
        return Promise.resolve(DONE);
      },

      async throw(err) {
        ensureSubscribed();
        const error = normalizeError(err);
        state.completed = true;
        state.pendingError = null;
        state.queue.length = 0;
        const unsubscribe$ = unsubscribe?.();
        unsubscribe = null;
        if (state.pullReject) {
          const r = state.pullReject;
          state.pullResolve = state.pullReject = null;
          r(error);
        }
        state.clear();
        try {
          await unsubscribe$;
        } catch {}
        return Promise.reject(error);
      },

      pollSync(): SyncPoll<T> {
        ensureSubscribed();
        return syncPull(state, iterator, handleDone);
      },

      // Held events only — terminal completion is reported by `isTerminal`.
      hasBufferedEvents(): boolean {
        return state.queue.some(item => !item.result.done) || state.pendingError != null;
      },

      isTerminal(): boolean {
        return state.completed;
      },

      onReady: readiness.onReady,
    };

    return iterator as AsyncIterator<T, undefined, undefined> & StreamixSource<T>;
  };
}
