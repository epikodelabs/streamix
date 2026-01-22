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
}) {
  const { receivers, ready, queue, setLatestValue } = opts;

  let isCommitting = false;
  let pendingCommit = false;

  const tryCommit = () => {
    if (isCommitting) {
      pendingCommit = true;
      return;
    }

    isCommitting = true;
      try {
      // Always drain the queue. Even when there are no receivers, subjects
      // still need to update internal state (e.g. `.value`) and drop
      // undeliverable emissions to avoid leaking queued items.
      //
      // Exception: if we're currently inside an emission context and there are
      // no receivers yet, keep items queued so a receiver that registers as
      // part of the same synchronous emission chain (e.g. switchMap creating
      // and wiring an inner Subject) can still observe those emissions.
      while (queue.length > 0) {
        if (receivers.size === 0) {
          const ctx = getCurrentEmissionStamp();
          if (ctx !== null && ctx !== undefined) break;
        }
        const item = queue[0];
        // Deliver only to receivers that were registered before the
        // emission stamp to avoid replaying past values to late subscribers.
        // Use the full receivers set (not the `ready` subset) so that all
        // current subscribers receive the emission even if some returned
        // backpressure Promises.
        const targets = receivers.size === 0 ? [] : Array.from(receivers).filter((r) => {
          if (!receivers.has(r)) return false;
          const s = Number((r as any).subscribedAt as any);
          const st = Number(item.stamp as any);
          return Number.isFinite(s) && Number.isFinite(st) ? s <= st : true;
        });
        // processing item

        queue.shift();

        const stamp = item.stamp;
        let pendingAsync = 0;

        withEmissionStamp(stamp, () => {
          if (item.kind === "next") {
            setLatestValue(item.value);

            for (const r of targets) {
              if (!receivers.has(r)) {
                continue;
              }

              const result = r.next(item.value);

              if (isPromiseLike(result)) {
                pendingAsync++;
                // Do not remove from `ready` here; receivers handle their
                // own buffering. When the Promise settles we re-run
                // tryCommit in case there are queued items to process.
                result.finally(() => {
                  if (!r.completed && receivers.has(r)) {
                    tryCommit();
                  }
                });
              } else if (!r.completed && receivers.has(r)) {
                // Receiver completed synchronously but still active; keep it ready.
              }
            }
          } else {
            for (const r of targets) {
              if (item.kind === "complete") {
                r.complete();
              } else {
                // Streamix terminal semantics: error is followed by completion.
                r.error(item.error);
                r.complete();
              }
            }
            receivers.clear();
            ready.clear();
            queue.length = 0;
            return;
          }
        });

        if (pendingAsync > 0) {
          break;
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
          r.complete();
        });
      }
      return createSubscription();
    }

    // Record registration stamp so this receiver does not receive
    // previously queued emissions.
    try {
      (r as any).subscribedAt = getCurrentEmissionStamp() ?? nextEmissionStamp();
    } catch (_) {
      (r as any).subscribedAt = nextEmissionStamp();
    }

    receivers.add(r);
    ready.add(r);
    tryCommit();

    // Wrap the created subscription so that deletion from the `receivers`
    // and `ready` sets happens synchronously when `unsubscribe()` is
    // invoked. The underlying `createSubscription` schedules the
    // provided cleanup via the scheduler; we still delegate to it for
    // completing the receiver and running `tryCommit` in the scheduled
    // cleanup, but remove the receiver immediately so no in-flight
    // emissions target it after unsubscribe.
    const baseSub = createSubscription(() => {
      const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
      withEmissionStamp(stamp, () => r.complete());
      tryCommit();
    });

    const wrapped: Subscription = {
      get unsubscribed() {
        return baseSub.unsubscribed;
      },
      unsubscribe() {
        // Ensure removal is synchronous so unsubscribing prevents
        // any subsequent deliveries in the current commit loop.
        receivers.delete(r);
        ready.delete(r);
        return baseSub.unsubscribe();
      },
      onUnsubscribe: baseSub.onUnsubscribe,
    };

    return wrapped;
  };
}

export function createAsyncIterator<T>(opts: {
  register: (receiver: Receiver<T>) => Subscription;
}) {
  const { register } = opts;

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
          return Promise.resolve(result);
        }

        if (completed) {
          return Promise.resolve(DONE);
        }

        return new Promise((res, rej) => {
          pullResolve = res;
          pullReject = rej;
        });
      },

      return() {
        completed = true;
        sub?.unsubscribe();
        sub = null;

        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          r(DONE);
        }

        // Release any pending producer backpressure.
        for (const resolve of backpressureQueue) resolve();
        backpressureQueue.length = 0;

        return Promise.resolve(DONE);
      },

      throw(err) {
        completed = true;
        sub?.unsubscribe();
        sub = null;

        if (pullReject) {
          const r = pullReject;
          pullResolve = pullReject = null;
          r(err);
        }

        for (const resolve of backpressureQueue) resolve();
        backpressureQueue.length = 0;

        return Promise.reject(err);
      }
    };

    iterator.__hasBufferedValues = () => queue.length > 0 || pendingError != null || completed;

    iterator.__tryNext = () => {
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
        return result;
      }

      return completed ? DONE : null;
    };

    const iteratorReceiver: StrictReceiver<T> = {
      next(value: T) {
        if (completed) return;
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
        const result: IteratorResult<T> = { done: false, value };

        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          setIteratorEmissionStamp(iterator, stamp);
          r(result);
          return;
        }

        queue.push({ result, stamp });
        // Give consumers a chance to drain synchronously from the buffer.
        iterator.__onPush?.();
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

    sub = register(iteratorReceiver);

    return iterator;
  };
}
