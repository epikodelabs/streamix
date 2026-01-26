import {
  DONE,
  getCurrentEmissionStamp,
  isPromiseLike,
  MaybePromise,
  nextEmissionStamp,
  setIteratorEmissionStamp,
  withEmissionStamp,
  type Receiver,
  type StrictReceiver,
  type Subscription
} from "../abstractions";

/* ------------------------------------------------------------------------- */
/* Shared helpers for subjects                                                */
/* ------------------------------------------------------------------------- */

export type QueueItem<T> =
  | { kind: "next"; value: T; stamp: number }
  | { kind: "complete"; stamp: number }
  | { kind: "error"; error: Error; stamp: number };


export function createTryCommit<T>(opts: {
  receivers: Set<StrictReceiver<T>>;
  ready: Set<StrictReceiver<T>>;
  queue: QueueItem<T>[];
  setLatestValue: (v: T) => void;
  /**
   * Optional hook used by Subjects to ensure commit continuation runs on the
   * subject's scheduler. When omitted, continuations call `tryCommit()` directly.
   */
  scheduleCommit?: () => void;
}) {
  const { receivers, ready, queue, setLatestValue, scheduleCommit } = opts;
  let isCommitting = false;
  let pendingCommit = false;

  const tryCommit = () => {
    if (isCommitting) {
      pendingCommit = true;
      return;
    }

    isCommitting = true;
    try {
      while (queue.length > 0) {
        if (receivers.size === 0) {
          const ctx = getCurrentEmissionStamp();
          if (ctx !== null && ctx !== undefined) break;
        }
        
        const item = queue[0];
        const eligible = Array.from(receivers).filter((r) => {
          const s = (r as any).subscribedAt;
          const subscribedAt =
            typeof s === "number" ? s : Number.NEGATIVE_INFINITY;
          return subscribedAt <= item.stamp;
        });

        if (item.kind === "next") {
          // Backpressure: if there are eligible receivers and any is not ready,
          // pause committing to preserve ordering and avoid drops.
          if (eligible.length > 0 && eligible.some((r) => !ready.has(r))) {
            break;
          }

          queue.shift();
          let pendingAsync = 0;

          withEmissionStamp(item.stamp, () => {
            setLatestValue(item.value);
            for (const r of eligible) {
              const result = r.next(item.value);
              if (isPromiseLike(result)) {
                pendingAsync++;
                ready.delete(r);
                result.finally(() => {
                  if (!r.completed && receivers.has(r)) {
                    ready.add(r);
                    if (typeof scheduleCommit === "function") {
                      scheduleCommit();
                    } else {
                      tryCommit();
                    }
                  }
                });
              }
            }
          });

          if (pendingAsync > 0) break;
        } else {
          queue.shift();
          withEmissionStamp(item.stamp, () => {
            for (const r of eligible) {
              if (item.kind === "complete") r.complete();
              else {
                r.error(item.error);
              }
            }
          });
          receivers.clear();
          ready.clear();
          return;
        }
      }
    } finally {
      isCommitting = false;
      if (pendingCommit) {
        pendingCommit = false;
        tryCommit();
      }
    }
  };

  return tryCommit;
}

export function createRegister<T>(opts: {
  receivers: Set<StrictReceiver<T>>;
  ready: Set<StrictReceiver<T>>;
  terminalRef: { current: QueueItem<T> | null };
  createSubscription: (onUnsubscribe?: () => MaybePromise<void>) => Subscription;
  tryCommit: () => void;
}) {
  const { receivers, ready, terminalRef, createSubscription, tryCommit } = opts;

  return function register(receiver: Receiver<T>) : Subscription {
    const r = receiver as StrictReceiver<T>;

    const item = terminalRef.current;
    if (item) {
      if (item.kind === "complete") {
        withEmissionStamp(item.stamp, () => r.complete());
      } else if (item.kind === "error") {
        const err = item.error;
        withEmissionStamp(item.stamp, () => {
          r.error(err);
        });
      }
      return createSubscription();
    }

    // Record registration stamp so this receiver does not receive
    // previously queued emissions.
    // IMPORTANT: always use a fresh stamp (even inside an emission context)
    // so a subscription created while an emission is in-flight does not
    // receive that same emission.
    (r as any).subscribedAt = nextEmissionStamp();

    receivers.add(r);
    ready.add(r);
    tryCommit();

    // Schedule receiver completion via the subscription's onUnsubscribe, but
    // remove the receiver from the delivery sets synchronously so that values
    // pushed after `unsubscribe()` are not delivered.
    const baseSub = createSubscription(() => {
      const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
      withEmissionStamp(stamp, () => r.complete());
      tryCommit();
    });

    const baseUnsubscribe = baseSub.unsubscribe.bind(baseSub);
    let removed = false;

    baseSub.unsubscribe = () => {
      if (!removed) {
        removed = true;
        receivers.delete(r);
        ready.delete(r);
      }
      return baseUnsubscribe();
    };

    return baseSub;
  };
}

export function createAsyncIterator<T>(opts: {
  register: (receiver: Receiver<T>) => Subscription;
  /**
   * When `true`, the iterator does not register with the source until the
   * consumer actually pulls (`next()`/`__tryNext()`).
   *
   * Streams should generally use `lazy: true` to avoid creating hidden
   * subscriptions when an iterator is constructed but never consumed.
   *
   * Subjects should generally use `lazy: false` so operators that eagerly
   * emit into an internal Subject can buffer values for downstream consumers.
   */
  lazy?: boolean;
}) {
  const { register, lazy = false } = opts;

  // IMPORTANT: return a *fresh* iterator per call. The old implementation
  // registered a receiver eagerly during subject creation, which could
  // deadlock subjects by introducing backpressure even when nobody is iterating.
  return () => {
    let pullResolve: ((v: IteratorResult<T>) => void) | null = null;
    let pullReject: ((e: any) => void) | null = null;
    const queue: Array<{ result: IteratorResult<T>; stamp: number }> = [];
    const backpressureQueue: Array<() => void> = [];
    let pendingError: { err: any; stamp: number } | null = null;
    let completed = false;
    let sub: Subscription | null = null;

    let iteratorReceiver!: StrictReceiver<T>;

    const ensureSubscribed = () => {
      if (completed) return;
      if (!sub) sub = register(iteratorReceiver);
    };

    const iterator: AsyncIterator<T> & {
      // Non-standard helpers used by internal Stream piping/tests.
      __tryNext?: () => IteratorResult<T> | null;
      __hasBufferedValues?: () => boolean;
      // Internal hook: some operators (e.g. switchMap) may attach this to
      // synchronously drain buffered values when a producer pushes while the
      // consumer is not currently awaiting `next()`.
      __onPush?: () => void;
    } = {
      next() {
        ensureSubscribed();

        if (pendingError) {
          const { err, stamp } = pendingError;
          pendingError = null;
          setIteratorEmissionStamp(iterator, stamp);
          return Promise.reject(err);
        }

        if (queue.length > 0) {
          const { result, stamp } = queue.shift()!;
          setIteratorEmissionStamp(iterator, stamp);
          // Resolves the backpressure promise returned by receiver.next().
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

        if (completed) {
          const unsubscribePromise = sub?.unsubscribe();
          sub = null;
          // Ensure teardown has a chance to run, but don't block iteration.
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

        // Release any pending producer backpressure.
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
      queue.length > 0 || pendingError != null || completed;

    iterator.__tryNext = () => {
      ensureSubscribed();

      if (pendingError) {
        const { err, stamp } = pendingError;
        pendingError = null;
        setIteratorEmissionStamp(iterator, stamp);
        throw err;
      }

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

    const _iteratorReceiver: StrictReceiver<T> = {
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
        // Give consumers a chance to drain synchronously from the buffer.
        if (typeof iterator.__onPush === "function") {
          iterator.__onPush();
          return;
        }

        // Producer backpressure: block the producer until the consumer pulls.
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

      error(err) {
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

    iteratorReceiver = _iteratorReceiver;

    // Subjects rely on buffering: many operators push into an internal Subject
    // immediately during `apply()`, before the downstream consumer starts
    // awaiting `next()`. Eager registration ensures those pushes are buffered.
    if (!lazy) {
      ensureSubscribed();
    }

    return iterator;
  };
}
