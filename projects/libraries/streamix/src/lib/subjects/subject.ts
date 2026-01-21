import {
  createReceiver,
  createSubscription,
  generateStreamId,
  getCurrentEmissionStamp,
  isPromiseLike,
  nextEmissionStamp,
  pipeSourceThrough,
  scheduler,
  withEmissionStamp,
  type MaybePromise,
  type Operator,
  type Receiver,
  type Stream,
  type StrictReceiver,
  type Subscription
} from "../abstractions";
import { firstValueFrom } from "../converters";

export type Subject<T = any> = Stream<T> & {
  next(value: T): void;
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get value(): T | undefined;
};

export function createSubject<T = any>(): Subject<T> {
  const id = generateStreamId();
  let operationId = 0;

  type TrackedReceiver = StrictReceiver<T> & { subscribedAt: number };
  const receivers = new Set<TrackedReceiver>();
  const ready = new Set<TrackedReceiver>();
  
  const queue: Array<
    | { kind: "next"; value: T; stamp: number; opId: number }
    | { kind: "complete"; stamp: number; opId: number }
    | { kind: "error"; error: Error; stamp: number; opId: number }
  > = [];

  let latestValue: T | undefined;
  let isCompleted = false;
  let hasError = false;
  let isCommitting = false;
  const terminalRef = { current: null as any };

  const tryCommit = async (): Promise<void> => {
    if (isCommitting) return;
    isCommitting = true;

    try {
      // Process queue as long as all receivers are ready for the next value
      while (queue.length > 0 && ready.size === receivers.size) {
        const item = queue[0];
        
        // Filter targets based on subscription time vs enqueue time
        const targets = Array.from(ready).filter(r => 
          receivers.has(r) && item.opId > r.subscribedAt
        );
        
        queue.shift();
        const stamp = item.stamp;
        let asyncPromises: Promise<void>[] = [];

        await withEmissionStamp(stamp, async () => {
          if (item.kind === "next") {
            latestValue = item.value;

            for (const r of targets) {
              if (!receivers.has(r)) continue;

              const result = r.next(item.value);

              if (isPromiseLike(result)) {
                ready.delete(r);
                asyncPromises.push(
                  result.then(
                    () => {
                      if (!r.completed && receivers.has(r)) {
                        ready.add(r);
                        // Re-entrant scheduler handles this immediately if in pump
                        void tryCommit();
                      }
                    },
                    () => {
                      if (!r.completed && receivers.has(r)) {
                        ready.add(r);
                        void tryCommit();
                      }
                    }
                  )
                );
              }
            }
          } else {
            // Terminal item
            const allTargets = Array.from(ready).filter(r => receivers.has(r));
            for (const r of allTargets) {
              if (item.kind === "complete") {
                r.complete();
              } else {
                r.error(item.error);
              }
            }
            receivers.clear();
            ready.clear();
            queue.length = 0;
            terminalRef.current = item;
          }
        });

        // If any receivers are async, we must wait for them before next queue item
        if (asyncPromises.length > 0) {
          await Promise.allSettled(asyncPromises);
        }
      }
    } finally {
      isCommitting = false;
    }
  };

  const next = (value: T) => {
    if (isCompleted || hasError) return;
    const current = getCurrentEmissionStamp();
    const base = current ?? nextEmissionStamp();
    const stamp = current === null ? -base : base;
    const opId = ++operationId;

    scheduler.enqueue(async () => {
      queue.push({ kind: "next", value, stamp, opId });
      await tryCommit();
    });
  };

  const complete = () => {
    if (isCompleted || hasError) return;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    const opId = ++operationId;
    const item = { kind: "complete", stamp, opId } as const;
    
    scheduler.enqueue(async () => {
      queue.push(item);
      await tryCommit();
    });
  };

  const error = (err: any) => {
    if (isCompleted || hasError) return;
    hasError = true;
    isCompleted = true;
    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    const opId = ++operationId;
    const errorValue = err instanceof Error ? err : new Error(String(err));
    const item = { kind: "error", error: errorValue, stamp, opId } as const;
    
    scheduler.enqueue(async () => {
      queue.push(item);
      await tryCommit();
    });
  };

  const register = (receiver: Receiver<T>): Subscription => {
    const r = receiver as StrictReceiver<T>;
    const term = terminalRef.current;

    if (term) {
      withEmissionStamp(term.stamp, () => {
        if (term.kind === "complete") r.complete();
        else r.error(term.error);
      });
      return createSubscription();
    }

    const subscribedAt = ++operationId;
    const trackedReceiver: TrackedReceiver = { ...r, subscribedAt };

    receivers.add(trackedReceiver);
    ready.add(trackedReceiver);
    
    if (queue.length > 0) {
      scheduler.enqueue(() => tryCommit());
    }

    return createSubscription(() => {
      receivers.delete(trackedReceiver);
      ready.delete(trackedReceiver);
      
      // Scheduler detects re-entrancy and runs this immediately 
      // if called inside a 'next' callback.
      scheduler.enqueue(() => {
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
        withEmissionStamp(stamp, () => {
          if (!trackedReceiver.completed) r.complete();
        });
      });
    });
  };

  const subscribe = (cb?: ((value: T) => MaybePromise) | Receiver<T>) =>
    register(createReceiver(cb));
  
  const asyncIterator = (): AsyncIterator<T> => {
    const receiver = createReceiver<T>();

    let pullResolve: ((v: IteratorResult<T>) => void) | null = null;
    let pullReject: ((e: any) => void) | null = null;
    let backpressureResolve: (() => void) | null = null;
    let pending: IteratorResult<T> | null = null;
    let pendingError: any = null;
    let sub: Subscription | null = null;

    const iterator: AsyncIterator<T> = {
      next() {
        if (!sub) {
          sub = register(iteratorReceiver);
        }

        if (pendingError) {
          const err = pendingError;
          pendingError = null;
          return Promise.reject(err);
        }

        if (pending) {
          const r = pending;
          pending = null;

          if (backpressureResolve) {
            const resolve = backpressureResolve;
            backpressureResolve = null;
            scheduler.enqueue(() => resolve());
          }

          return Promise.resolve(r);
        }

        return new Promise((res, rej) => {
          pullResolve = res;
          pullReject = rej;
        });
      },

      return() {
        if (sub) {
          sub.unsubscribe();
          sub = null;
        }
        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          scheduler.enqueue(() => r({ done: true, value: undefined }));
        }
        if (backpressureResolve) {
          scheduler.enqueue(() => {
            backpressureResolve!();
            backpressureResolve = null;
          });
        }
        return Promise.resolve({ done: true, value: undefined });
      },

      throw(err) {
        if (sub) {
          sub.unsubscribe();
          sub = null;
        }
        if (pullReject) {
          const r = pullReject;
          pullResolve = pullReject = null;
          scheduler.enqueue(() => r(err));
        }
        if (backpressureResolve) {
          scheduler.enqueue(() => {
            backpressureResolve!();
            backpressureResolve = null;
          });
        }
        return Promise.reject(err);
      },
    };

    const iteratorReceiver: StrictReceiver<T> = {
      ...receiver,

      next(value: T) {
        scheduler.enqueue(() => {
          if (pullResolve) {
            const r = pullResolve;
            pullResolve = pullReject = null;
            r({ done: false, value });
          } else {
            pending = { done: false, value };
          }
        });
        
        return new Promise<void>((resolve) => {
          backpressureResolve = resolve;
        });
      },

      complete() {
        scheduler.enqueue(() => {
          if (pullResolve) {
            const r = pullResolve;
            pullResolve = pullReject = null;
            r({ done: true, value: undefined });
          } else {
            pending = { done: true, value: undefined };
          }
        });
      },

      error(err) {
        scheduler.enqueue(() => {
          if (pullReject) {
            const r = pullReject;
            pullResolve = pullReject = null;
            r(err);
          } else {
            pendingError = err;
          }
        });
      },
    };

    return iterator;
  };

  const subject: Subject<T> = {
    type: "subject",
    name: "subject",
    id,
    get value() {
      return latestValue;
    },
    pipe(...steps: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, steps);
    },
    subscribe,
    async query(): Promise<T> {
      return firstValueFrom(this);
    },
    next,
    complete,
    error,
    completed: () => isCompleted,
    [Symbol.asyncIterator]: asyncIterator,
  };

  return subject;
}