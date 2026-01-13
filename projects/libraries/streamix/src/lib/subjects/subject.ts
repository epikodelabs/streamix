import {
  createReceiver,
  createSubscription,
  generateStreamId,
  isPromiseLike,
  type MaybePromise,
  type Operator,
  pipeSourceThrough,
  type Receiver,
  type Stream,
  type StrictReceiver,
  type Subscription,
} from "../abstractions";
import { firstValueFrom } from "../converters";

/* ========================================================================== */
/* Types                                                                      */
/* ========================================================================== */

export type Subject<T = any> = Stream<T> & {
  next(value?: T): void;
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get value(): T | undefined;
};

/* ========================================================================== */
/* Subject                                                                    */
/* ========================================================================== */

export function createSubject<T = any>(): Subject<T> {
  const id = generateStreamId();

  /* ------------------------------------------------------------------------ */
  /* State                                                                     */
  /* ------------------------------------------------------------------------ */

  const receivers = new Set<StrictReceiver<T>>();
  const ready = new Set<StrictReceiver<T>>(); // receivers ready for next round
  const queue: T[] = [];

  let latestValue: T | undefined;

  let completed = false;
  let errored = false;
  let errorValue: Error | null = null;

  /* ------------------------------------------------------------------------ */
  /* Core commit logic (global backpressure barrier)                            */
  /* ------------------------------------------------------------------------ */

  const tryCommit = () => {
    if (queue.length === 0) return;
    if (ready.size !== receivers.size) return;

    const value = queue.shift()!;
    latestValue = value;

    const targets = Array.from(ready);
    ready.clear();

    for (const r of targets) {
      const result = r.next(value);

      if (isPromiseLike(result)) {
        // Receiver is busy; re-enter ready set when it finishes
        result.finally(() => {
          if (!r.completed && receivers.has(r)) {
            ready.add(r);
            tryCommit();
          }
        });
      } else {
        // Synchronous receiver → immediately ready again
        if (!r.completed && receivers.has(r)) {
          ready.add(r);
        }
      }
    }

    // In case all receivers were synchronous
    tryCommit();
  };

  /* ------------------------------------------------------------------------ */
  /* Producer API                                                              */
  /* ------------------------------------------------------------------------ */

  const next = (value?: T) => {
    if (completed || errored) return;
    queue.push(value as T);
    tryCommit();
  };

  const complete = () => {
    if (completed || errored) return;
    completed = true;
    queue.length = 0;

    for (const r of receivers) {
      r.complete();
    }

    receivers.clear();
    ready.clear();
  };

  const error = (err: any) => {
    if (completed || errored) return;
    errored = true;
    completed = true;
    queue.length = 0;

    errorValue = err instanceof Error ? err : new Error(String(err));

    for (const r of receivers) {
      r.error(errorValue);
    }

    receivers.clear();
    ready.clear();
  };

  /* ------------------------------------------------------------------------ */
  /* Subscription                                                              */
  /* ------------------------------------------------------------------------ */

  const register = (receiver: Receiver<T>): Subscription => {
    const r = receiver as StrictReceiver<T>;

    if (errored) {
      r.error(errorValue!);
      return createSubscription();
    }

    if (completed) {
      r.complete();
      return createSubscription();
    }

    receivers.add(r);
    ready.add(r); // auto-request immediately
    tryCommit();

    let closed = false;

    return createSubscription(() => {
      if (closed) return;
      closed = true;

      receivers.delete(r);
      ready.delete(r);

      // Unsubscribe triggers cleanup via complete (per your contract)
      r.complete();

      // Barrier may now open
      tryCommit();
    });
  };

  const subscribe = (
    callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>
  ): Subscription => {
    return register(createReceiver(callbackOrReceiver));
  };

  /* ------------------------------------------------------------------------ */
  /* Async iterator                                                            */
  /* ------------------------------------------------------------------------ */

  const asyncIterator = (): AsyncIterator<T> => {
    const receiver = createReceiver<T>();

    let pullResolve: ((v: IteratorResult<T>) => void) | null = null;
    let pullReject: ((e: any) => void) | null = null;

    let pending: IteratorResult<T> | null = null;
    let pendingError: any = null;

    const iteratorReceiver: StrictReceiver<T> = {
      ...receiver,

      next(value: T) {
        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          r({ value, done: false });
        } else {
          pending = { value, done: false };
        }
      },

      complete() {
        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          r({ value: undefined, done: true });
        } else {
          pending = { value: undefined, done: true };
        }
      },

      error(err: Error) {
        if (pullReject) {
          const r = pullReject;
          pullResolve = pullReject = null;
          r(err);
        } else {
          pendingError = err;
        }
      },
    };

    let sub: Subscription | null = null;

    return {
      next() {
        if (!sub) {
          sub = register(iteratorReceiver);
        }

        // Flush buffered error
        if (pendingError) {
          const e = pendingError;
          pendingError = null;
          return Promise.reject(e);
        }

        // Flush buffered value / completion
        if (pending) {
          const p = pending;
          pending = null;
          return Promise.resolve(p);
        }

        return new Promise<IteratorResult<T>>((res, rej) => {
          pullResolve = res;
          pullReject = rej;
        });
      },

      return() {
        sub?.unsubscribe();
        sub = null;
        return Promise.resolve({ value: undefined, done: true });
      },

      throw(err) {
        sub?.unsubscribe();
        sub = null;
        return Promise.reject(err);
      },
    };
  };

  /* ------------------------------------------------------------------------ */
  /* Public object                                                             */
  /* ------------------------------------------------------------------------ */

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
    completed: () => completed,

    [Symbol.asyncIterator]: asyncIterator,
  };

  return subject;
}
