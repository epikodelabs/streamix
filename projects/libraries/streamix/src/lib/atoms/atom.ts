import type { Stream } from "../abstractions/stream";
import { createSubscription, type Subscription } from "../abstractions/subscription";
import { createSubject } from "../subjects/subject";
import { registerWithCurrentScope } from "./scope";

export interface Atom<T = any> {
  type: "atom";

  get(): T;
  readonly value: T;
  readonly previousValue: T;

  readonly disposed: boolean;

  subscribe(callback: (value: T) => void): Subscription;

  dispose(): void;
}

export interface WritableAtom<T = any> extends Atom<T> {
  set(value: T): void;
}

export function atom<T>(stream: Stream<T>, initialValue: T): Atom<T> {
  let current = initialValue;
  let previous = initialValue;
  let disposed = false;

  const subs = new Set<(value: T) => void>();

  const streamSub = stream.subscribe((value: T) => {
    if (disposed) return;
    if (Object.is(current, value)) return;

    previous = current;
    current = value;

    for (const cb of subs) {
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
      return current;
    },

    get value() {
      return current;
    },

    get previousValue() {
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

export function writableAtom<T>(initialValue: T): WritableAtom<T> {
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
      return current;
    },

    get value() {
      return current;
    },

    get previousValue() {
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

      for (const cb of subs) {
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
  for (const cb of subs) {
    cb(current);
  }

  return instance;
}

/**
 * Creates an atom from a promise factory.
 *
 * The atom starts with `initialValue` and updates when the promise resolves.
 * If the promise rejects, the atom stays at `initialValue` and the optional
 * `onError` callback is invoked.
 *
 * @param factory - Function that returns a promise.
 * @param initialValue - Value used before the promise resolves.
 * @param onError - Optional callback invoked if the promise rejects.
 * @returns An atom that tracks the promise result.
 *
 * @example
 * ```ts
 * const data = promiseAtom(() => fetch('/api/user').then(r => r.json()), {});
 * // scope.loading is true until the fetch completes
 * ```
 */
export function promiseAtom<T>(
  factory: () => Promise<T>,
  initialValue: T,
  onError?: (error: any) => void
): Atom<T> {
  const subject = createSubject<T>();

  factory().then(
    (value) => {
      subject.next(value);
      subject.complete();
    },
    (err) => {
      if (onError) onError(err);
      subject.next(initialValue);
      subject.complete();
    }
  );

  return atom(subject, initialValue);
}
