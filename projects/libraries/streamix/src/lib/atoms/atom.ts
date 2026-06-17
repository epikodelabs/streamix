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
 */
export interface AtomBase<T = any> {
  type: "atom";
  name?: string;
  readonly value: T;
  readonly safeValue: T;
  readonly prior: T;
  readonly disposed: boolean;
  subscribe(callback?: (value: T) => MaybePromise): Subscription;
  dispose(): void;
  pipe<R = any>(...ops: Operator<any, any>[]): AtomBase<R>;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

/**
 * Writable atom.
 */
export interface Atom<T = any> extends AtomBase<T> {
  next(value: T): void;
  error(err: any): void;
}

let activeFormula: { dependencies: Set<AtomBase<any>> } | null = null;

function subscribeToUpdates(atom: AtomBase<any>, handler: () => void): Subscription {
  let active = false;
  const sub = atom.subscribe(() => {
    if (!active) return;
    handler();
  });
  active = true;
  return sub;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Glitch-free propagation
 *
 * Two-phase commit:
 *
 *   Phase 1 – "mark"   Every atom whose upstream changed marks itself dirty
 *                       and records the new value, but does NOT notify its own
 *                       subscribers yet.  This is the depth-first traversal.
 *
 *   Phase 2 – "sweep"  After the outermost transaction() returns (depth → 0)
 *                       we walk the dirty set in registration order and notify
 *                       each atom's subscribers exactly once, with its final
 *                       settled value.
 *
 * `transaction()` is the public entry-point.  All internal mutations that
 * should compose glitch-freely must be wrapped inside it.  Nested calls are
 * free – only the outermost flush triggers the sweep.
 * ───────────────────────────────────────────────────────────────────────────*/

/** Depth counter for nested transactions. */
let txDepth = 0;

/**
 * Ordered set of flush callbacks queued during an active transaction.
 * Using a Map keyed by identity so the same atom never queues twice.
 */
const pendingFlush = new Map<object, () => void>();

/**
 * Run `fn` inside a transaction.  All atom notifications are deferred until
 * the outermost transaction completes, guaranteeing that every derived atom
 * sees only fully-settled upstream values (no glitches).
 *
 * Transactions compose: calling `transaction()` inside an already-active
 * transaction is a no-op at the boundary level – the flush happens once at
 * the outermost exit.
 *
 * @example
 * ```ts
 * transaction(() => {
 *   x.next(1);
 *   y.next(2);
 * });
 * // derived atoms that depend on both x and y are notified only once,
 * // after both writes have landed.
 * ```
 */
export function transaction(fn: () => void): void {
  txDepth++;
  try {
    fn();
  } finally {
    txDepth--;
    if (txDepth === 0) {
      flushTransaction();
    }
  }
}

/** Flush all pending notifications accumulated during the transaction. */
function flushTransaction(): void {
  // Snapshot and clear before iterating so re-entrant writes (from
  // subscribers that themselves call next()) get queued into a fresh batch.
  while (pendingFlush.size > 0) {
    const batch = Array.from(pendingFlush.values());
    pendingFlush.clear();
    for (const flush of batch) {
      flush();
    }
  }
}

/**
 * Schedule a notification callback for `owner`.
 *
 * - Inside a transaction (txDepth > 0) the callback is queued; the same owner
 *   replacing a previous entry is idempotent (last write wins, which is
 *   correct because by the time we flush, `current` already holds the final
 *   value).
 * - Outside a transaction the callback fires immediately (legacy behaviour for
 *   direct, single-atom writes that don't need batching).
 */
function scheduleNotify(owner: object, notify: () => void): void {
  if (txDepth > 0) {
    // Replace any previously queued flush for this atom – last write wins.
    pendingFlush.set(owner, notify);
  } else {
    notify();
  }
}

/* ── Legacy propagation helpers (kept for flow / derived internal use) ────── */

let propagationDepth = 0;
let deferredNotifications = new Set<() => void>();

function flushDeferred() {
  const notifications = Array.from(deferredNotifications);
  deferredNotifications = new Set();
  for (const notify of notifications) {
    notify();
  }
}

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

function notifyDerivedSubscribers(notify: () => void) {
  if (propagationDepth > 0) {
    deferredNotifications.add(notify);
  } else {
    notify();
  }
}

/* ── flow ── */

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
        } catch {
          // ignore user callback errors
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
        // ignore
      }
      for (const handler of Array.from(disposeHandlers)) {
        try { handler(); } catch { /* ignore */ }
      }
      disposeHandlers.clear();
      for (const sub of Array.from(subscriptions)) {
        try { await sub.unsubscribe(); } catch { /* ignore */ }
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
        try { return (iterator as any).return(); } catch { /* ignore */ }
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

    get disposed() { return disposed; },

    get value() {
      if (disposed) throw new Error("Atom has been disposed");
      if (activeFormula) activeFormula.dependencies.add(instance);
      return current;
    },

    get safeValue() { return current; },
    get prior() { return previous; },

    subscribe(callback) {
      if (disposed) return createSubscription(() => {});
      if (!started) start();

      if (callback) subs.add(callback);
      activeSubCount++;

      const sub = createSubscription(() => {
        if (callback) subs.delete(callback);
        subscriptions.delete(sub);
        activeSubCount--;
        if (activeSubCount <= 0) return disposeInstance();
        return undefined;
      });
      subscriptions.add(sub);
      return sub;
    },

    pipe(...ops: Operator<any, any>[]) { return pipeSource(this, ...ops); },
    [Symbol.asyncIterator]() { return iterate(this)[Symbol.asyncIterator](); },
    dispose() { void disposeInstance(); },
  };

  Object.defineProperty(instance, "_error", { get() { return error; }, enumerable: false });
  Object.defineProperty(instance, "_onDispose", { get() { return disposeHandlers; }, enumerable: false });

  registerWithCurrentScope(instance);
  return instance;
}

/* ── atom ── */

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

  /** Broadcast current value to all direct subscribers. */
  const broadcastNow = () => {
    const snap = current;
    for (const cb of Array.from(subs)) {
      try { cb(snap); } catch { /* ignore */ }
    }
  };

  /** Strobe flush – called by the scope on every tick for analog atoms. */
  const strobeFlush = () => {
    if (!dirty || disposed) return;
    dirty = false;
    if (Object.is(lastNotified, current)) return;
    lastNotified = current;
    broadcastNow();
  };

  const instance: Atom<T> = {
    type: "atom",

    get disposed() { return disposed; },

    get value() {
      if (disposed) throw new Error("Atom has been disposed");
      if (activeFormula) activeFormula.dependencies.add(instance);
      return current;
    },

    get safeValue() { return current; },
    get prior() { return previous; },

    subscribe(callback) {
      if (disposed) return createSubscription(() => {});
      if (callback) subs.add(callback);

      const sub = createSubscription(() => {
        if (callback) subs.delete(callback);
        subscriptions.delete(sub);
      });
      subscriptions.add(sub);
      return sub;
    },

    pipe(...ops: Operator<any, any>[]) { return pipeSource(this, ...ops); },
    [Symbol.asyncIterator]() { return iterate(this)[Symbol.asyncIterator](); },

    next(value: T) {
      if (disposed || Object.is(current, value)) return;

      previous = current;
      current = value;
      dirty = true;

      if (analog && txDepth === 0) {
        // Analog outside a transaction: leave dirty for the strobe, nothing more.
        return;
      }

      // Discrete, OR analog inside a transaction: queue a flush so this atom
      // lands in the same sweep as every other write in the batch.
      // The callback clears dirty, notifies, then re-marks dirty for the strobe
      // (analog only) so downstream analog consumers still get their tick.
      scheduleNotify(instance, () => {
        if (disposed) return;
        dirty = false;
        if (Object.is(lastNotified, current)) return;
        lastNotified = current;
        broadcastNow();
        // Re-arm the strobe for any analog downstream that wasn't in this tx.
        if (analog) dirty = true;
      });
    },

    error(err: any) {
      if (disposed) return;
      error = err;
      disposed = true;
      unregisterAnalogAtom(instance);
      for (const handler of Array.from(disposeHandlers)) {
        try { handler(); } catch { /* ignore */ }
      }
      disposeHandlers.clear();
      for (const sub of Array.from(subscriptions)) {
        try { sub.unsubscribe(); } catch { /* ignore */ }
      }
      subscriptions.clear();
      subs.clear();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      unregisterAnalogAtom(instance);
      for (const handler of Array.from(disposeHandlers)) {
        try { handler(); } catch { /* ignore */ }
      }
      disposeHandlers.clear();
      for (const sub of Array.from(subscriptions)) {
        try { sub.unsubscribe(); } catch { /* ignore */ }
      }
      subscriptions.clear();
      subs.clear();
    },
  };

  Object.defineProperty(instance, "_error", { get() { return error; }, enumerable: false });
  Object.defineProperty(instance, "_onDispose", { get() { return disposeHandlers; }, enumerable: false });

  registerWithCurrentScope(instance);
  if (hasInitialValue) markAtomAsEmitted(instance);
  if (analog) registerAnalogAtom(instance, strobeFlush);

  return instance;
}

export function discrete<T>(initialValue?: T, options?: AtomOptions): Atom<T> {
  return atom(initialValue, { ...options, discrete: true });
}

/* ── derived ── */

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

  const broadcastNow = () => {
    const snap = current;
    for (const cb of Array.from(subs)) cb(snap);
  };

  const scheduleNotifyDerived = () => {
    // Derived atoms always go through both layers:
    // 1. transaction() – batch multiple upstream writes
    // 2. propagation depth – prevent mid-propagation glitches within a single write
    scheduleNotify(instance, () => {
      notifyDerivedSubscribers(broadcastNow);
    });
  };

  const ensureInit = () => {
    if (initialized || disposed) return;
    initialized = true;
    current = run();
    previous = current;
    if (!analog) {
      scheduleNotifyDerived();
    } else {
      dirty = true;
    }
  };

  const run = (): T => {
    if (running) throw new Error("Circular dependency detected in derived()");

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

    // Unsubscribe removed deps
    for (const dep of oldDeps) {
      if (!dependencies.has(dep)) {
        depSubscriptions.get(dep)?.unsubscribe();
        depSubscriptions.delete(dep);
      }
    }

    // Subscribe new deps
    for (const dep of dependencies) {
      if (!depSubscriptions.has(dep)) {
        depSubscriptions.set(
          dep,
          subscribeToUpdates(dep, () => {
            if (disposed) return;
            const next = run();
            if (Object.is(current, next)) return;

            previous = current;
            current = next;

            if (analog && txDepth === 0) {
              // Analog outside a transaction: mark dirty, let the strobe flush.
              dirty = true;
            } else {
              // Discrete, OR analog inside a transaction: participate in the
              // current transaction sweep so all modes land together.
              scheduleNotify(instance, () => {
                notifyDerivedSubscribers(broadcastNow);
                // Re-arm for the strobe if analog.
                if (analog) dirty = true;
              });
            }
          })
        );
      }
    }

    return result;
  };

  const flushAnalog = () => {
    if (!dirty || disposed) return;
    dirty = false;
    notifyDerivedSubscribers(broadcastNow);
  };

  const context = { dependencies, run };

  const instance: AtomBase<T> = {
    type: "atom",

    get disposed() { return disposed; },

    get value() {
      if (disposed) throw new Error("Atom has been disposed");
      if (activeFormula) activeFormula.dependencies.add(instance);
      ensureInit();
      return current;
    },

    get safeValue() { ensureInit(); return current; },
    get prior() { ensureInit(); return previous; },

    subscribe(callback) {
      ensureInit();
      if (callback) subs.add(callback);
      return createSubscription(() => {
        if (callback) subs.delete(callback);
      });
    },

    pipe(...ops: Operator<any, any>[]) { return pipeSource(this, ...ops); },
    [Symbol.asyncIterator]() { return iterate(this)[Symbol.asyncIterator](); },

    dispose() {
      if (disposed) return;
      ensureInit();
      disposed = true;
      unregisterAnalogAtom(instance);
      for (const sub of depSubscriptions.values()) sub.unsubscribe();
      depSubscriptions.clear();
      subs.clear();
    },
  };

  registerWithCurrentScope(instance);
  if (analog) registerAnalogAtom(instance, flushAnalog);

  return instance;
}