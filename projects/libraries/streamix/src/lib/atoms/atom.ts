import type { Stream } from "@epikodelabs/streamix";
import { createSubscription, type Subscription } from "../abstractions/subscription";
import { DERIVED_ATOM, registerWithCurrentScope } from "./scope";

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
   * Never returns `undefined` due to errors.
   * @throws {Error} If the atom has not yet emitted a value, is in an error state, or has been disposed. For a nullable variant, use
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

  /** Subscribes to all state changes, including value, error, and disposed states. */
  onStateChange(callback: (state: AtomState<T>) => void): Subscription;

  /** Disposes the atom, clearing all subscriptions and resources. */
  dispose(): void;
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

export function flow<T>(stream: Stream<T>): AtomBase<T> {
  let state: AtomState<T> = {
    tag: "error",
    current: new Error("Flow has not emitted yet"),
    previous: undefined
  };
  const valueSubs = new Set<(value: T) => void>();
  const stateSubs = new Set<(state: AtomState<T>) => void>();

  const streamSub = stream.subscribe({
    next(value: T) {
      if (state.tag === "disposed") return;

      const prev = state.tag === "value" ? state.current : state.previous;

      state = { tag: "value", current: value, previous: prev };
      for (const cb of Array.from(stateSubs)) {
        cb(state);
      }

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
      for (const cb of Array.from(stateSubs)) {
        cb(state);
      }
    },
  });

  const instance: AtomBase<T> = {
    type: "atom",

    get disposed() { return state.tag === "disposed"; },
    get error() { return state.tag === "error" ? state.current : null; },
    get() { return getStateValue(state); },

    get value() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      if (state.tag === "value") return state.current;
      throw new Error("Atom has not emitted a value yet or is in an error state.");
    },

    get safeValue() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      return state.tag === "value" ? state.current : state.previous;
    },

    get prior() { return state.previous; },

    subscribe(callback) {
      valueSubs.add(callback);
      return createSubscription(() => { valueSubs.delete(callback); });
    },

    onStateChange(callback) {
      stateSubs.add(callback);
      // Do not emit the initial "not emitted" error state to new subscribers.
      // They will get the first value when it's set.
      if (state.tag === "value") callback(state);
      return createSubscription(() => { stateSubs.delete(callback); });
    },

    dispose() {
      if (state.tag === "disposed") return;
      const prev = state.previous;
      state = { tag: "disposed", previous: prev };
      for (const cb of Array.from(stateSubs)) {
        cb(state);
      }
      valueSubs.clear();
      streamSub.unsubscribe();
    },
  };

  registerWithCurrentScope(instance);
  return instance;
}

/* ── atom ── */

export interface Atom<T = any> extends AtomBase<T> {
  /** Updates the atom's value. Transitions Error → Value (recovery). */
  set(value: T): void;

  /** Transitions the atom into an error state. */
  setError(error: Error): void;
}

export interface AtomOptions<T = any> {
  /** Custom equality function. If provided, `set` calls that return `true` are ignored. */
  equal?: (a: T, b: T) => boolean;
}

export function atom<T>(initialValue?: T, options?: AtomOptions<T>): Atom<T> {
  let state: AtomState<T> = initialValue !== undefined
    ? valueState(initialValue)
    : { tag: "error", current: new Error("Atom has not emitted yet"), previous: undefined };
  const valueSubs = new Set<(value: T) => void>();
  const stateSubs = new Set<(state: AtomState<T>) => void>();
  const equal = options?.equal;

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
      if (state.tag === "value") return state.current;
      throw new Error("Atom has not emitted a value yet or is in an error state.");
    },

    get safeValue() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      return state.tag === "value" ? state.current : state.previous;
    },

    get prior() { return state.previous; },

    subscribe(callback) {
      valueSubs.add(callback);
      return createSubscription(() => { valueSubs.delete(callback); });
    },

    onStateChange(callback) {
      stateSubs.add(callback);
      // Do not emit the initial "not emitted" error state to new subscribers.
      // They will get the first value when it's set.
      if (state.tag === "value") callback(state);
      return createSubscription(() => { stateSubs.delete(callback); });
    },

    set(value) {
      if (state.tag === "disposed") return;

      const prev = state.tag === "value" ? state.current : state.previous;

      if (state.tag === "value" && equal && equal(state.current, value)) {
        return;
      }

      state = { tag: "value", current: value, previous: prev };
      for (const cb of Array.from(stateSubs)) {
        cb(state);
      }

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
      for (const cb of Array.from(stateSubs)) {
        cb(state);
      }
    },

    dispose() {
      if (state.tag === "disposed") return;
      const prev = state.previous;
      state = { tag: "disposed", previous: prev };
      for (const cb of Array.from(stateSubs)) {
        cb(state);
      }
      valueSubs.clear();
    },
  };

  registerWithCurrentScope(instance);
  return instance;
}

/* ── derived ── */

export function derived<T>(fn: () => T): AtomBase<T> {
  let state: AtomState<T> = {
    tag: "error",
    current: new Error("Derived atom has not been evaluated yet"),
    previous: undefined
  };
  let running = false;
  let evaluated = false;

  const valueSubs = new Set<(value: T) => void>();
  const stateSubs = new Set<(state: AtomState<T>) => void>();
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
            if (running || state.tag === "disposed") return;

            const prevValue = state.tag === "value" ? state.current : state.previous;
            const next = run();

            if (next.type === "value") {
              state = { tag: "value", current: next.value, previous: prevValue };
              for (const cb of Array.from(stateSubs)) {
                cb(state);
              }
              runWithPropagation(() => {
                for (const cb of Array.from(valueSubs)) {
                  queueNotification(() => cb(next.value));
                }
              });
            } else {
              state = { tag: "error", current: next.error, previous: prevValue };
              for (const cb of Array.from(stateSubs)) {
                cb(state);
              }
            }
          })
        );
      }
    }

    return result;
  };

  context.run = run;

  const ensureEvaluated = (): void => {
    if (evaluated || state.tag === "disposed") return;
    evaluated = true;
    const result = run();
    if (result.type === "value") {
      state = { tag: "value", current: result.value, previous: result.value };
    } else {
      state = { tag: "error", current: result.error, previous: undefined };
    }
  };

  const instance: AtomBase<T> = {
    type: "atom",

    get disposed() { return state.tag === "disposed"; },
    get error() { return state.tag === "error" ? state.current : null; },
    get() {
      ensureEvaluated();
      if (activeFormula) activeFormula.dependencies.add(instance);
      return getStateValue(state);
    },

    get value() {
      ensureEvaluated();
      if (activeFormula) activeFormula.dependencies.add(instance);
      if (state.tag === "value") return state.current;
      throw new Error("Derived atom has not been evaluated yet or is in an error state.");
    },

    get safeValue() {
      ensureEvaluated();
      if (activeFormula) activeFormula.dependencies.add(instance);
      return state.tag === "value" ? state.current : state.previous;
    },

    get prior() {
      ensureEvaluated();
      return state.previous;
    },

    subscribe(callback) {
      ensureEvaluated();
      valueSubs.add(callback);
      return createSubscription(() => { valueSubs.delete(callback); });
    },

    onStateChange(callback) {
      ensureEvaluated();
      stateSubs.add(callback);
      // Do not emit the initial "not emitted" error state to new subscribers.
      // They will get the first value when it's set.
      if (state.tag === "value") callback(state);
      return createSubscription(() => { stateSubs.delete(callback); });
    },

    dispose() {
      if (state.tag === "disposed") return;
      const prev = state.previous;
      state = { tag: "disposed", previous: prev };
      for (const cb of Array.from(stateSubs)) {
        cb(state);
      }
      for (const sub of depSubscriptions.values()) sub.unsubscribe();
      depSubscriptions.clear();
      valueSubs.clear();
    },
  };

  (instance as any)[DERIVED_ATOM] = true;

  registerWithCurrentScope(instance);
  return instance;
}

/* ── iterate ── */

export function iterate<T>(atom: AtomBase<T>, signal?: AbortSignal): AsyncIterator<T> {
  if (signal?.aborted) {
    return {
      next: () => Promise.resolve({ done: true, value: undefined as any }),
      return: () => Promise.resolve({ done: true, value: undefined as any }),
    };
  }

  const buffer: T[] = [];
  let resolveNext: ((value: IteratorResult<T>) => void) | null = null;
  let done = false;

  const cleanup = () => {
    if (done) return;
    done = true;
    signal?.removeEventListener("abort", cleanup);
    subscription.unsubscribe();
    if (resolveNext) {
      resolveNext({ value: undefined as any, done: true });
      resolveNext = null;
    }
  };

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

  signal?.addEventListener("abort", cleanup, { once: true });

  return {
    async next(): Promise<IteratorResult<T>> {
      if (!done && atom.disposed && buffer.length === 0) {
        cleanup();
      }

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
      cleanup();
      return { value: undefined as any, done: true };
    },
  };
}