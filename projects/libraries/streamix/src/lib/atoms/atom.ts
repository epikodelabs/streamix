import type { Stream } from "../abstractions/stream";
import { createSubscription, type Subscription } from "../abstractions/subscription";
import { registerWithCurrentScope } from "./scope";

/**
 * A read-only reactive value backed by a stream.
 *
 * Atoms suppress duplicate values (by identity), notify subscribers
 * synchronously on every real change, and cannot exist without a stream.
 */
export interface Atom<T = any> {
  /** Runtime type identifier. */
  readonly type: "atom";

  /** Returns the current value, or throws if the atom has been disposed. */
  get(): T;

  /** The current value. */
  readonly value: T;

  /** The value before the most recent change. */
  readonly previousValue: T;

  /** Registers a callback invoked on every change. */
  subscribe(callback: (value: T) => void): Subscription;

  /** Permanently disables the atom, drops all subscribers and unsubscribes from the source stream. */
  dispose(): void;

  /** `true` after {@link dispose} has been called. */
  readonly disposed: boolean;
}

/**
 * Creates a reactive atom attached to the given stream.
 *
 * The atom immediately subscribes to the stream and updates its value on
 * every emission. It automatically registers with the current {@link scope}
 * when created inside a scope factory.
 *
 * @param stream - The source stream.
 * @param initialValue - The starting value used before the stream emits.
 * @returns A new atom instance.
 *
 * @example
 * ```ts
 * const source = createSubject<number>();
 * const count = atom(source, 0);
 * count.subscribe(v => console.log(v));
 * source.next(5); // logs 5
 * ```
 */
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
      if (disposed) {
        throw new Error("Atom has been disposed");
      }
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
