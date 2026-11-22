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
import { ANALOG_DELIVERY, bindProducerCompletion } from '../atoms/delivery';
import { cyclicBuffer, type CyclicBuffer, type CyclicBufferOverflow } from '../primitives/cyclicBuffer';

/** The write-only producer interface for adapting callback-driven APIs. */
export interface PushSink<T> {
  /**
   * Delivers a value. Await this for cooperative backpressure in discrete
   * mode.
   *
   * Resolves when the value is accepted into the bounded buffer, or when the
   * overflow policy drops it — it does not wait for delivery, the atom's
   * current value update, or subscriber callbacks. In discrete mode, awaiting
   * applies backpressure only while the buffer is full. In analog mode the
   * value is admitted immediately, replacing the newest pending value when
   * the buffer is full, so `next()` never blocks.
   */
  next(value: T): Promise<void>;
  /** Terminates the source with an error; queued values are discarded. */
  error(reason: unknown): void;
  /**
   * Stops accepting new values. Producers already blocked inside `next()`
   * are admitted and delivered before the source completes; pushes made after
   * this call resolve but are ignored.
   */
  complete(): void;
}

export type PushOverflow = Exclude<CyclicBufferOverflow, 'replace-latest'>;

export interface FromPushOptions {
  /** Optional diagnostic name. */
  name?: string;
  /**
   * Discrete preserves each accepted event. Analog retains the pending prefix
   * and replaces only the newest pending value when the buffer is full; with
   * the default capacity of 1, every push replaces the pending value.
   */
  mode?: 'discrete' | 'analog';
  /**
   * Maximum accepted events awaiting delivery. With prefetching (the default)
   * the per-iterator delivery queue is bounded by the same capacity, so both
   * stages can hold up to this many values. With `prefetch: false` only the
   * admission buffer exists. In analog mode it bounds the retained prefix
   * plus the coalesced newest value.
   */
  capacity?: number;
  /** Discrete overflow handling; defaults to `block`. Ignoring returned promises defeats backpressure. */
  overflow?: PushOverflow;
  /**
   * Iterator delivery strategy; defaults to `true`.
   *
   * With prefetching, the pump moves accepted values into a per-iterator
   * queue (also bounded by `capacity`) so pulls return immediately. A lagging
   * iterator can therefore hold up to `capacity` accepted values in addition
   * to the admission buffer, and producer backpressure reflects admission
   * only. Set this to `false` to have the iterator pull directly from the
   * bounded admission queue: no delivery backlog is populated, a pull waits
   * for admission, and `next()` backpressure reflects the consumer's pull
   * rate. Callback subscribers are notified as values are pulled in this
   * mode; without an active iterator they still receive values from the pump.
   */
  prefetch?: boolean;
}

type Cleanup = () => MaybePromise<void>;
type Connect<T> = (sink: PushSink<T>, signal: AbortSignal) => MaybePromise<void | Cleanup>;

type Listener<T> = { callback?: (current: T, previous: T) => MaybePromise; replay?: Promise<void> };
type IteratorWaiter<T> = { resolve: (value: IteratorResult<T>) => void; reject: (error: Error) => void };
type ConsumerIterator<T> = {
  queue: CyclicBuffer<T>;
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
  queued: CyclicBuffer<T>;
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
 * `next()` resolves when the value is accepted into the bounded buffer, or
 * when the overflow policy drops it. It does not wait for delivery, the
 * current value update, or callback subscribers; those happen asynchronously
 * in the pump. In discrete mode, awaiting `next()` applies backpressure only
 * while the buffer is full. External APIs that ignore `next()` promises
 * cannot be flow-controlled; select a dropping/error overflow policy for
 * those APIs if memory must remain bounded.
 *
 * In `analog` mode the source-side buffer keeps its pending prefix and
 * replaces the newest pending value when full, so a consumer that falls
 * behind sees the oldest queued values followed by the newest one. `capacity`
 * bounds how many prefix values are retained and defaults to 1, where every
 * push replaces the pending value and `next()` never blocks.
 *
 * `complete()` stops accepting new values but still admits producers that are
 * already blocked inside `next()`; the source completes after those values and
 * the buffered prefix have been delivered. Pushes made after `complete()`
 * resolve without being delivered.
 *
 * By default the pump prefetches accepted values into a per-iterator queue.
 * Pass `prefetch: false` when the iterator itself should pull from the bounded
 * admission buffer, so producer backpressure reflects the pull rate and no
 * second backlog exists.
 *
 * This implementation intentionally supports one active async iterator, matching
 * the existing Streamix shared-source contract. Callback subscribers multicast.
 */
export function fromPush<T>(connect: Connect<T>, options: FromPushOptions = {}): Readable<T> {
  return createPushSource(connect, options);
}

/** Shared push lifecycle for factories with explicit cleanup error semantics. */
export function createPushSource<T>(connect: Connect<T>, options: FromPushOptions, reportCleanupErrors = false): Readable<T> {
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
  if (options.prefetch !== undefined && typeof options.prefetch !== 'boolean') {
    throw new TypeError('fromPush prefetch must be a boolean');
  }
  const prefetch = options.prefetch ?? true;

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
  let disposal: Promise<void> | undefined;
  const completionListeners = new Set<() => void>();

  const runCleanup = async (cleanup?: Cleanup) => {
    if (!cleanup) return;
    try { await cleanup(); }
    catch (error) { if (reportCleanupErrors) throw error; }
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
    if (error) it.queue.abort(error);
    else it.queue.complete();
    while (it.waiters.length) {
      const waiter = it.waiters.shift()!;
      if (error) waiter.reject(error);
      else waiter.resolve(it.queue.tryShift() ?? DONE);
    }
    releaseIteratorSpace(it);
  };

  const stopSession = (session: Session<T>): Promise<void> => {
    if (session.cleanupPromise) return session.cleanupPromise;
    let finish!: (cleanup: Promise<void>) => void;
    const cleanupPromise = new Promise<void>(resolve => { finish = resolve; });
    session.cleanupPromise = cleanupPromise;
    cleanupBarrier = cleanupPromise;
    const releaseBarrier = () => {
      if (cleanupBarrier === cleanupPromise) cleanupBarrier = undefined;
    };
    void cleanupPromise.then(releaseBarrier, releaseBarrier);
    session.stopped = true;
    if (currentSession === session) currentSession = null;
    session.controller.abort();

    // Resolve pending producer pushes. Old session callbacks cannot cross into
    // the next session, even if their originating transport emits late.
    session.queued.abort();
    if (consumer) releaseIteratorSpace(consumer);

    if (session.settled) {
      // Setup already returned its cleanup synchronously (the common case for
      // DOM/timer sources). Tear down in the same turn so `unsubscribe()` and
      // `dispose()` have the same synchronous cleanup semantics as other atoms.
      const fn = session.cleanup;
      session.cleanup = undefined;
      finish(runCleanup(fn));
    } else {
      const ready = session.ready ?? Promise.resolve();
      // `ready` is responsible for running cleanup if setup settles after stop.
      finish(ready.then(async () => {
        const fn = session.cleanup;
        session.cleanup = undefined;
        await runCleanup(fn);
      }));
    }
    return cleanupPromise;
  };

  const finishComplete = (session: Session<T>) => {
    if (session.stopped || session.queued.length || session.pumping) return;
    completed = true;
    finishIterator();
    void stopSession(session);
    for (const listener of completionListeners) {
      try { listener(); } catch { /* Completion observers cannot interrupt delivery. */ }
    }
    completionListeners.clear();
  };

  const fail = (session: Session<T>, reason: unknown) => {
    if (session.stopped || closed || completed) return;
    failed = normalizeError(reason);
    completed = true;
    completionListeners.clear();
    state.fail(failed, { terminate: false });
    finishIterator(failed);
    void stopSession(session);
  };

  /** Publishes a dequeued value to the atom and callback subscribers. */
  const deliver = (value: T): Promise<unknown>[] => {
    state.next(value);
    hasCurrent = true;
    const pending: Promise<unknown>[] = [];
    for (const listener of listeners) {
      if (!listener.callback) continue;
      // Replays and event delivery are serialized per listener.
      const invoke = () => listener.callback!(value, value);
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
    return pending;
  };

  const pump = async (session: Session<T>) => {
    if (session.pumping || session.stopped) return;
    session.pumping = true;
    try {
      while (!session.stopped && session.queued.length) {
        const it = consumer;
        // Pull delivery disables the per-iterator queue: values stay in the
        // bounded admission buffer until an iterator pull asks for one.
        const pulling = !prefetch && !!it && !it.closed;
        if (pulling && !it!.waiters.length) break;
        // The iterator is optional, but if it exists discrete delivery cannot
        // overrun its bounded queue while the consumer is not pulling.
        if (it && !it.closed && !analog && !pulling) {
          while (!session.stopped && !it.closed && it.queue.length >= capacity) {
            await new Promise<void>(resolve => it.roomWaiters.push(() => resolve()));
          }
        }
        if (session.stopped) break;

        const item = session.queued.tryShift()!;

        if (it && !it.closed) {
          if (it.waiters.length) {
            it.waiters.shift()!.resolve(item);
          } else {
            it.queue.tryPush(item.value);
          }
        }

        const pending = deliver(item.value);
        if (pending.length) await Promise.all(pending);
      }
    } catch (error) {
      fail(session, error);
    } finally {
      session.pumping = false;
      if (!session.stopped && session.queued.length) {
        const it = consumer;
        // Pull-mode values wait for the next iterator pull; rescheduling here
        // would spin while the consumer is idle.
        if (!(!prefetch && it && !it.closed && !it.waiters.length)) void pump(session);
      } else if (session.finishing) {
        finishComplete(session);
      }
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
    try {
      if (session.queued.tryPush(value)) schedulePump(session);
      else if (overflow === 'block') {
        const admitted = session.queued.push(value);
        schedulePump(session);
        return admitted;
      }
    } catch {
      fail(session, new Error('fromPush buffer capacity exceeded'));
    }
    return Promise.resolve();
  };

  const startSession = () => {
    if (closed || completed || currentSession || (!listeners.size && !consumer)) return;
    const session: Session<T> = {
      controller: new AbortController(), stopped: false, finishing: false,
      pumping: false, pumpScheduled: false, settled: false,
      queued: cyclicBuffer<T>(capacity, { overflow: analog ? 'replace-latest' : overflow }),
    };
    currentSession = session;

    const activate = () => {
      if (session.stopped || currentSession !== session) return;
      let connected!: (setup?: Promise<void>) => void;
      // Install the setup barrier before connect() can synchronously complete,
      // fail, or reenter disposal.
      session.ready = new Promise<void>(resolve => { connected = resolve; });
      const sink: PushSink<T> = {
        next: value => next(session, value),
        error: reason => fail(session, reason),
        complete: () => {
          if (session.stopped || session.finishing || closed) return;
          session.finishing = true;
          session.queued.complete();
          finishComplete(session);
        },
      };
      try {
        const result = connect(sink, session.controller.signal);
        if (isPromiseLike(result)) {
          connected(Promise.resolve(result).then(
            value => {
              session.cleanup = value as Cleanup | undefined;
              session.settled = true;
            },
            reason => fail(session, reason),
          ));
        } else {
          session.cleanup = typeof result === 'function' ? result : undefined;
          session.settled = true;
          connected();
        }
      } catch (error) {
        connected();
        fail(session, error);
      }
    };

    // Serialize reconnection behind asynchronous teardown of the old producer.
    if (cleanupBarrier) void cleanupBarrier.then(activate, activate);
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
      queue: cyclicBuffer<T>(capacity, { overflow: analog ? 'replace-latest' : 'block' }),
      waiters: [], roomWaiters: [], closed: false, ended: false,
    };
    consumer = it;
    startSession();
    return {
      next: async () => {
        if (it.closed) return DONE;
        const item = it.queue.tryShift();
        if (item) {
          releaseIteratorSpace(it);
          return item;
        }
        if (it.ended) return failed ? Promise.reject(failed) : DONE;
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          it.waiters.push({ resolve, reject });
          // In pull mode the pump leaves accepted values in the admission
          // buffer until a waiter asks for one.
          if (!prefetch && currentSession) schedulePump(currentSession);
        });
      },
      return: async () => {
        if (it.closed) return DONE;
        it.closed = true;
        it.queue.abort();
        for (const waiter of it.waiters.splice(0)) waiter.reject(new Error('Iterator returned'));
        releaseIteratorSpace(it);
        if (consumer === it) consumer = null;
        await endIfIdle();
        return DONE;
      },
      throw: async (reason: unknown) => {
        const error = normalizeError(reason);
        it.closed = true;
        it.queue.abort();
        for (const waiter of it.waiters.splice(0)) waiter.reject(error);
        releaseIteratorSpace(it);
        if (consumer === it) consumer = null;
        await endIfIdle();
        throw error;
      },
    };
  };

  instance.dispose = () => {
    if (disposal) return disposal;
    let finish!: (cleanup: Promise<void>) => void;
    disposal = new Promise<void>(resolve => { finish = resolve; });
    void disposal.catch(() => {});
    closed = true;
    completed = true;
    completionListeners.clear();
    listeners.clear();
    if (consumer) {
      const it = consumer;
      consumer = null;
      it.closed = true;
      it.queue.abort();
      for (const waiter of it.waiters.splice(0)) waiter.reject(new Error('Source disposed'));
      releaseIteratorSpace(it);
    }
    const cleanup = currentSession ? stopSession(currentSession) : cleanupBarrier;
    finish(Promise.all([cleanup, baseDispose()]).then(() => {}));
    return disposal;
  };

  bindProducerCompletion(instance, {
    get completed() { return completed && !closed && !failed; },
    onComplete(listener) {
      completionListeners.add(listener);
      return () => { completionListeners.delete(listener); };
    },
  });
  if (analog) (instance as any)[ANALOG_DELIVERY] = true;
  return instance;
}
