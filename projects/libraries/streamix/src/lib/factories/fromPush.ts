import {
  atom,
  isPromiseLike,
  NO_INITIAL_VALUE,
  type Readable,
  type MaybePromise,
  type Writable,
} from '../atoms';
import { normalizeError } from '../atoms/atom';
import { DONE } from '../atoms/operator';
import { createSubscription } from '../atoms/subscription';
import { ANALOG_DELIVERY } from '../atoms/delivery';

/** The write-only producer interface for adapting callback-driven APIs. */
export interface PushSink<T> {
  /** Delivers a value. Await this for cooperative backpressure in discrete mode. */
  next(value: T): Promise<void>;
  /** Terminates the source with an error; queued values are discarded. */
  error(reason: unknown): void;
  /** Stops accepting values, then delivers already accepted values before completing. */
  complete(): void;
}

export type PushOverflow = 'block' | 'drop-oldest' | 'drop-newest' | 'error';

export interface FromPushOptions {
  /** Optional diagnostic name. */
  name?: string;
  /** Discrete preserves each accepted event; analog retains only the latest pending event. */
  mode?: 'discrete' | 'analog';
  /** Maximum accepted events awaiting delivery (and per-iterator backlog). */
  capacity?: number;
  /** Discrete overflow handling; defaults to `block`. Ignoring returned promises defeats backpressure. */
  overflow?: PushOverflow;
}

type Cleanup = () => MaybePromise<void>;
type Connect<T> = (sink: PushSink<T>, signal: AbortSignal) => MaybePromise<void | Cleanup>;

type Delivery<T> = { value: T; resolve: () => void };
type Listener<T> = { callback?: (current: T, previous: T) => MaybePromise; replay?: Promise<void> };
type IteratorWaiter<T> = { resolve: (value: IteratorResult<T>) => void; reject: (error: Error) => void };
type ConsumerIterator<T> = {
  queue: T[];
  waiters: IteratorWaiter<T>[];
  roomWaiters: Array<() => void>;
  closed: boolean;
  ended: boolean;
};

type Session<T> = {
  controller: AbortController;
  stopped: boolean;
  finishing: boolean;
  pumping: boolean;
  pumpScheduled: boolean;
  settled: boolean;
  queued: Delivery<T>[];
  blocked: Delivery<T>[];
  cleanup?: Cleanup;
  ready?: Promise<void>;
  cleanupPromise?: Promise<void>;
};

/**
 * Adapts an externally pushed event source to a shared Streamix Readable.
 *
 * Connection is lazy and shared among callback subscribers and one active async
 * iterator. The source disconnects when the last consumer leaves. Reconnecting
 * creates a new session; late events from an old session are ignored.
 *
 * Subscribers receive the latest current value immediately when available.
 * The async iterator receives new events (not a replay of the current snapshot).
 *
 * `next()` awaits delivery to all callback subscribers, including async callbacks.
 * In discrete mode, it also waits when the bounded iterator queue is full.
 * External APIs that ignore `next()` promises cannot be flow-controlled; select
 * a dropping/error overflow policy for those APIs if memory must remain bounded.
 *
 * This implementation intentionally supports one active async iterator, matching
 * the existing Streamix shared-source contract. Callback subscribers multicast.
 */
export function fromPush<T>(connect: Connect<T>, options: FromPushOptions = {}): Readable<T> {
  const mode = options.mode ?? 'discrete';
  const analog = mode === 'analog';
  const capacity = options.capacity ?? (analog ? 1 : 16);
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError('fromPush capacity must be a positive safe integer');
  }
  const overflow = options.overflow ?? (analog ? 'drop-oldest' : 'block');
  if (analog && (overflow === 'block' || overflow === 'error')) {
    throw new TypeError('fromPush analog mode requires a dropping overflow policy');
  }

  const state = atom<T>(NO_INITIAL_VALUE) as Writable<T>;
  const baseDispose = state.dispose.bind(state);
  const listeners = new Set<Listener<T>>();
  let consumer: ConsumerIterator<T> | null = null;
  let currentSession: Session<T> | null = null;
  let cleanupBarrier: Promise<void> | undefined;
  let closed = false;
  let completed = false;
  let hasCurrent = false;
  let failed: Error | undefined;

  const quietCleanup = async (cleanup?: Cleanup) => {
    if (!cleanup) return;
    try { await cleanup(); } catch { /* Secondary cleanup errors do not replace source errors. */ }
  };

  const releaseIteratorSpace = (it: ConsumerIterator<T>) => {
    while (it.roomWaiters.length > 0 && (it.closed || it.queue.length < capacity)) {
      it.roomWaiters.shift()!();
    }
  };

  const finishIterator = (error?: Error) => {
    const it = consumer;
    if (!it || it.closed) return;
    it.ended = true;
    if (error) it.queue.length = 0;
    while (it.waiters.length) {
      const waiter = it.waiters.shift()!;
      if (error) waiter.reject(error);
      else if (it.queue.length > 0) waiter.resolve({ done: false, value: it.queue.shift()! });
      else waiter.resolve(DONE);
    }
    releaseIteratorSpace(it);
  };

  const stopSession = (session: Session<T>): Promise<void> => {
    if (session.cleanupPromise) return session.cleanupPromise;
    session.stopped = true;
    session.controller.abort();
    if (currentSession === session) currentSession = null;

    // Resolve pending producer pushes. Old session callbacks cannot cross into
    // the next session, even if their originating transport emits late.
    for (const record of session.queued.splice(0)) record.resolve();
    for (const record of session.blocked.splice(0)) record.resolve();
    if (consumer) releaseIteratorSpace(consumer);

    let cleanupPromise: Promise<void>;
    if (session.settled) {
      // Setup already returned its cleanup synchronously (the common case for
      // DOM/timer sources). Tear down in the same turn so `unsubscribe()` and
      // `dispose()` have the same synchronous cleanup semantics as other atoms.
      const fn = session.cleanup;
      session.cleanup = undefined;
      cleanupPromise = quietCleanup(fn);
    } else {
      const ready = session.ready ?? Promise.resolve();
      // `ready` is responsible for running cleanup if setup settles after stop.
      cleanupPromise = ready.then(async () => {
        const fn = session.cleanup;
        session.cleanup = undefined;
        await quietCleanup(fn);
      });
    }
    session.cleanupPromise = cleanupPromise;
    cleanupBarrier = cleanupPromise;
    void cleanupPromise.finally(() => {
      if (cleanupBarrier === cleanupPromise) cleanupBarrier = undefined;
    });
    return cleanupPromise;
  };

  const finishComplete = (session: Session<T>) => {
    if (session.stopped || session.queued.length || session.blocked.length || session.pumping) return;
    completed = true;
    finishIterator();
    void stopSession(session);
  };

  const fail = (session: Session<T>, reason: unknown) => {
    if (session.stopped || closed || completed) return;
    failed = normalizeError(reason);
    completed = true;
    state.fail(failed, { terminate: false });
    finishIterator(failed);
    void stopSession(session);
  };

  const admitBlocked = (session: Session<T>) => {
    while (!session.stopped && session.queued.length < capacity && session.blocked.length) {
      session.queued.push(session.blocked.shift()!);
    }
  };

  const pump = async (session: Session<T>) => {
    if (session.pumping || session.stopped) return;
    session.pumping = true;
    try {
      while (!session.stopped && session.queued.length) {
        // The iterator is optional, but if it exists discrete delivery cannot
        // overrun its bounded queue while the consumer is not pulling.
        const it = consumer;
        if (it && !it.closed && !analog) {
          while (!session.stopped && !it.closed && it.queue.length >= capacity) {
            await new Promise<void>(resolve => it.roomWaiters.push(() => resolve()));
          }
        }
        if (session.stopped) break;

        const item = session.queued.shift()!;
        admitBlocked(session);

        if (it && !it.closed) {
          if (it.waiters.length) {
            it.waiters.shift()!.resolve({ done: false, value: item.value });
          } else if (analog && it.queue.length >= capacity) {
            it.queue[it.queue.length - 1] = item.value;
          } else {
            it.queue.push(item.value);
          }
        }

        state.next(item.value);
        hasCurrent = true;
        const pending: Promise<unknown>[] = [];
        for (const listener of listeners) {
          if (!listener.callback) continue;
          // Replays and event delivery are serialized per listener.
          const invoke = () => listener.callback!(item.value, item.value);
          if (listener.replay) {
            const chained = listener.replay.then(invoke).catch(() => {});
            listener.replay = Promise.resolve(chained).then(() => {});
            pending.push(chained);
          } else {
            try {
              const result = invoke();
              if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
                pending.push(Promise.resolve(result).catch(() => {}));
              }
            } catch { /* Subscriber errors stay isolated. */ }
          }
        }
        if (pending.length) await Promise.all(pending);
        item.resolve();
      }
    } catch (error) {
      fail(session, error);
    } finally {
      session.pumping = false;
      if (!session.stopped && session.queued.length) void pump(session);
      else if (session.finishing) finishComplete(session);
    }
  };

  const schedulePump = (session: Session<T>) => {
    if (session.pumpScheduled || session.pumping) return;
    session.pumpScheduled = true;
    // Deliver on a microtask, like the shared-source ring buffer did: a
    // synchronous burst coalesces (analog keeps the latest), and an initial
    // emission can still be cancelled by an immediate unsubscribe.
    queueMicrotask(() => {
      session.pumpScheduled = false;
      void pump(session);
    });
  };

  const next = (session: Session<T>, value: T): Promise<void> => {
    if (closed || completed || session.stopped || session.finishing) return Promise.resolve();
    return new Promise<void>(resolve => {
      const delivery: Delivery<T> = { value, resolve: () => resolve() };
      if (analog && session.queued.length >= capacity) {
        const replaced = session.queued.pop()!;
        replaced.resolve();
        session.queued.push(delivery);
      } else if (session.queued.length < capacity) {
        session.queued.push(delivery);
      } else if (overflow === 'drop-oldest') {
        session.queued.shift()!.resolve();
        session.queued.push(delivery);
      } else if (overflow === 'drop-newest') {
        resolve();
        return;
      } else if (overflow === 'error') {
        resolve();
        fail(session, new Error('fromPush buffer capacity exceeded'));
        return;
      } else {
        // Cooperative backpressure. Producers must await `next()`; a native
        // event emitter cannot be paused merely by returning a Promise.
        session.blocked.push(delivery);
      }
      schedulePump(session);
    });
  };

  const startSession = () => {
    if (closed || completed || currentSession || (!listeners.size && !consumer)) return;
    const session: Session<T> = {
      controller: new AbortController(), stopped: false, finishing: false,
      pumping: false, pumpScheduled: false, settled: false, queued: [], blocked: [],
    };
    currentSession = session;

    const activate = () => {
      if (session.stopped || currentSession !== session) return;
      const sink: PushSink<T> = {
        next: value => next(session, value),
        error: reason => fail(session, reason),
        complete: () => {
          if (session.stopped || session.finishing || closed) return;
          session.finishing = true;
          finishComplete(session);
        },
      };
      try {
        const result = connect(sink, session.controller.signal);
        if (isPromiseLike(result)) {
          session.ready = Promise.resolve(result).then(
            value => {
              const cleanup = value as Cleanup | undefined;
              if (session.stopped) return quietCleanup(cleanup);
              session.cleanup = cleanup;
              session.settled = true;
              return;
            },
            reason => fail(session, reason),
          );
        } else {
          session.cleanup = typeof result === 'function' ? result : undefined;
          session.settled = true;
          if (session.stopped) {
            // The session stopped while connect() was still running (for
            // example a synchronous emit unsubscribed the last consumer).
            // stopSession() ran before the cleanup existed; run it now.
            const cleanup = session.cleanup;
            session.cleanup = undefined;
            void quietCleanup(cleanup);
          }
        }
      } catch (error) { fail(session, error); }
    };

    // Serialize reconnection behind asynchronous teardown of the old producer.
    if (cleanupBarrier) void cleanupBarrier.then(activate);
    else activate();
  };

  const endIfIdle = (): Promise<void> | undefined => {
    if (listeners.size || consumer || !currentSession) return;
    return stopSession(currentSession);
  };

  const instance = state as Writable<T> & { name?: string; subscriberCount?: number };
  Object.defineProperties(instance, {
    name: { value: options.name, configurable: true, enumerable: true },
    subscriberCount: { get: () => listeners.size + (consumer ? 1 : 0), configurable: true },
  });

  instance.subscribe = callback => {
    if (closed || completed) {
      if (callback && hasCurrent && !failed) {
        try { void Promise.resolve(callback(state.safeValue, state.safeValue)).catch(() => {}); } catch {}
      }
      return createSubscription();
    }
    const listener: Listener<T> = { callback };
    listeners.add(listener);
    const subscription = createSubscription(() => {
      listeners.delete(listener);
      return endIfIdle();
    });

    if (callback && hasCurrent && !failed) {
      try {
        const replay = callback(state.safeValue, state.safeValue);
        if (replay && typeof (replay as PromiseLike<unknown>).then === 'function') {
          listener.replay = Promise.resolve(replay).then(() => {}, () => {});
        }
      } catch { /* Subscriber errors stay isolated. */ }
    }
    startSession();
    return subscription;
  };

  instance[Symbol.asyncIterator] = () => {
    if (closed || completed || consumer) {
      return {
        next: async () => DONE,
        return: async () => DONE,
        throw: async (reason?: unknown) => Promise.reject(normalizeError(reason)),
      };
    }
    const it: ConsumerIterator<T> = {
      queue: [], waiters: [], roomWaiters: [], closed: false, ended: false,
    };
    consumer = it;
    startSession();
    return {
      next: async () => {
        if (it.closed) return DONE;
        if (it.queue.length) {
          const value = it.queue.shift()!;
          releaseIteratorSpace(it);
          return { done: false, value };
        }
        if (it.ended) return failed ? Promise.reject(failed) : DONE;
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          it.waiters.push({ resolve, reject });
        });
      },
      return: async () => {
        if (it.closed) return DONE;
        it.closed = true;
        it.queue.length = 0;
        for (const waiter of it.waiters.splice(0)) waiter.reject(new Error('Iterator returned'));
        releaseIteratorSpace(it);
        if (consumer === it) consumer = null;
        await endIfIdle();
        return DONE;
      },
      throw: async (reason: unknown) => {
        const error = normalizeError(reason);
        it.closed = true;
        it.queue.length = 0;
        for (const waiter of it.waiters.splice(0)) waiter.reject(error);
        releaseIteratorSpace(it);
        if (consumer === it) consumer = null;
        await endIfIdle();
        throw error;
      },
    };
  };

  instance.dispose = () => {
    if (closed) return;
    closed = true;
    completed = true;
    listeners.clear();
    if (consumer) {
      const it = consumer;
      consumer = null;
      it.closed = true;
      it.queue.length = 0;
      for (const waiter of it.waiters.splice(0)) waiter.reject(new Error('Source disposed'));
      releaseIteratorSpace(it);
    }
    if (currentSession) void stopSession(currentSession);
    baseDispose();
  };

  if (analog) (instance as any)[ANALOG_DELIVERY] = true;
  return instance;
}
