import {
  createReceiver,
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
      while (queue.length > 0 && ready.size === receivers.size) {
        const item = queue[0];
        const targets = Array.from(ready).filter((r) => receivers.has(r));

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
                ready.delete(r);
                result.finally(() => {
                  if (!r.completed && receivers.has(r)) {
                    ready.add(r);
                    tryCommit();
                  }
                });
              } else if (!r.completed && receivers.has(r)) {
                // Receiver completed synchronously but still active; keep it ready.
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

  const receiver = createReceiver<T>();
  let pullResolve: ((v: IteratorResult<T>) => void) | null = null;
  let pullReject: ((e: any) => void) | null = null;
  let pullPromise: Promise<IteratorResult<T>> | null = null;
  const queue: Array<{ result: IteratorResult<T>; stamp: number }> = [];
  const backpressureQueue: Array<() => void> = [];
  let pendingError: any = null;
  let pendingErrorStamp: number | null = null;

  const iterator: AsyncIterator<T> & {
    __tryNext?: () => IteratorResult<T> | null;
    __hasBufferedValues?: () => boolean;
  } = {
    next() {
      if (pendingError) {
        const err = pendingError;
        const stamp = pendingErrorStamp!;
        pendingError = null;
        pendingErrorStamp = null;
        setIteratorEmissionStamp(iterator as any, stamp);
        return Promise.reject(err);
      }

      if (queue.length > 0) {
        const { result, stamp } = queue.shift()!;
        setIteratorEmissionStamp(iterator as any, stamp);

        if (backpressureQueue.length > 0) {
          const resolve = backpressureQueue.shift()!;
          resolve();
        }

        return Promise.resolve(result);
      }

      if (pullPromise) {
        const p = pullPromise;
        pullPromise = null;
        return p;
      }

      return new Promise((res, rej) => {
        pullResolve = res;
        pullReject = rej;
      });
    },

    return() {
      sub?.unsubscribe();
      if (pullResolve) {
        const r = pullResolve;
        pullResolve = pullReject = null;
        pullPromise = null;
        r(DONE);
      }
      backpressureQueue.forEach(resolve => resolve());
      backpressureQueue.length = 0;
      return Promise.resolve(DONE);
    },

    throw(err) {
      sub?.unsubscribe();
      if (pullReject) {
        const r = pullReject;
        pullResolve = pullReject = null;
        pullPromise = null;
        r(err);
      }
      backpressureQueue.forEach(resolve => resolve());
      backpressureQueue.length = 0;
      return Promise.reject(err);
    },
  };

  const iteratorReceiver: StrictReceiver<T> = {
    ...receiver,

    next(value: T) {
      const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
      const result = { done: false, value };

      if (pullResolve) {
        const r = pullResolve;
        pullResolve = pullReject = null;
        pullPromise = null;
        setIteratorEmissionStamp(iterator as any, stamp);
        r(result);
        return;
      }

      queue.push({ result, stamp });
      return new Promise<void>((resolve) => {
        backpressureQueue.push(resolve);
      });
    },

    complete() {
      const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
      const result = DONE;

      if (pullResolve) {
        const r = pullResolve;
        pullResolve = pullReject = null;
        pullPromise = null;
        setIteratorEmissionStamp(iterator as any, stamp);
        r(result);
        return;
      }

      queue.push({ result, stamp });
    },

    error(err) {
      const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();

      if (pullReject) {
        const r = pullReject;
        pullResolve = pullReject = null;
        pullPromise = null;
        setIteratorEmissionStamp(iterator as any, stamp);
        r(err);
        return;
      }

      pendingError = err;
      pendingErrorStamp = stamp;
    },
  };

  iterator.__hasBufferedValues = () => queue.length > 0 || !!pendingError;

  iterator.__tryNext = () => {
    if (pendingError) {
      const err = pendingError;
      const stamp = pendingErrorStamp!;
      pendingError = null;
      pendingErrorStamp = null;
      setIteratorEmissionStamp(iterator as any, stamp);
      throw err;
    }

    if (queue.length > 0) {
      const { result, stamp } = queue.shift()!;
      setIteratorEmissionStamp(iterator as any, stamp);

      if (backpressureQueue.length > 0) {
        const resolve = backpressureQueue.shift()!;
        resolve();
      }

      return result;
    }

    return null;
  };

  const sub: Subscription = register(iteratorReceiver);

  // Create an initial pending pull so that registration behaves like an implicit
  // consumer `next()`; this avoids a race where a source registers a receiver
  // but no consumer Promise exists yet to receive the first emission.
  if (!pullPromise) {
    pullPromise = new Promise<IteratorResult<T>>((res, rej) => {
      pullResolve = res;
      pullReject = rej;
    });
    // Swallow rejections on the internal pending pull to avoid unhandled
    // rejection when a late terminal `error()` is delivered before any
    // consumer awaited the iterator's `next()`.
    pullPromise.catch(() => {});
  }

  // If there are already buffered items (or a pending error), drain one
  // immediately into the pending pull so the consumer receives it without
  // requiring an extra `next()` call.
  try {
    const maybe = iterator.__tryNext && iterator.__tryNext();
    if (maybe != null && pullResolve) {
      const r = pullResolve as any;
      pullResolve = pullReject = null;
      pullPromise = null;
      r(maybe);
    }
  } catch (e) {
    if (pullReject) {
      const rej = pullReject as any;
      pullResolve = pullReject = null;
      pullPromise = null;
      rej(e);
    }
  }

  return () => iterator;
}
