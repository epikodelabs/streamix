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

export function flow<T>(stream: Stream<T>, initialValue: T): Atom<T> {
  let current = initialValue;
  let previous = initialValue;
  let disposed = false;

  const subs = new Set<(value: T) => void>();

  const streamSub = stream.subscribe((value: T) => {
    if (disposed) return;
    if (Object.is(current, value)) return;

    previous = current;
    current = value;

    for (const cb of Array.from(subs)) {
      cb(value);
    }
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

  return instance;
}

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

      for (const cb of Array.from(subs)) {
        cb(value);
      }
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
  const subs = new Set<(value: T) => void>();
  const dependencies = new Set<Atom<any>>();
  let unsubscribers: Subscription[] = [];

  const run = (): T => {
    unsubscribers.forEach((u) => u.unsubscribe());
    unsubscribers = [];
    dependencies.clear();

    const prev = activeFormula;
    activeFormula = context;
    const result = fn();
    activeFormula = prev;

    for (const dep of dependencies) {
      unsubscribers.push(
        dep.subscribe(() => {
          if (disposed) return;
          const next = run();
          if (Object.is(current, next)) return;
          previous = current;
          current = next;
          for (const cb of Array.from(subs)) cb(next);
        })
      );
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
      unsubscribers.forEach((u) => u.unsubscribe());
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
