import {
  createReceiver,
  createSubscription,
  generateStreamId,
  getCurrentEmissionStamp,
  isPromiseLike,
  nextEmissionStamp,
  pipeSourceThrough,
  setIteratorEmissionStamp,
  withEmissionStamp,
  type Operator,
  type Receiver,
  type Stream,
  type StrictReceiver,
  type Subscription,
} from "../abstractions";
import { firstValueFrom } from "../converters";

/* ========================================================================== */
/* Subject                                                                    */
/* ========================================================================== */

type QueueItem<T> =
  | { kind: "next"; value: T; stamp: number }
  | { kind: "complete"; stamp: number }
  | { kind: "error"; error: Error; stamp: number };

export type Subject<T = any> = Stream<T> & {
  next(value?: T): void;
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get value(): T | undefined;
};

export function createSubject<T = any>(): Subject<T> {
  const id = generateStreamId();

  const receivers = new Set<StrictReceiver<T>>();
  const ready = new Set<StrictReceiver<T>>();
  const queue: QueueItem<T>[] = [];

  let latestValue: T | undefined;
  let isCompleted = false;
  // Store terminal state for late subscribers
  let terminal: QueueItem<T> | null = null;
  // Guard to prevent re-entrant commit loops
  let isCommitting = false;

  /* ------------------------------------------------------------------------ */
  /* Commit barrier (stamp-ordered, terminal-aware)                           */
  /* ------------------------------------------------------------------------ */

  const tryCommit = () => {
    // Prevent recursive stack overflows
    if (isCommitting) return;
    isCommitting = true;

    try {
      // Loop as long as we have items and everyone is ready
      while (queue.length > 0 && ready.size === receivers.size) {
        const item = queue[0]; // Peek first
        const targets = Array.from(ready);
        
        // We do not shift() yet. We need to ensure we can dispatch successfully.
        // Actually, in your logic, you shift immediately. 
        // We will stick to your logic: once ready, we commit to processing this item.
        queue.shift(); 
        ready.clear();

        const stamp = item.stamp;
        let pendingAsync = 0;

        // Wrap execution in stamp context
        withEmissionStamp(stamp, () => {
          if (item.kind === "next") {
            latestValue = item.value;

            for (const r of targets) {
              const result = r.next(item.value);
              
              if (isPromiseLike(result)) {
                pendingAsync++;
                result.finally(() => {
                  if (!r.completed && receivers.has(r)) {
                    ready.add(r);
                    // Resume the loop via recursion entry point, 
                    // but guard protects stack
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
            // Terminal state
            for (const r of targets) {
              if (item.kind === "complete") r.complete();
              else r.error(item.error);
            }
            receivers.clear();
            ready.clear();
            queue.length = 0;
            // Stop processing
            return; 
          }
        });

        // If any receiver returned a promise, we must pause the synchronous while loop
        // and wait for the finally blocks to trigger tryCommit again.
        if (pendingAsync > 0) {
          break;
        }
        // If no promises, loop continues immediately (iterative, not recursive)
      }
    } finally {
      isCommitting = false;
    }
  };

  /* ------------------------------------------------------------------------ */
  /* Producer API                                                             */
  /* ------------------------------------------------------------------------ */

  const next = (value?: T) => {
    if (isCompleted) return;

    // OPTIONAL: If you want Hot Subject behavior (drop if no listeners),
    // uncomment the check below. Current behavior behaves like an infinite ReplaySubject until first sub.
    // if (receivers.size === 0) return; 

    const current = getCurrentEmissionStamp();
    const base = current ?? nextEmissionStamp();
    const stamp = current === null ? -base : base;

    queue.push({ kind: "next", value: value as T, stamp });
    tryCommit();
  };

  const complete = () => {
    if (isCompleted) return;
    isCompleted = true;

    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    const item = { kind: "complete", stamp } as QueueItem<T>;
    terminal = item;
    queue.push(item);
    tryCommit();
  };

  const error = (err: any) => {
    if (isCompleted) return;
    isCompleted = true;

    const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
    const errorValue = err instanceof Error ? err : new Error(String(err));

    const item = { kind: "error", error: errorValue, stamp } as QueueItem<T>;
    terminal = item;
    queue.push(item);
    tryCommit();
  };

  /* ------------------------------------------------------------------------ */
  /* Subscription                                                             */
  /* ------------------------------------------------------------------------ */

  const register = (receiver: Receiver<T>): Subscription => {
    const r = receiver as StrictReceiver<T>;

    // If subject already reached terminal state, deliver terminal immediately
    if (terminal) {
      const item = terminal;
      if (item.kind === "complete") {
        withEmissionStamp(item.stamp, () => r.complete());
      } else if (item.kind === "error") {
        const err = item.error;
        withEmissionStamp(item.stamp, () => r.error(err));
      }
      // Return a noop subscription — nothing to unsubscribe from
      return createSubscription();
    }

    receivers.add(r);
    ready.add(r);
    tryCommit();

    return createSubscription(() => {
      receivers.delete(r);
      ready.delete(r);

      // If this receiver was the one holding up the queue (it wasn't ready),
      // removing it might satisfy ready.size === receivers.size
      
      const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
      withEmissionStamp(stamp, () => r.complete());

      tryCommit();
    });
  };

  const subscribe = (cb?: ((value: T) => any) | Receiver<T>) =>
    register(createReceiver(cb));

  /* ------------------------------------------------------------------------ */
  /* Async iterator                                                           */
  /* ------------------------------------------------------------------------ */

  const asyncIterator = (): AsyncIterator<T> => {
    const receiver = createReceiver<T>();

    let pullResolve: ((v: IteratorResult<T>) => void) | null = null;
    let pullReject: ((e: any) => void) | null = null;

    // Promise that the Subject waits on if the buffer is full
    let backpressureResolve: (() => void) | null = null;

    let pending: IteratorResult<T> | null = null;
    let pendingStamp: number | null = null;
    
    let pendingError: any = null;
    let pendingErrorStamp: number | null = null;

    let sub: Subscription | null = null;

    const iterator: AsyncIterator<T> = {
      next() {
        if (!sub) sub = register(iteratorReceiver);

        // 1. Flush Error
        if (pendingError) {
          const err = pendingError;
          const stamp = pendingErrorStamp!;
          pendingError = null;
          pendingErrorStamp = null;
          setIteratorEmissionStamp(iterator as any, stamp);
          return Promise.reject(err);
        }

        // 2. Flush Value
        if (pending) {
          const r = pending;
          const stamp = pendingStamp!;
          pending = null;
          pendingStamp = null;
          setIteratorEmissionStamp(iterator as any, stamp);
          
          // CRITICAL: Release the Subject lock!
          if (backpressureResolve) {
            const resolve = backpressureResolve;
            backpressureResolve = null;
            resolve();
          }
          
          return Promise.resolve(r);
        }

        // 3. Wait for new value
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
        // Clean up backpressure to prevent deadlocks in Subject
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

        // If iterator is actively pulling, satisfy it immediately
        if (pullResolve) {
          setIteratorEmissionStamp(iterator as any, stamp);
          const r = pullResolve;
          pullResolve = pullReject = null;
          r({ done: false, value });
          // Return void: we are ready for the next one immediately
          return; 
        }

        // If not pulling, we BUFFER.
        pending = { done: false, value };
        pendingStamp = stamp;

        // CRITICAL: We return a Promise to the Subject.
        // The Subject will wait (stall the pipeline) until this promise resolves.
        // We resolve this promise only when the user calls iterator.next() and consumes the buffer.
        return new Promise<void>(resolve => {
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

  const subject: Subject<T> = {
    type: "subject",
    name: "subject",
    id,
    get value() { return latestValue; },
    pipe(...steps: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, steps);
    },
    subscribe,
    async query(): Promise<T> { return firstValueFrom(this); },
    next,
    complete,
    error,
    completed: () => isCompleted,
    [Symbol.asyncIterator]: asyncIterator,
  };

  return subject;
}