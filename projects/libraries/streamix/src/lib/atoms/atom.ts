import type { Stream } from "../abstractions/stream";
import { createSubscription, type Subscription } from "../abstractions/subscription";
import { registerWithCurrentScope } from "./scope";

/* ── Base interface ── */

export interface AtomBase<T = any> {
  type: "atom";

  /**
   * Reads the current value.
   * @throws {Error} If the atom has been disposed or is in an error state.
   */
  get(): T;

  /**
   * The current value, or the last known value if in an error state.
   * Never returns `undefined` due to errors. For a nullable variant, use
   * {@link safeValue}.
   */
  readonly value: T;

  /**
   * The current value, or `undefined` if in an error or disposed state.
   * Use alongside {@link error} to discriminate.
   */
  readonly safeValue: T | undefined;

  /** The previous value, or `undefined` if no previous value exists. */
  readonly prior: T | undefined;

  /** Whether the atom has been disposed. */
  readonly disposed: boolean;

  /** The current error, or `null` if the atom is in a valid Value state. */
  readonly error: Error | null;

  /**
   * Subscribes to value changes.
   * Only invoked on valid value transitions, not on error states.
   */
  subscribe(callback: (value: T) => void): Subscription;

  /** Disposes the atom, clearing all subscriptions and resources. */
  dispose(): void;
}

export interface Atom<T = any> extends AtomBase<T> {
  /** Updates the atom's value. Transitions Error → Value (recovery). */
  set(value: T): void;

  /** Transitions the atom into an error state. */
  setError(error: Error): void;
}

/* ── Internal state type ── */

type AtomState<T> =
  | { tag: "value"; current: T; previous: T | undefined }
  | { tag: "error"; current: Error; previous: T | undefined }
  | { tag: "disposed"; previous: T | undefined };

function valueState<T>(value: T): AtomState<T> {
  return { tag: "value", current: value, previous: value };
}

/* ── Dependency tracking ── */

interface FormulaContext {
  dependencies: Set<AtomBase<any>>;
  run: () => any;
}

let activeFormula: FormulaContext | null = null;

/* ── Glitch-free propagation ── */

let propagationDepth = 0;
let deferredNotifications = new Set<() => void>();

function flushDeferred() {
  const notifications = Array.from(deferredNotifications);
  deferredNotifications.clear();
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
    if (propagationDepth === 0) {
      flushDeferred();
    }
  }
}

function queueNotification(cb: () => void) {
  if (propagationDepth > 0) {
    deferredNotifications.add(cb);
  } else {
    cb();
  }
}

function getStateValue<T>(state: AtomState<T>): T {
  if (state.tag === "value") return state.current;
  if (state.tag === "error") throw state.current;
  throw new Error("Atom has been disposed");
}

/* ── flow ── */

export function flow<T>(stream: Stream<T>, initialValue: T): AtomBase<T> {
  let state: AtomState<T> = valueState(initialValue);
  const valueSubs = new Set<(value: T) => void>();

  const streamSub = stream.subscribe({
    next(value: T) {
      if (state.tag === "disposed") return;

      const prev = state.tag === "value" ? state.current : state.previous;
      if (state.tag === "value" && Object.is(state.current, value)) return;

      state = { tag: "value", current: value, previous: prev };

      runWithPropagation(() => {
        for (const cb of Array.from(valueSubs)) {
          queueNotification(() => cb(value));
        }
      });
    },
    error(err: Error) {
      if (state.tag === "disposed") return;

      const prev = state.tag === "value" ? state.current : state.previous;
      state = { tag: "error", current: err, previous: prev };
    },
  });

  const instance: AtomBase<T> = {
    type: "atom",

    get disposed() { return state.tag === "disposed"; },
    get error() { return state.tag === "error" ? state.current : null; },
    get() { return getStateValue(state); },

    get value() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      return state.tag === "value" ? state.current : state.previous!;
    },

    get safeValue() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      return state.tag === "value" ? state.current : state.previous;
    },

    get prior() { return state.previous; },

    subscribe(callback) {
      valueSubs.add(callback);
      if (state.tag === "value") {
        callback(state.current);
      }
      return createSubscription(() => { valueSubs.delete(callback); });
    },

    dispose() {
      if (state.tag === "disposed") return;
      const prev = state.previous;
      state = { tag: "disposed", previous: prev };
      valueSubs.clear();
      streamSub.unsubscribe();
    },
  };

  registerWithCurrentScope(instance);
  return instance;
}

/* ── atom ── */

export function atom<T>(initialValue: T): Atom<T> {
  let state: AtomState<T> = valueState(initialValue);
  const valueSubs = new Set<(value: T) => void>();

  const instance: Atom<T> = {
    type: "atom",

    get disposed() { return state.tag === "disposed"; },
    get error() { return state.tag === "error" ? state.current : null; },
    get() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      return getStateValue(state);
    },

    get value() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      return state.tag === "value" ? state.current : state.previous!;
    },

    get safeValue() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      return state.tag === "value" ? state.current : state.previous;
    },

    get prior() { return state.previous; },

    subscribe(callback) {
      valueSubs.add(callback);
      if (state.tag === "value") {
        callback(state.current);
      }
      return createSubscription(() => { valueSubs.delete(callback); });
    },

    set(value) {
      if (state.tag === "disposed") return;

      const prev = state.tag === "value" ? state.current : state.previous;
      if (state.tag === "value" && Object.is(state.current, value)) return;

      state = { tag: "value", current: value, previous: prev };

      runWithPropagation(() => {
        for (const cb of Array.from(valueSubs)) {
          queueNotification(() => cb(value));
        }
      });
    },

    setError(error) {
      if (state.tag === "disposed") return;

      const prev = state.tag === "value" ? state.current : state.previous;
      if (state.tag === "error" && state.current === error) return;

      state = { tag: "error", current: error, previous: prev };
    },

    dispose() {
      if (state.tag === "disposed") return;
      const prev = state.previous;
      state = { tag: "disposed", previous: prev };
      valueSubs.clear();
    },
  };

  registerWithCurrentScope(instance);
  return instance;
}

/* ── asyncAtom ── */

export interface AsyncAtomOptions { capacity?: number; }

export type AsyncAtom<T = any> = Atom<T>;

export function asyncAtom<T>(options?: AsyncAtomOptions): AsyncAtom<T> {
  const capacity = options?.capacity ?? 0;
  const isFiniteCapacity = capacity !== Infinity && capacity > 0;
  const replay: T[] = [];

  let state: AtomState<T> = { 
    tag: "error", 
    current: new Error("Async atom has not emitted yet"), 
    previous: undefined 
  };
  let hasValue = false;
  const valueSubs = new Set<(value: T) => void>();

  const pushReplay = (value: T) => {
    if (capacity <= 0) return;
    replay.push(value);
    if (isFiniteCapacity && replay.length > capacity) {
      replay.shift();
    }
  };

  const instance: AsyncAtom<T> = {
    type: "atom",

    get disposed() { return state.tag === "disposed"; },
    get error() { return state.tag === "error" ? state.current : null; },
    get() { return getStateValue(state); },

    get value() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      return state.tag === "value" ? state.current : state.previous!;
    },

    get safeValue() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      return state.tag === "value" ? state.current : state.previous;
    },

    get prior() { return state.previous; },

    subscribe(callback) {
      valueSubs.add(callback);
      for (const val of replay) {
        callback(val);
      }
      return createSubscription(() => { valueSubs.delete(callback); });
    },

    set(value) {
      if (state.tag === "disposed") return;

      const prev = state.tag === "value" ? state.current : state.previous;
      if (hasValue && state.tag === "value" && Object.is(state.current, value)) return;

      state = { tag: "value", current: value, previous: prev };
      hasValue = true;

      pushReplay(value);
      runWithPropagation(() => {
        for (const cb of Array.from(valueSubs)) {
          queueNotification(() => cb(value));
        }
      });
    },

    setError(error) {
      if (state.tag === "disposed") return;

      const prev = state.tag === "value" ? state.current : state.previous;
      if (state.tag === "error" && state.current === error) return;

      state = { tag: "error", current: error, previous: prev };
    },

    dispose() {
      if (state.tag === "disposed") return;
      const prev = state.previous;
      state = { tag: "disposed", previous: prev };
      valueSubs.clear();
      replay.length = 0;
    },
  };

  registerWithCurrentScope(instance);
  return instance;
}

/* ── derived ── */

export function derived<T>(fn: () => T): AtomBase<T> {
  let state: AtomState<T>;
  let running = false;

  const valueSubs = new Set<(value: T) => void>();
  const dependencies = new Set<AtomBase<any>>();
  const depSubscriptions = new Map<AtomBase<any>, Subscription>();

  // Fix ReferenceError by defining the tracking payload context container out-of-band first
  const context: FormulaContext = {
    dependencies,
    run: () => {}
  };

  const run = (): { type: "value"; value: T } | { type: "error"; error: Error } => {
    if (running) throw new Error("Circular dependency detected in derived()");

    const oldDeps = new Set(depSubscriptions.keys());
    dependencies.clear();

    running = true;
    const prev = activeFormula;
    activeFormula = context;
    
    let result: { type: "value"; value: T } | { type: "error"; error: Error };
    try {
      result = { type: "value", value: fn() };
    } catch (err) {
      result = { type: "error", error: err instanceof Error ? err : new Error(String(err)) };
    } finally {
      activeFormula = prev;
      running = false;
    }

    for (const dep of oldDeps) {
      if (!dependencies.has(dep)) {
        depSubscriptions.get(dep)?.unsubscribe();
        depSubscriptions.delete(dep);
      }
    }

    for (const dep of dependencies) {
      if (!depSubscriptions.has(dep)) {
        depSubscriptions.set(
          dep,
          dep.subscribe(() => {
            if (state.tag === "disposed") return;

            const prevValue = state.tag === "value" ? state.current : state.previous;
            const next = run();

            if (next.type === "value" && state.tag === "value" && Object.is(state.current, next.value)) return;
            if (next.type === "error" && state.tag === "error" && state.current === next.error) return;

            if (next.type === "value") {
              state = { tag: "value", current: next.value, previous: prevValue };
              runWithPropagation(() => {
                for (const cb of Array.from(valueSubs)) {
                  queueNotification(() => cb(next.value));
                }
              });
            } else {
              state = { tag: "error", current: next.error, previous: prevValue };
            }
          })
        );
      }
    }

    return result;
  };

  context.run = run;

  const initial = run();
  if (initial.type === "value") {
    state = { tag: "value", current: initial.value, previous: initial.value };
  } else {
    state = { tag: "error", current: initial.error, previous: undefined };
  }

  const instance: AtomBase<T> = {
    type: "atom",

    get disposed() { return state.tag === "disposed"; },
    get error() { return state.tag === "error" ? state.current : null; },
    get() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      return getStateValue(state);
    },

    get value() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      return state.tag === "value" ? state.current : state.previous!;
    },

    get safeValue() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      return state.tag === "value" ? state.current : state.previous;
    },

    get prior() { return state.previous; },

    subscribe(callback) {
      valueSubs.add(callback);
      if (state.tag === "value") {
        callback(state.current);
      }
      return createSubscription(() => { valueSubs.delete(callback); });
    },

    dispose() {
      if (state.tag === "disposed") return;
      const prev = state.previous;
      state = { tag: "disposed", previous: prev };
      for (const sub of depSubscriptions.values()) sub.unsubscribe();
      depSubscriptions.clear();
      valueSubs.clear();
    },
  };

  registerWithCurrentScope(instance);
  return instance;
}

/* ── iterate ── */

export function iterate<T>(atom: AtomBase<T>): AsyncIterator<T> {
  const buffer: T[] = [];
  let resolveNext: ((value: IteratorResult<T>) => void) | null = null;
  let done = false;

  if (atom.error === null && atom.safeValue !== undefined) {
    buffer.push(atom.safeValue);
  }

  const subscription = atom.subscribe((value) => {
    if (done) return;
    if (resolveNext) {
      resolveNext({ value, done: false });
      resolveNext = null;
    } else {
      buffer.push(value);
    }
  });

  return {
    async next(): Promise<IteratorResult<T>> {
      // Lazy evaluation check replaces performance-heavy setInterval loop
      if (atom.disposed && buffer.length === 0) {
        done = true;
      }

      if (done) {
        subscription.unsubscribe();
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
      subscription.unsubscribe();
      return { value: undefined as any, done: true };
    },
  };
}