import {
  createReceiver,
  createSubscription,
  generateStreamId,
  isPromiseLike,
  type MaybePromise,
  nextEmissionStamp,
  type Operator,
  pipeSourceThrough,
  type Receiver,
  type Stream,
  type StrictReceiver,
  type Subscription,
  withEmissionStamp,
} from "../abstractions";
import { firstValueFrom } from "../converters";

/**
 * `Subject<T>` — push-based multicast stream with global async backpressure.
 *
 * Semantics enforced by your tests:
 * - No replay for late subscribers
 * - Unsubscribe completes that receiver (cleanup)
 * - Global backpressure: if ANY receiver returns a Promise, Subject waits
 * - Async iterator participates in backpressure ONLY when iteration starts (lazy attach)
 */
export type Subject<T = any> = Stream<T> & {
  next(value?: T): void;
  complete(): void;
  error(err: any): void;
  completed(): boolean;
  get value(): T | undefined;
};

/**
 * `Subject<T>` — push-based multicast stream with global async backpressure.
 *
 * Semantics:
 * - No replay for late subscribers
 * - Unsubscribe completes that receiver (cleanup)
 * - Global backpressure: if ANY receiver returns a Promise, Subject waits
 * - Async iterator participates in backpressure ONLY when iteration starts (lazy attach)
 * @template T The type of values the subject emits.
 * @returns A new Subject instance that can multicast values to subscribers.
 */
export function createSubject<T = any>(): Subject<T> {
  const id = generateStreamId();

  let isCompleted = false;
  let hasError = false;
  let errorObj: any = null;
  let latestValue: T | undefined;

  /* ====================================================================== */
  /* SUBSCRIBERS                                                            */
  /* ====================================================================== */

  type Sub = { receiver: StrictReceiver<T>; active: boolean };
  const subs: Sub[] = [];

  /* ====================================================================== */
  /* GLOBAL SERIALIZED EMISSION QUEUE                                        */
  /* ====================================================================== */

  type Task =
    | { type: "next"; value: T }
    | { type: "complete" }
    | { type: "error"; error: any };

  const queue: Task[] = [];
  let draining = false;

  const drain = async () => {
    if (draining) return;
    draining = true;

    while (queue.length) {
      const task = queue.shift()!;

      if (task.type === "next") {
        if (isCompleted || hasError) continue;

        latestValue = task.value;
        const stamp = nextEmissionStamp();

        const promises: Promise<void>[] = [];

        for (const s of subs.slice()) {
          if (!s.active) continue;
          try {
            // FIX START: Explicitly capture result to handle void-returning withEmissionStamp
            let result: any;
            withEmissionStamp(stamp, () => {
              result = s.receiver.next(task.value);
            });

            if (isPromiseLike(result)) {
              promises.push(result as Promise<void>);
            }
            // FIX END
          } catch (e) {
            hasError = true;
            errorObj = e instanceof Error ? e : new Error(String(e));
            break;
          }
        }

        if (promises.length) {
          try {
            await Promise.all(promises);
          } catch (e) {
            hasError = true;
            errorObj = e instanceof Error ? e : new Error(String(e));
          }
        }

        if (hasError) {
          // enqueue terminal error handling once
          queue.unshift({ type: "error", error: errorObj });
        }
      }

      else if (task.type === "complete") {
        if (isCompleted || hasError) continue;
        isCompleted = true;

        const stamp = nextEmissionStamp();
        withEmissionStamp(stamp, () => {
          for (const s of subs.slice()) {
            if (s.active) {
              s.active = false;
              s.receiver.complete();
            }
          }
        });

        subs.length = 0;
      }

      else if (task.type === "error") {
        if (isCompleted || hasError) {
          // If already terminal, still ensure late-subs get terminal (handled in register)
          continue;
        }
        hasError = true;
        isCompleted = true;
        errorObj = task.error instanceof Error ? task.error : new Error(String(task.error));

        const stamp = nextEmissionStamp();
        withEmissionStamp(stamp, () => {
          for (const s of subs.slice()) {
            if (s.active) {
              s.active = false;
              s.receiver.error(errorObj);
            }
          }
        });

        subs.length = 0;
      }
    }

    draining = false;
  };

  /* ====================================================================== */
  /* PRODUCER API                                                           */
  /* ====================================================================== */

  const next = (value?: T) => {
    if (isCompleted || hasError) return;
    queue.push({ type: "next", value: value as T });
    drain();
  };

  const complete = () => {
    if (isCompleted || hasError) return;
    queue.push({ type: "complete" });
    drain();
  };

  const error = (err: any) => {
    if (isCompleted || hasError) return;
    queue.push({
      type: "error",
      error: err instanceof Error ? err : new Error(String(err)),
    });
    drain();
  };

  /* ====================================================================== */
  /* SUBSCRIPTIONS                                                          */
  /* ====================================================================== */

  const register = (receiver: Receiver<T>): Subscription => {
    const strict = receiver as StrictReceiver<T>;

    // terminal states for late subscribers
    if (hasError) {
      strict.error(errorObj);
      return createSubscription();
    }
    if (isCompleted) {
      strict.complete();
      return createSubscription();
    }

    const state: Sub = { receiver: strict, active: true };
    subs.push(state);

    return createSubscription(() => {
      if (!state.active) return;
      state.active = false;
      const idx = subs.indexOf(state);
      if (idx >= 0) subs.splice(idx, 1);
      // per your tests: unsubscribe triggers complete for cleanup
      strict.complete();
    });
  };

  /* ====================================================================== */
  /* ASYNC ITERATOR (LAZY ATTACH + TRUE BACKPRESSURE)                        */
  /* ====================================================================== */

  const createLazyIterator = (): AsyncGenerator<T> => {
    // Attached only after first next() call
    let attachedSub: Subscription | null = null;

    // buffer values if subject emits while iterator isn't awaiting
    const buffer: T[] = [];

    // waiting consumer resolver (iterator.next awaiting a value)
    let yieldResolve: ((r: IteratorResult<T, void>) => void) | null = null;

    // release gate for backpressure: resolves only when consumer requests again
    let releaseNext: (() => void) | null = null;

    let closed = false;
    let closedError: any = null;

    const ensureAttached = () => {
      if (attachedSub || closed) return;

      const iteratorReceiver: StrictReceiver<T> = {
        next(value: T) {
          // deliver immediately to iterator (or buffer)
          if (yieldResolve) {
            const r = yieldResolve;
            yieldResolve = null;
            r({ done: false, value });
          } else {
            buffer.push(value);
          }

          // backpressure: block subject from emitting next value until iterator requests again
          return new Promise<void>((resolve) => {
            releaseNext = resolve;
          });
        },
        complete() {
          closed = true;
          if (yieldResolve) {
            const r = yieldResolve;
            yieldResolve = null;
            r({ done: true, value: undefined });
          }
        },
        error(e: Error) {
          closed = true;
          closedError = e;
          if (yieldResolve) {
            const r = yieldResolve;
            yieldResolve = null;
            // iterator.next() will throw on await, we reject by resolving a rejected promise
            r(Promise.reject(e) as any);
          }
        },
        get completed() {
          return closed;
        },
      };

      attachedSub = register(iteratorReceiver);
    };

    const it: AsyncGenerator<T> = {
      async next() {
        if (closed) {
          if (closedError) throw closedError;
          return { done: true, value: undefined };
        }

        ensureAttached();

        // consumer signals readiness -> releases subject for next emission
        if (releaseNext) {
          const r = releaseNext;
          releaseNext = null;
          r();
        }

        // buffered value available
        if (buffer.length > 0) {
          return { done: false, value: buffer.shift()! };
        }

        // wait for next value
        return await new Promise<IteratorResult<T, void>>((resolve) => {
          yieldResolve = resolve;
        });
      },

      async return(value?: any) {
        // stop iterating without completing the subject (important!)
        closed = true;
        if (attachedSub) {
          attachedSub.unsubscribe();
          attachedSub = null;
        }
        if (yieldResolve) {
          const r = yieldResolve;
          yieldResolve = null;
          r({ done: true, value: undefined });
        }
        return { done: true, value };
      },

      async throw(err?: any) {
        closed = true;
        closedError = err;
        if (attachedSub) {
          attachedSub.unsubscribe();
          attachedSub = null;
        }
        if (yieldResolve) {
          const r = yieldResolve;
          yieldResolve = null;
          r(Promise.reject(err) as any);
        }
        return { done: true, value: undefined };
      },

      [Symbol.asyncIterator]() {
        return this;
      },

      [Symbol.asyncDispose]: async () => {

      }

    } as any;

    (it as any).__streamix_streamId = id;
    return it;
  };

  /* ====================================================================== */
  /* SUBJECT                                                                */
  /* ====================================================================== */

  const subject: Subject<T> = {
    type: "subject",
    name: "subject",
    id,

    get value() {
      return latestValue;
    },

    next,
    complete,
    error,
    completed: () => isCompleted,

    subscribe(cb?: ((v: T) => MaybePromise) | Receiver<T>) {
      return register(createReceiver(cb));
    },

    pipe(...ops: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, ops);
    },

    async query() {
      return firstValueFrom(this);
    },

    [Symbol.asyncIterator]: () => createLazyIterator(),
  };

  return subject;
}
