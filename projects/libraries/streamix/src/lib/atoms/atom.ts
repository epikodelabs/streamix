import type { Stream } from "../abstractions/stream";
import { createSubscription, type Subscription } from "../abstractions/subscription";
import { registerWithCurrentScope } from "./scope";

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
   * Reads the current value.
   *
   * When called inside a {@link derived} factory, this atom is automatically
   * registered as a dependency.
   *
   * @returns The current value.
   * @throws {Error} If the atom has been disposed.
   */
  get(): T;

  /**
   * The current value.
   *
   * When accessed inside a {@link derived} factory, this atom is automatically
   * registered as a dependency.
   */
  readonly value: T;

  /** The previous value (before the most recent change). */
  readonly prior: T;

  /** Whether the atom has been disposed. */
  readonly disposed: boolean;

  /**
   * Subscribes to value changes.
   *
   * The callback is invoked synchronously whenever the atom's value changes.
   *
   * @param callback - Function called with the new value.
   * @returns A subscription that can be used to unsubscribe.
   */
  subscribe(callback: (value: T) => void): Subscription;

  /** Disposes the atom, clearing all subscriptions and resources. */
  dispose(): void;
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
  set(value: T): void;
}

let activeFormula: { dependencies: Set<AtomBase<any>> } | null = null;

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
export function flow<T>(stream: Stream<T>, initialValue: T): AtomBase<T> {
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

  const instance: AtomBase<T> = {
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

/**
 * Creates a writable atom with an initial value.
 *
 * Writable atoms can be updated via {@link Atom.set} and automatically notify
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
 *   count.set(5);
 *   console.log(count.value); // 5
 *   return { count };
 * });
 * ```
 */
export function atom<T>(initialValue: T): Atom<T> {
  let current = initialValue;
  let previous = initialValue;
  let disposed = false;

  const subs = new Set<(value: T) => void>();

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
export interface AsyncAtom<T = any> extends AtomBase<T> {
  /**
   * Updates the atom's value and notifies subscribers.
   *
   * If the new value is the same as the current value (using `Object.is`),
   * no notification occurs.
   *
   * @param value - The new value to set.
   */
  set(value: T): void;
}

/**
 * Creates an async atom with optional replay capacity.
 *
 * Async atoms are hot atoms that do not require an initial value.
 * Values are pushed via {@link AsyncAtom.set}. Late subscribers can
 * receive buffered values based on the configured capacity.
 *
 * @param options - Configuration options.
 * @returns An async atom.
 *
 * @example
 * ```ts
 * const app = scope(() => {
 *   const count = asyncAtom<number>();
 *   count.set(5);
 *   console.log(count.value); // 5
 *   return { count };
 * });
 * ```
 */
export function asyncAtom<T>(): AsyncAtom<T>;
export function asyncAtom<T>(options: AsyncAtomOptions): AsyncAtom<T>;
export function asyncAtom<T>(options?: AsyncAtomOptions): AsyncAtom<T> {
  const capacity = options?.capacity ?? 0;
  const isFiniteCapacity = capacity !== Infinity && capacity > 0;
  const replay: T[] = [];
  let replayHead = 0;

  let current: T = undefined as any;
  let previous: T = undefined as any;
  let hasValue = false;
  let disposed = false;

  const subs = new Set<(value: T) => void>();

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

  const instance: AsyncAtom<T> = {
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

      // Replay buffered values to late subscribers
      forEachReplay((value) => callback(value));

      return createSubscription(() => {
        subs.delete(callback);
      });
    },

    set(value) {
      if (disposed) return;
      if (hasValue && Object.is(current, value)) return;

      previous = current;
      current = value;
      hasValue = true;
      pushReplay(value);

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
      replay.length = 0;
      replayHead = 0;
    }
  };

  registerWithCurrentScope(instance);

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
export function derived<T>(fn: () => T): AtomBase<T> {
  let current: T;
  let previous: T;
  let disposed = false;
  let running = false;
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

  const instance: AtomBase<T> = {
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
 * setTimeout(() => a.set(1), 10);
 * setTimeout(() => a.set(2), 20);
 * setTimeout(() => a.dispose(), 30);
 *
 * for await (const value of iterate(a)) {
 *   console.log(value); // 0, 1, 2
 * }
 * ```
 */
export function iterate<T>(atom: AtomBase<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const buffer: T[] = [];
      let resolveNext: ((value: IteratorResult<T>) => void) | null = null;
      let done = false;

      // Push current value immediately
      buffer.push(atom.value);

      const subscription = atom.subscribe((value) => {
        if (done) return;
        if (resolveNext) {
          resolveNext({ value, done: false });
          resolveNext = null;
        } else {
          buffer.push(value);
        }
      });

      // Track disposal
      const checkDisposed = () => {
        if (atom.disposed && !done) {
          done = true;
          if (resolveNext) {
            resolveNext({ value: undefined as any, done: true });
            resolveNext = null;
          }
        }
      };

      // Poll for disposal since we can't directly observe it
      const disposeInterval = setInterval(checkDisposed, 0);

      return {
        async next(): Promise<IteratorResult<T>> {
          if (done) {
            return { value: undefined as any, done: true };
          }

          if (buffer.length > 0) {
            return { value: buffer.shift()!, done: false };
          }

          return new Promise<IteratorResult<T>>((resolve) => {
            resolveNext = resolve;
          });
        },

        async return(): Promise<IteratorResult<T>> {
          done = true;
          clearInterval(disposeInterval);
          subscription.unsubscribe();
          return { value: undefined as any, done: true };
        },
      };
    },
  };
}
