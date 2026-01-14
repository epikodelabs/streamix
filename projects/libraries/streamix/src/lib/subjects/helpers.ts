import {
    createReceiver,
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

  return function tryCommit() {
    if (isCommitting) return;
    isCommitting = true;

    try {
      while (queue.length > 0 && ready.size === receivers.size) {
        const item = queue[0];
        const targets = Array.from(ready);

        queue.shift();
        ready.clear();

        const stamp = item.stamp;
        let pendingAsync = 0;

        withEmissionStamp(stamp, () => {
          if (item.kind === "next") {
            setLatestValue(item.value);

            for (const r of targets) {
              const result = r.next(item.value);

              if (isPromiseLike(result)) {
                pendingAsync++;
                result.finally(() => {
                  if (!r.completed && receivers.has(r)) {
                    ready.add(r);
                    tryCommit();
                  }
                });
              } else {
                if (!r.completed && receivers.has(r)) {
                  ready.add(r);
                }
              }
            }
          } else {
            for (const r of targets) {
              if (item.kind === "complete") r.complete();
              else r.error(item.error);
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
    }
  };
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
        withEmissionStamp(item.stamp, () => r.error(err));
      }
      return createSubscription();
    }

    receivers.add(r);
    ready.add(r);
    tryCommit();

    return createSubscription(() => {
      receivers.delete(r);
      ready.delete(r);

      const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
      withEmissionStamp(stamp, () => r.complete());

      tryCommit();
    });
  };
}

export function createAsyncIterator<T>(opts: {
  register: (receiver: Receiver<T>) => Subscription;
}) {
  const { register } = opts;

  return function asyncIterator(): AsyncIterator<T> {
    const receiver = createReceiver<T>();

    let pullResolve: ((v: IteratorResult<T>) => void) | null = null;
    let pullReject: ((e: any) => void) | null = null;

    let backpressureResolve: (() => void) | null = null;

    let pending: IteratorResult<T> | null = null;
    let pendingStamp: number | null = null;

    let pendingError: any = null;
    let pendingErrorStamp: number | null = null;

    let sub: Subscription | null = null;

    const iterator: AsyncIterator<T> = {
      next() {
        if (!sub) sub = register(iteratorReceiver);

        if (pendingError) {
          const err = pendingError;
          const stamp = pendingErrorStamp!;
          pendingError = null;
          pendingErrorStamp = null;
          setIteratorEmissionStamp(iterator as any, stamp);
          return Promise.reject(err);
        }

        if (pending) {
          const r = pending;
          const stamp = pendingStamp!;
          pending = null;
          pendingStamp = null;
          setIteratorEmissionStamp(iterator as any, stamp);

          if (backpressureResolve) {
            const resolve = backpressureResolve;
            backpressureResolve = null;
            resolve();
          }

          return Promise.resolve(r);
        }

        return new Promise((res, rej) => {
          pullResolve = res;
          pullReject = rej;
        });
      },

      return() {
        sub?.unsubscribe();
        sub = null;
        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          r({ done: true, value: undefined });
        }
        if (backpressureResolve) {
          backpressureResolve();
          backpressureResolve = null;
        }
        return Promise.resolve({ done: true, value: undefined });
      },

      throw(err) {
        sub?.unsubscribe();
        sub = null;
        if (pullReject) {
          const r = pullReject;
          pullResolve = pullReject = null;
          r(err);
        }
        if (backpressureResolve) {
          backpressureResolve();
          backpressureResolve = null;
        }
        return Promise.reject(err);
      },
    };

    const iteratorReceiver: StrictReceiver<T> = {
      ...receiver,

      next(value: T) {
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();

        if (pullResolve) {
          setIteratorEmissionStamp(iterator as any, stamp);
          const r = pullResolve;
          pullResolve = pullReject = null;
          r({ done: false, value });
          return;
        }

        pending = { done: false, value };
        pendingStamp = stamp;

        return new Promise<void>((resolve) => {
          backpressureResolve = resolve;
        });
      },

      complete() {
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
        if (pullResolve) {
          setIteratorEmissionStamp(iterator as any, stamp);
          const r = pullResolve;
          pullResolve = pullReject = null;
          r({ done: true, value: undefined });
          return;
        }
        pending = { done: true, value: undefined };
        pendingStamp = stamp;
      },

      error(err) {
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
        if (pullReject) {
          setIteratorEmissionStamp(iterator as any, stamp);
          const r = pullReject;
          pullResolve = pullReject = null;
          r(err);
          return;
        }
        pendingError = err;
        pendingErrorStamp = stamp;
      },
    };

    return iterator;
  };
}
