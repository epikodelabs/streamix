import type { Stream } from "../abstractions/stream";
import { createSubscription, type Subscription } from "../abstractions/subscription";
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