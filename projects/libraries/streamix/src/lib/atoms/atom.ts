import type { Stream } from "../abstractions/stream";
import { createSubscription, type Subscription } from "../abstractions/subscription";
import { registerWithCurrentScope } from "./scope";

export interface Atom<T = any> {
  type: "atom";

  get(): T;
  readonly value: T;
  readonly prior: T;

  readonly disposed: boolean;

  subscribe(callback: (value: T) => void): Subscription;

  dispose(): void;
}

export interface WritableAtom<T = any> extends Atom<T> {
  set(value: T): void;
}

let activeFormula: { dependencies: Set<Atom<any>> } | null = null;

/* ── Glitch-free propagation ── */

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

export function flow<T>(stream: Stream<T>, initialValue: T): Atom<T> {
  let current = initialValue;
  let previous = initialValue;
  let disposed = false;
  let hasEmitted = false;

  const subs = new Set<(value: T) => void>();

  const streamSub = stream.subscribe((value: T) => {
    if (disposed) return;
    if (Object.is(current, value)) return;

    hasEmitted = true;
    previous = current;
    current = value;

    runWithPropagation(() => {
      for (const cb of Array.from(subs)) {
        cb(value);
      }
    });
  });

  const instance: Atom<T> = {
    type: "atom",

    get disposed() {
      return disposed;
    },

    get() {
      if (disposed) throw new Error("Atom has been disposed");
      if (activeFormula) {
        activeFormula.dependencies.add(instance);
      }
      return current;
    },

    get value() {
      if (activeFormula) {
        activeFormula.dependencies.add(instance);
      }
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

    dispose() {
      if (disposed) return;

      disposed = true;
      subs.clear();
      streamSub.unsubscribe();
    }
  };

  registerWithCurrentScope(instance);

  // If the stream emitted synchronously during subscription, the scope's
  // loading callback missed it because it hadn't subscribed yet. Replay it.
  if (hasEmitted) {
    for (const cb of Array.from(subs)) {
      cb(current);
    }
  }

  return instance;
}

/* ── atom ── */

export function atom<T>(initialValue: T): WritableAtom<T> {
  let current = initialValue;
  let previous = initialValue;
  let disposed = false;

  const subs = new Set<(value: T) => void>();

  const instance: WritableAtom<T> = {
    type: "atom",

    get disposed() {
      return disposed;
    },

    get() {
      if (disposed) throw new Error("Atom has been disposed");
      if (activeFormula) {
        activeFormula.dependencies.add(instance);
      }
      return current;
    },

    get value() {
      if (activeFormula) {
        activeFormula.dependencies.add(instance);
      }
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

    set(value) {
      if (disposed) return;
      if (Object.is(current, value)) return;

      previous = current;
      current = value;

      runWithPropagation(() => {
        for (const cb of Array.from(subs)) {
          cb(value);
        }
      });
    },

    dispose() {
      if (disposed) return;

      disposed = true;
      subs.clear();
    }
  };

  registerWithCurrentScope(instance);

  // Notify scope subscribers immediately so writable atoms are
  // considered "ready" — their value is already available.
  for (const cb of Array.from(subs)) {
    cb(current);
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
 * app.first.set('Grace');
 * console.log(app.full.value); // 'Grace Lovelace'
 * ```
 */
export function derived<T>(fn: () => T): Atom<T> {
  let current: T;
  let previous: T;
  let disposed = false;
  let running = false;
  const subs = new Set<(value: T) => void>();
  const dependencies = new Set<Atom<any>>();
  const depSubscriptions = new Map<Atom<any>, Subscription>();

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
            notifyDerivedSubscribers(notify);
          })
        );
      }
    }

    return result;
  };

  const context = {
    dependencies,
    run,
  };

  current = run();
  previous = current;

  const instance: Atom<T> = {
    type: "atom",

    get disposed() {
      return disposed;
    },

    get() {
      if (disposed) throw new Error("Atom has been disposed");
      if (activeFormula) {
        activeFormula.dependencies.add(instance);
      }
      return current;
    },

    get value() {
      if (activeFormula) {
        activeFormula.dependencies.add(instance);
      }
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

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const sub of depSubscriptions.values()) {
        sub.unsubscribe();
      }
      depSubscriptions.clear();
      subs.clear();
    }
  };

  registerWithCurrentScope(instance);

  // Notify scope subscribers immediately so derived atoms are
  // considered "ready" — their value is already available.
  for (const cb of Array.from(subs)) {
    cb(current);
  }

  return instance;
}
