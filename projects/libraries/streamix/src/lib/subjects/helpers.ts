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

  return function asyncIterator(): AsyncIterator<T> {
    const receiver = createReceiver<T>();

    let pullResolve: ((v: IteratorResult<T>) => void) | null = null;
    let pullReject: ((e: any) => void) | null = null;

    // Use queues instead of single variables
    const queue: Array<{ result: IteratorResult<T>; stamp: number }> = [];
    const backpressureQueue: Array<() => void> = [];

    let pendingError: any = null;
    let pendingErrorStamp: number | null = null;
    let sub: Subscription | null = null;

    const iterator: AsyncIterator<T> & {
      __tryNext?: () => IteratorResult<T> | null;
      __hasBufferedValues?: () => boolean;
    } = {
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

        // Pull from the queue
        if (queue.length > 0) {
          const { result, stamp } = queue.shift()!;
          setIteratorEmissionStamp(iterator as any, stamp);

          // Resolve the oldest backpressure promise
          if (backpressureQueue.length > 0) {
            const resolve = backpressureQueue.shift()!;
            resolve();
          }

          return Promise.resolve(result);
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
        backpressureQueue.forEach(resolve => resolve());
        backpressureQueue.length = 0;
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
        backpressureQueue.forEach(resolve => resolve());
        backpressureQueue.length = 0;
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

        // Push to queue instead of overwriting
        queue.push({ result: { done: false, value }, stamp });

        return new Promise<void>((resolve) => {
          backpressureQueue.push(resolve);
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
        queue.push({ result: { done: true, value: undefined }, stamp });
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

    return iterator;
  };
}
