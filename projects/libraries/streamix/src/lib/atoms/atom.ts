import { iterate } from "./iterate";
import { type MaybePromise, type Operator } from "./operator";
import { pipe as pipeSource } from "./pipe";
import {
  getCurrentScope,
  getScopeStrobe,
  markAtomAsEmitted,
  registerAnalogAtom,
  registerWithCurrentScope,
  unregisterAnalogAtom,
} from "./scope";
import { createSubscription, type Subscription } from "./subscription";

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

  /** Optional human-readable name (used by factory-created atoms). */
  name?: string;

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
  subscribe(callback?: (value: T) => MaybePromise): Subscription;

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
 * Writable atom that extends {@link AtomBase} with a {@link next} method.
 *
 * @template T The type of the value held by this atom.
 */
export interface Atom<T = any> extends AtomBase<T> {
  /**
   * Updates the atom's value and notifies subscribers.
   *
   * If the new value is the same as the current value.
   * @param value - The new value to set.
   */
  next(value: T): void;

  /**
   * Signals that the atom has failed with the given error. The error is
   * propagated to consumers iterating the atom, and the atom is disposed.
   *
   * @param err - The error to emit.
   */
  error(err: any): void;
}

let activeFormula: { dependencies: Set<AtomBase<any>> } | null = null;

/**
 * Subscribes to an atom and invokes the handler only for future emissions,
 * ignoring any value that is delivered synchronously during subscription.
 */
function subscribeToUpdates(atom: AtomBase<any>, handler: () => void): Subscription {
  let active = false;
  const sub = atom.subscribe(() => {
    if (!active) return;
    handler();
  });
  active = true;
  return sub;
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

  const subs = new Set<(value: T) => MaybePromise>();
  const subscriptions = new Set<Subscription>();

  const notify = (value: T) => {
    if (disposed || Object.is(current, value)) return;

    previous = current;
    current = value;

    runWithPropagation(() => {
      for (const cb of Array.from(subs)) {
        try {
          cb(value);
        } catch (err) {
          // ignore user callback errors in callback-only API
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
      subs.clear();
      activeSubCount = 0;

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

      if (callback) {
        subs.add(callback);
      }
      activeSubCount++;

      const sub = createSubscription(() => {
        if (callback) {
          subs.delete(callback);
        }
        subscriptions.delete(sub); // Clear tracking link to prevent leak
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
 * Creates a writable atom.
 *
 * When an initial value is provided, the atom behaves like a behavior-aware
 * primitive and is considered emitted immediately. When omitted, the atom
 * starts empty like a Subject and emits only after the first {@link Atom.next}.
 *
 * Writable atoms can be updated via {@link Atom.next} and automatically notify
 * subscribers on change. They participate in scope tracking and dependency
 * discovery for derived atoms.
 *
 * @param initialValue - The starting value (optional).
 * @param options - Optional atom configuration.
 * @returns A writable atom.
 */
export function atom<T = any>(initialValue?: T, options?: AtomOptions): Atom<T> {
  const scope = getCurrentScope();
  const strobe = scope ? getScopeStrobe(scope) : undefined;
  const analog = strobe !== undefined && strobe > 0 && !options?.discrete;

  const hasInitialValue = arguments.length > 0;
  let current = initialValue as T;
  let previous = initialValue as T;
  let disposed = false;
  let dirty = false;
  let lastNotified = current;
  let error: any = undefined;
  const disposeHandlers = new Set<() => void>();

  const subs = new Set<(value: T) => MaybePromise>();
  const subscriptions = new Set<Subscription>();

  const notify = (value: T) => {
    runWithPropagation(() => {
      for (const cb of Array.from(subs)) {
        try {
          cb(value);
        } catch (err) {
          // ignore user callback errors in callback-only API
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
      if (disposed) {
        return createSubscription(() => {});
      }

      if (callback) {
        subs.add(callback);
      }

      const sub = createSubscription(() => {
        if (callback) {
          subs.delete(callback);
        }
        subscriptions.delete(sub); // Remove reference to prevent growth over time
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

    next(value: T) {
      if (disposed || Object.is(current, value)) return; // Deduplicate equivalent states

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
      for (const sub of Array.from(subscriptions)) {
        try {
          sub.unsubscribe();
        } catch {
          // ignore
        }
      }
      subscriptions.clear();
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
      for (const sub of Array.from(subscriptions)) {
        try {
          sub.unsubscribe();
        } catch {
          // ignore
        }
      }
      subscriptions.clear();
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
  if (hasInitialValue) {
    markAtomAsEmitted(instance);
  }
  if (analog) {
    registerAnalogAtom(instance, flush);
  }

  return instance;
}

export function atomOf<T>(initialValue: T, options?: AtomOptions): AtomBase<T> {
  return atom(initialValue, options);
}

export function discrete<T>(initialValue?: T, options?: AtomOptions): Atom<T> {
  return atom(initialValue, options);
}

/* ── derived ── */

/**
 * Creates a derived atom with automatic dependency tracking.
 *
 * The factory is re-evaluated synchronously whenever any atom read inside it
 * changes. Dependencies are discovered automatically — no manual array is
 * required.
 *
 * @param fn - Pure function that reads atom values and returns the derived value.
 * @returns A derived atom.
 */
export function derived<T>(fn: () => T, options?: AtomOptions): AtomBase<T> {
  const scope = getCurrentScope();
  const strobe = scope ? getScopeStrobe(scope) : undefined;
  const analog = strobe !== undefined && strobe > 0 && !options?.discrete;

  let current: T;
  let previous: T;
  let disposed = false;
  let initialized = false;
  let running = false;
  let dirty = false;
  const subs = new Set<(value: T) => void>();
  const dependencies = new Set<AtomBase<any>>();
  const depSubscriptions = new Map<AtomBase<any>, Subscription>();

  const notify = () => {
    for (const cb of Array.from(subs)) cb(current);
  };

  const ensureInit = () => {
    if (initialized || disposed) return;
    initialized = true;
    current = run();
    previous = current;
    if (analog) {
      dirty = true;
    } else {
      notifyDerivedSubscribers(notify);
    }
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

    // Subscribe to new deps, ignoring the synchronous replay
    for (const dep of dependencies) {
      if (!depSubscriptions.has(dep)) {
        depSubscriptions.set(
          dep,
          subscribeToUpdates(dep, () => {
            if (disposed) return;
            const next = run();
            
            if (Object.is(current, next)) return; // Block calculation propagation down if output matches

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
      ensureInit();
      return current;
    },

    get safeValue() {
      ensureInit();
      return current;
    },

    get prior() {
      ensureInit();
      return previous;
    },

    subscribe(callback) {
      ensureInit();
      if (callback) {
        subs.add(callback);
      }

      return createSubscription(() => {
        if (callback) {
          subs.delete(callback);
        }
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
      ensureInit();
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
  if (analog) {
    registerAnalogAtom(instance, flush);
  }

  return instance;
}