import { type Operator, type Receiver } from "../abstractions";
import { createSubscription, type Subscription } from "../abstractions/subscription";
import { pipe as pipeSource } from "../streams/pipe";
import {
  getCurrentScope,
  getScopeStrobe,
  markAtomAsEmitted,
  registerAnalogAtom,
  registerWithCurrentScope,
  unregisterAnalogAtom,
} from "./scope";

/**
 * Common options for atom factories.
 */
export interface AtomOptions {
  /**
   * When `true`, the atom always emits updates immediately, bypassing any
   * scope-level or global strobe. When `false` or omitted, the atom follows
   * the effective mode of the owning scope (or the global scope).
   */
  discrete?: boolean;
}

/**
 * Base interface for all atoms.
 *
 * Atoms are reactive values that can be read, subscribed to, and disposed.
 * They automatically track dependencies for derived atoms and participate in
 * scope-based lifecycle management.
 *
 * @template T The type of the value held by this atom.
 */
export interface AtomBase<T = any> {
  /** Discriminator for runtime type checks. */
  type: "atom";

  /**
   * The current value.
   *
   * When accessed inside a {@link derived} factory, this atom is automatically
   * registered as a dependency.
   *
   * @throws {Error} If the atom has been disposed.
   */
  readonly value: T;

  /**
   * The current value, or the last known value if the atom has been disposed.
   *
   * Unlike {@link value}, this never throws. Use it when you need a defensive
   * read (e.g. snapshots, cleanup handlers).
   */
  readonly safeValue: T;

  /** The previous value (before the most recent change). */
  readonly prior: T;

  /** Whether the atom has been disposed. */
  readonly disposed: boolean;

  /**
   * Subscribes to value changes.
   *
   * The callback is invoked synchronously whenever the atom's value changes.
   *
   * @param callback - Function called with the new value, or a receiver with `next`/`complete`/`error`.
   * @returns A subscription that can be used to unsubscribe.
   */
  subscribe(callback: ((value: T) => void) | Receiver<T>): Subscription;

  /** Disposes the atom, clearing all subscriptions and resources. */
  dispose(): void;

  /**
   * Pipes this atom through one or more operators.
   *
   * This is a convenience wrapper around the standalone {@link pipe} function.
   */
  pipe<R = any>(...ops: Operator<any, any>[]): AtomBase<R>;

  /**
   * Returns an async iterator over the atom's future values.
   *
   * This makes atoms directly usable in `for await` loops.
   */
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

/**
 * Writable atom that extends {@link AtomBase} with a {@link set} method.
 *
 * @template T The type of the value held by this atom.
 */
export interface Atom<T = any> extends AtomBase<T> {
  /**
   * Updates the atom's value and notifies subscribers.
   *
   * If the new value is the same as the current value (using `Object.is`),
   * no notification occurs.
   *
   * @param value - The new value to set.
   */
  next(value: T): void;

  /**
   * Updates the atom's value and notifies subscribers.
   *
   * If the new value is the same as the current value (using `Object.is`),
   * no notification occurs.
   *
   * @param value - The new value to set.
   */
  set(value: T): void;

  /**
   * Signals that the atom has failed with the given error. The error is
   * propagated to consumers iterating the atom, and the atom is disposed.
   *
   * @param err - The error to emit.
   */
  error(err: any): void;
}

let activeFormula: { dependencies: Set<AtomBase<any>> } | null = null;

function toReceiver<T>(callback: ((value: T) => void) | Receiver<T>): Receiver<T> {
  return typeof callback === "function" ? { next: callback } : callback;
}

/* ── Glitch-free propagation ── */

let propagationDepth = 0;
let deferredNotifications = new Set<() => void>();

/** Flushes all deferred notifications that were queued during propagation. */
function flushDeferred() {
  const notifications = Array.from(deferredNotifications);
  deferredNotifications = new Set();
  for (const notify of notifications) {
    notify();
  }
}

/**
 * Runs a function inside a propagation context.
 *
 * Notifications are deferred until the outermost propagation completes,
 * ensuring glitch-free updates where derived atoms see a consistent state.
 *
 * @param fn - The function to run.
 */
function runWithPropagation(fn: () => void) {
  propagationDepth++;
  try {
    fn();
  } finally {
    propagationDepth--;
    if (propagationDepth === 0 && deferredNotifications.size > 0) {
      flushDeferred();
    }
  }
}

/**
 * Notifies derived subscribers, deferring if inside a propagation.
 *
 * @param notify - Callback that performs the actual notification.
 */
function notifyDerivedSubscribers(notify: () => void) {
  if (propagationDepth > 0) {
    deferredNotifications.add(notify);
  } else {
    notify();
  }
}

/* ── flow ── */

/**
 * Creates an atom backed by a stream.
 *
 * The atom's value is updated whenever the stream emits. The initial value is
 * used until the first emission. If the stream emits synchronously during
 * subscription, the value is replayed to scope subscribers.
 *
 * @param stream - The stream to subscribe to.
 * @param initialValue - The starting value before any stream emission.
 * @returns An atom that reflects the stream's latest value.
 *
 * @example
 * ```ts
 * const app = scope(() => {
 *   const count = flow(counterStream, 0);
 *   return { count };
 * });
 * ```
 */
export function flow<T>(
  source: AsyncIterable<T> | Iterable<T> | ((signal?: AbortSignal) => AsyncIterable<T> | Iterable<T>),
  initialValue?: T,
  options?: AtomOptions
): AtomBase<T> & { _error?: any } {
  void options;

  let current = initialValue as T;
  let previous = initialValue as T;
  let disposed = false;
  let started = false;
  let activeSubCount = 0;
  let error: any = undefined;
  const disposeHandlers = new Set<() => void>();

  const subs = new Set<Receiver<T>>();
  const subscriptions = new Set<Subscription>();

  const notify = (value: T) => {
    if (disposed) return;

    previous = current;
    current = value;

    runWithPropagation(() => {
      for (const receiver of Array.from(subs)) {
        try {
          receiver.next?.(value);
        } catch (err) {
          receiver.error?.(err);
        }
      }
    });
  };

  let iterator: AsyncIterator<T> | Iterator<T> | undefined;
  let cancelled = false;
  let cleanup: () => void | Promise<void> = () => {};
  let disposePromise: Promise<void> | null = null;
  let abortController: AbortController | undefined;
  let pending: Promise<IteratorResult<T>> | IteratorResult<T> | undefined;

  const stop = () => {
    cancelled = true;
    return cleanup();
  };

  const disposeInstance = async (): Promise<void> => {
    if (disposed) return;
    if (disposePromise) return disposePromise;

    disposePromise = (async () => {
      disposed = true;
      const currentSubs = Array.from(subs);
      subs.clear();
      activeSubCount = 0;

      for (const receiver of currentSubs) {
        try {
          if (error !== undefined) {
            receiver.error?.(error);
          } else {
            receiver.complete?.();
          }
        } catch {
          // ignore terminal callback errors
        }
      }

      try {
        await stop();
      } catch {
        // ignore cleanup errors
      }
      for (const handler of Array.from(disposeHandlers)) {
        try {
          handler();
        } catch {
          // ignore
        }
      }
      disposeHandlers.clear();
      for (const sub of Array.from(subscriptions)) {
        try {
          await sub.unsubscribe();
        } catch {
          // ignore
        }
      }
      subscriptions.clear();
    })();

    return disposePromise;
  };

  const start = () => {
    if (started || disposed) return;
    started = true;

    abortController = new AbortController();
    const iterable =
      typeof source === "function"
        ? (source as (signal?: AbortSignal) => AsyncIterable<T> | Iterable<T>)(abortController.signal)
        : source;
    iterator =
      (iterable as any)[Symbol.asyncIterator]?.() ??
      (iterable as any)[Symbol.iterator]?.();

    if (!iterator) {
      abortController.abort();
      void disposeInstance();
      return;
    }

    cleanup = () => {
      if (!iterator) return;
      cancelled = true;
      abortController?.abort();
      if (typeof (iterator as any).return === "function") {
        try {
          return (iterator as any).return();
        } catch {
          // ignore
        }
      }
    };

    // Prime the iterator synchronously so generators can attach listeners or
    // perform other setup before the consumer starts pulling values. The result
    // is processed asynchronously so subscribers are added before any values
    // are emitted.
    pending = iterator.next();

    (async () => {
      try {
        while (!cancelled) {
          const result = await pending;
          pending = iterator!.next();
          if (cancelled || result.done) break;
          notify(result.value);
        }
      } catch (err) {
        error = err;
        await disposeInstance();
      } finally {
        // Mark as disposed before awaiting cleanup so consumers see completion
        // synchronously and any pending iterators can resolve to done.
        await disposeInstance();
      }
    })();
  };

  const instance: AtomBase<T> & { _error?: any } = {
    type: "atom",

    get disposed() {
      return disposed;
    },

    get value() {
      if (disposed) throw new Error("Atom has been disposed");
      if (activeFormula) {
        activeFormula.dependencies.add(instance);
      }
      return current;
    },

    get safeValue() {
      return current;
    },

    get prior() {
      return previous;
    },

    subscribe(callback) {
      if (disposed) {
        return createSubscription(() => {});
      }

      if (!started) {
        start();
      }

      const receiver = toReceiver(callback);
      subs.add(receiver);
      activeSubCount++;

      const sub = createSubscription(() => {
        subs.delete(receiver);
        activeSubCount--;
        if (activeSubCount <= 0) {
          return disposeInstance();
        }
        return undefined;
      });
      subscriptions.add(sub);
      return sub;
    },

    pipe(...ops: Operator<any, any>[]) {
      return pipeSource(this, ...ops);
    },

    [Symbol.asyncIterator]() {
      return iterate(this)[Symbol.asyncIterator]();
    },

    dispose() {
      void disposeInstance();
    }
  };

  Object.defineProperty(instance, "_error", {
    get() {
      return error;
    },
    enumerable: false,
  });

  Object.defineProperty(instance, "_onDispose", {
    get() {
      return disposeHandlers;
    },
    enumerable: false,
  });

  registerWithCurrentScope(instance);

  return instance;
}

/* ── atom ── */

/**
 * Creates a writable atom with an initial value.
 *
 * Writable atoms can be updated via {@link Atom.next} and automatically notify
 * subscribers on change. They participate in scope tracking and dependency
 * discovery for derived atoms.
 *
 * @param initialValue - The starting value.
 * @returns A writable atom.
 *
 * @example
 * ```ts
 * const app = scope(() => {
 *   const count = atom(0);
 *   count.next(5);
 *   console.log(count.value); // 5
 *   return { count };
 * });
 * ```
 */
/**
 * Creates a read-only view of a writable atom from an initial value.
 *
 * This is useful when you want to expose an atom without allowing consumers
 * to mutate it directly. The underlying atom is still writable, but the
 * returned type only exposes the {@link AtomBase} interface.
 *
 * @param initialValue - The starting value.
 * @param options - Optional atom configuration.
 * @returns A read-only atom view.
 */
export function atom<T>(initialValue?: T, options?: AtomOptions): Atom<T> {
  const scope = getCurrentScope();
  const strobe = scope ? getScopeStrobe(scope) : undefined;
  const analog = strobe !== undefined && strobe > 0 && !options?.discrete;

  let current = initialValue as T;
  let previous = initialValue as T;
  let disposed = false;
  let dirty = false;
  let lastNotified = current;
  let error: any = undefined;
  const disposeHandlers = new Set<() => void>();

  const subs = new Set<Receiver<T>>();

  const notify = (value: T) => {
    runWithPropagation(() => {
      for (const receiver of Array.from(subs)) {
        try {
          receiver.next?.(value);
        } catch (err) {
          receiver.error?.(err);
        }
      }
    });
  };

  const flush = () => {
    if (!dirty || disposed) return;
    dirty = false;
    if (Object.is(lastNotified, current)) return;
    lastNotified = current;
    notify(current);
  };

  const instance: Atom<T> = {
    type: "atom",

    get disposed() {
      return disposed;
    },

    get value() {
      if (disposed) throw new Error("Atom has been disposed");
      if (activeFormula) {
        activeFormula.dependencies.add(instance);
      }
      return current;
    },

    get safeValue() {
      return current;
    },

    get prior() {
      return previous;
    },

    subscribe(callback) {
      const receiver = toReceiver(callback);
      subs.add(receiver);

      return createSubscription(() => {
        subs.delete(receiver);
      });
    },

    pipe(...ops: Operator<any, any>[]) {
      return pipeSource(this, ...ops);
    },

    [Symbol.asyncIterator]() {
      return iterate(this)[Symbol.asyncIterator]();
    },

    set(value) {
      if (disposed) return;
      if (Object.is(current, value)) return;

      previous = current;
      current = value;

      if (analog) {
        dirty = true;
      } else {
        lastNotified = current;
        notify(value);
      }
    },

    next(value: T) {
      if (disposed) return;

      previous = current;
      current = value;

      if (analog) {
        dirty = true;
      } else {
        lastNotified = current;
        notify(value);
      }
    },

    error(err: any) {
      if (disposed) return;

      error = err;
      disposed = true;
      unregisterAnalogAtom(instance);
      for (const handler of Array.from(disposeHandlers)) {
        try {
          handler();
        } catch {
          // ignore
        }
      }
      disposeHandlers.clear();
      subs.clear();
    },

    dispose() {
      if (disposed) return;

      disposed = true;
      unregisterAnalogAtom(instance);
      for (const handler of Array.from(disposeHandlers)) {
        try {
          handler();
        } catch {
          // ignore
        }
      }
      disposeHandlers.clear();
      subs.clear();
    }
  };

  Object.defineProperty(instance, "_error", {
    get() {
      return error;
    },
    enumerable: false,
  });

  Object.defineProperty(instance, "_onDispose", {
    get() {
      return disposeHandlers;
    },
    enumerable: false,
  });

  registerWithCurrentScope(instance);
  markAtomAsEmitted(instance);
  if (analog) {
    registerAnalogAtom(instance, flush);
  }

  // Notify scope subscribers immediately so writable atoms are
  // considered "ready" — their value is already available.
  for (const receiver of Array.from(subs)) {
    receiver.next?.(current);
  }

  return instance;
}

/**
 * Creates a read-only view of a writable atom from an initial value.
 *
 * This is useful when you want to expose an atom without allowing consumers
 * to mutate it directly. The underlying atom is still writable, but the
 * returned type only exposes the {@link AtomBase} interface.
 *
 * @param initialValue - The starting value.
 * @param options - Optional atom configuration.
 * @returns A read-only atom view.
 */
export function atomOf<T>(initialValue: T, options?: AtomOptions): AtomBase<T> {
  return atom(initialValue, options);
}

/**
 * Alias for {@link atom}.
 *
 * Use `discrete` when you want to emphasize that the value is updated by
 * explicit, discrete events rather than a continuous/analog stream.
 *
 * @param initialValue - The starting value.
 * @param options - Optional atom configuration.
 * @returns A writable discrete atom.
 *
 * @example
 * ```ts
 * const count = discrete(0);
 * count.next(5);
 * ```
 */
export function discrete<T>(initialValue: T, options?: AtomOptions): Atom<T> {
  return atom(initialValue, options);
}

/* ── asyncAtom ── */

/**
 * Options for creating an async atom.
 */
export interface AsyncAtomOptions {
  /**
   * Maximum number of values to replay to late subscribers.
   * Defaults to `0` (no replay). Use `Infinity` for unlimited replay.
   */
  capacity?: number;
}

/**
 * Async atom that buffers emissions and optionally replays them to late subscribers.
 * Unlike {@link atom}, async atoms do not require an initial value.
 *
 * @template T The type of the value held by this atom.
 */

/**
 * Creates an async atom with optional replay capacity.
 *
 * Async atoms are hot atoms that do not require an initial value.
 * Values are pushed via {@link Atom.next}. Late subscribers can
 * receive buffered values based on the configured capacity.
 *
 * @param options - Configuration options.
 * @returns An async atom.
 *
 * @example
 * ```ts
 * const app = scope(() => {
 *   const count = asyncAtom<number>();
 *   count.next(5);
 *   console.log(count.value); // 5
 *   return { count };
 * });
 * ```
 */
export function asyncAtom<T>(): Atom<T>;
export function asyncAtom<T>(options: AsyncAtomOptions & AtomOptions): Atom<T>;
export function asyncAtom<T>(options?: AsyncAtomOptions & AtomOptions): Atom<T> {
  const scope = getCurrentScope();
  const strobe = scope ? getScopeStrobe(scope) : undefined;
  const analog = strobe !== undefined && strobe > 0 && !options?.discrete;

  const capacity = options?.capacity ?? 0;
  const isFiniteCapacity = capacity !== Infinity && capacity > 0;
  const replay: T[] = [];
  let replayHead = 0;

  let current: T = undefined as any;
  let previous: T = undefined as any;
  let hasValue = false;
  let disposed = false;
  let dirty = false;
  let lastNotified: T = undefined as any;
  let error: any = undefined;
  const disposeHandlers = new Set<() => void>();

  const subs = new Set<(value: T) => void>();

  const notify = (value: T) => {
    runWithPropagation(() => {
      for (const cb of Array.from(subs)) {
        cb(value);
      }
    });
  };

  const flush = () => {
    if (!dirty || disposed) return;
    dirty = false;
    if (hasValue && Object.is(lastNotified, current)) return;
    lastNotified = current;
    notify(current);
  };

  const pushReplay = (value: T) => {
    if (capacity <= 0) return;
    if (!isFiniteCapacity) {
      replay.push(value);
      return;
    }
    if (replay.length < capacity) {
      replay.push(value);
    } else {
      replay[replayHead] = value;
      replayHead = (replayHead + 1) % capacity;
    }
  };

  const forEachReplay = (fn: (value: T) => void) => {
    if (capacity <= 0) return;
    if (!isFiniteCapacity) {
      for (const value of replay) fn(value);
      return;
    }
    const size = replay.length;
    const start = size < capacity ? 0 : replayHead;
    for (let i = 0; i < size; i++) {
      fn(replay[(start + i) % capacity]);
    }
  };

  const instance: Atom<T> = {
    type: "atom",

    get disposed() {
      return disposed;
    },

    get value() {
      if (disposed) throw new Error("Atom has been disposed");
      if (activeFormula) {
        activeFormula.dependencies.add(instance);
      }
      return current;
    },

    get safeValue() {
      return current;
    },

    get prior() {
      return previous;
    },

    subscribe(callback) {
      subs.add(callback);

      // Replay buffered values to late subscribers
      forEachReplay((value) => callback(value));

      return createSubscription(() => {
        subs.delete(callback);
      });
    },

    pipe(...ops: Operator<any, any>[]) {
      return pipeSource(this, ...ops);
    },

    [Symbol.asyncIterator]() {
      return iterate(this)[Symbol.asyncIterator]();
    },

    next(value: T) {
      if (disposed) return;

      previous = current;
      current = value;
      const wasFirstValue = !hasValue;
      hasValue = true;
      pushReplay(value);

      if (wasFirstValue) {
        markAtomAsEmitted(instance);
      }

      if (analog) {
        dirty = true;
      } else {
        lastNotified = current;
        notify(value);
      }
    },

    error(err: any) {
      if (disposed) return;

      error = err;
      disposed = true;
      unregisterAnalogAtom(instance);
      for (const handler of Array.from(disposeHandlers)) {
        try {
          handler();
        } catch {
          // ignore
        }
      }
      disposeHandlers.clear();
      subs.clear();
      replay.length = 0;
      replayHead = 0;
    },

    dispose() {
      if (disposed) return;

      disposed = true;
      unregisterAnalogAtom(instance);
      for (const handler of Array.from(disposeHandlers)) {
        try {
          handler();
        } catch {
          // ignore
        }
      }
      disposeHandlers.clear();
      subs.clear();
      // Keep the replay buffer so late subscribers/iterators can still receive
      // the completed response.
    }
  };

  Object.defineProperty(instance, "_error", {
    get() {
      return error;
    },
    enumerable: false,
  });

  Object.defineProperty(instance, "_onDispose", {
    get() {
      return disposeHandlers;
    },
    enumerable: false,
  });

  registerWithCurrentScope(instance);
  if (analog) {
    registerAnalogAtom(instance, flush);
  }

  return instance;
}

/* ── derived ── */

/**
 * Creates a derived atom with automatic dependency tracking.
 *
 * The factory is re-evaluated synchronously whenever any atom read inside it
 * changes. Dependencies are discovered automatically — no manual array is
 * required. The result is itself an atom — it can be subscribed to,
 * snapshotted, and disposed like any other.
 *
 * @param fn - Pure function that reads atom values and returns the derived value.
 * @returns A derived atom.
 *
 * @example
 * ```ts
 * const app = scope(() => {
 *   const first = atom('Ada');
 *   const last = atom('Lovelace');
 *   const full = derived(() => `${first.value} ${last.value}`);
 *   return { first, last, full };
 * });
 *
 * app.first.next('Grace');
 * console.log(app.full.value); // 'Grace Lovelace'
 * ```
 */
export function derived<T>(fn: () => T, options?: AtomOptions): AtomBase<T> {
  const scope = getCurrentScope();
  const strobe = scope ? getScopeStrobe(scope) : undefined;
  const analog = strobe !== undefined && strobe > 0 && !options?.discrete;

  let current: T;
  let previous: T;
  let disposed = false;
  let running = false;
  let dirty = false;
  const subs = new Set<(value: T) => void>();
  const dependencies = new Set<AtomBase<any>>();
  const depSubscriptions = new Map<AtomBase<any>, Subscription>();

  const notify = () => {
    for (const cb of Array.from(subs)) cb(current);
  };

  const run = (): T => {
    if (running) {
      throw new Error("Circular dependency detected in derived()");
    }

    const oldDeps = new Set(depSubscriptions.keys());
    dependencies.clear();

    running = true;
    const prev = activeFormula;
    activeFormula = context;
    let result: T;
    try {
      result = fn();
    } finally {
      activeFormula = prev;
      running = false;
    }

    // Unsubscribe from removed deps
    for (const dep of oldDeps) {
      if (!dependencies.has(dep)) {
        depSubscriptions.get(dep)?.unsubscribe();
        depSubscriptions.delete(dep);
      }
    }

    // Subscribe to new deps
    for (const dep of dependencies) {
      if (!depSubscriptions.has(dep)) {
        depSubscriptions.set(
          dep,
          dep.subscribe(() => {
            if (disposed) return;
            const next = run();
            if (Object.is(current, next)) return;
            previous = current;
            current = next;
            if (analog) {
              dirty = true;
            } else {
              notifyDerivedSubscribers(notify);
            }
          })
        );
      }
    }

    return result;
  };

  const flush = () => {
    if (!dirty || disposed) return;
    dirty = false;
    notifyDerivedSubscribers(notify);
  };

  const context = {
    dependencies,
    run,
  };

  current = run();
  previous = current;

  const instance: AtomBase<T> = {
    type: "atom",

    get disposed() {
      return disposed;
    },

    get value() {
      if (disposed) throw new Error("Atom has been disposed");
      if (activeFormula) {
        activeFormula.dependencies.add(instance);
      }
      return current;
    },

    get safeValue() {
      return current;
    },

    get prior() {
      return previous;
    },

    subscribe(callback) {
      subs.add(callback);
      return createSubscription(() => {
        subs.delete(callback);
      });
    },

    pipe(...ops: Operator<any, any>[]) {
      return pipeSource(this, ...ops);
    },

    [Symbol.asyncIterator]() {
      return iterate(this)[Symbol.asyncIterator]();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      unregisterAnalogAtom(instance);
      for (const sub of depSubscriptions.values()) {
        sub.unsubscribe();
      }
      depSubscriptions.clear();
      subs.clear();
    }
  };

  registerWithCurrentScope(instance);
  markAtomAsEmitted(instance);
  if (analog) {
    registerAnalogAtom(instance, flush);
  }

  // Notify scope subscribers immediately so derived atoms are
  // considered "ready" — their value is already available.
  for (const cb of Array.from(subs)) {
    cb(current);
  }

  return instance;
}

/* ── iterate ── */

/**
 * Creates an async iterable from an atom.
 *
 * Yields the current value immediately, then yields subsequent values
 * whenever the atom emits. The iterable completes when the atom is disposed.
 *
 * @param atom - The atom to iterate over.
 * @returns An async iterable that yields atom values.
 *
 * @example
 * ```ts
 * const a = atom(0);
 * setTimeout(() => a.next(1), 10);
 * setTimeout(() => a.next(2), 20);
 * setTimeout(() => a.dispose(), 30);
 *
 * for await (const value of iterate(a)) {
 *   console.log(value); // 0, 1, 2
 * }
 * ```
 */
export function iterate<T>(atom: AtomBase<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const buffer: T[] = [];
      let resolveNext: ((res: IteratorResult<T>) => void) | null = null;
      let rejectNext: ((e: any) => void) | null = null;
      let done = false;
      let onPush: (() => void) | undefined;

      const notifyPush = () => {
        if (onPush) {
          try {
            onPush();
          } catch {
            // ignore consumer errors
          }
        }
      };

      const sub = atom.subscribe((value) => {
        if (done) return;
        if (resolveNext) {
          resolveNext({ value, done: false });
          resolveNext = null;
          rejectNext = null;
        } else {
          buffer.push(value);
        }
        notifyPush();
      });

      const finish = () => {
        if (done) return;
        const cleanup = sub.unsubscribe();
        const err = (atom as any)._error;
        if (resolveNext) {
          if (err) {
            done = true;
            const r = rejectNext!;
            resolveNext = null;
            rejectNext = null;
            r(err);
          } else if (buffer.length === 0) {
            done = true;
            resolveNext({ value: undefined as any, done: true });
            resolveNext = null;
            rejectNext = null;
          }
        }
        notifyPush();
        return cleanup;
      };

      (atom as any)._onDispose?.add(finish);

      const checkError = () => {
        const err = (atom as any)._error;
        if (err !== undefined) {
          return err;
        }
        return undefined;
      };

      const iterator = {
        async next() {
          if (done) return { value: undefined as any, done: true };

          const err = checkError();
          if (err) {
            finish();
            throw err;
          }

          if (buffer.length > 0) {
            const val = buffer.shift()!;
            if (atom.disposed && buffer.length === 0) {
              done = true;
            }
            return { value: val, done: false };
          }

          if (atom.disposed) {
            done = true;
            return { value: undefined as any, done: true };
          }

          return new Promise<IteratorResult<T>>((resolve, reject) => {
            resolveNext = resolve;
            rejectNext = reject;
          });
        },
        async return() {
          await finish();
          return { value: undefined as any, done: true };
        },
      };

      (iterator as any).__tryNext = (): IteratorResult<T> | null => {
        if (done) return { value: undefined as any, done: true };
        const err = checkError();
        if (err) {
          throw err;
        }
        if (buffer.length > 0) {
          const val = buffer.shift()!;
          if (atom.disposed && buffer.length === 0) {
            done = true;
          }
          return { value: val, done: false };
        }
        if (atom.disposed) {
          done = true;
          return { value: undefined as any, done: true };
        }
        return null;
      };

      (iterator as any).__hasBufferedValues = () => buffer.length > 0;

      Object.defineProperty(iterator, "__onPush", {
        get() {
          return onPush;
        },
        set(cb: () => void) {
          onPush = cb;
        },
        configurable: true,
      });

      return iterator;
    },
  };
}