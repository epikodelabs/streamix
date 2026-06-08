import type { Stream } from "../abstractions/stream";
import { createSubscription, type Subscription } from "../abstractions/subscription";
import { registerWithCurrentScope } from "./scope";

/* ── Atom Result (discriminated union for result-aware subscribers) ── */

export type AtomResult<T> =
  | { type: "value"; value: T }
  | { type: "error"; error: Error };

function valueResult<T>(value: T): AtomResult<T> {
  return { type: "value", value };
}

function errorResult<T>(error: Error): AtomResult<T> {
  return { type: "error", error };
}

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

  /** The current error, or `null` if the atom is in the Value state. */
  readonly error: Error | null;

  /**
   * Subscribes to value changes (backward-compatible).
   * Only invoked on value changes, not on error transitions.
   */
  subscribe(callback: (value: T) => void): Subscription;

  /**
   * Subscribes to all state transitions, including errors.
   * Receives a discriminated {@link AtomResult}.
   */
  subscribeResult(callback: (result: AtomResult<T>) => void): Subscription;

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

let activeFormula: { dependencies: Set<AtomBase<any>> } | null = null;

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


function getStateValue<T>(state: AtomState<T>): T {
  if (state.tag === "value") return state.current;
  if (state.tag === "error") throw state.current;
  throw new Error("Atom has been disposed");
}

/* ── flow ── */

export function flow<T>(stream: Stream<T>, initialValue: T): AtomBase<T> {
  let state: AtomState<T> = valueState(initialValue);
  let hasEmitted = false;

  const valueSubs = new Set<(value: T) => void>();
  const resultSubs = new Set<(result: AtomResult<T>) => void>();

  const notifyValueSubscribers = (value: T) => {
    for (const cb of Array.from(valueSubs)) cb(value);
  };

  const notifyResultSubscribers = (result: AtomResult<T>) => {
    for (const cb of Array.from(resultSubs)) cb(result);
  };

  const streamSub = stream.subscribe({
    next(value: T) {
      if (state.tag === "disposed") return;

      // previous = old current, but in error state current is Error,
      // so carry forward the last T value instead
      const prev = state.tag === "value" ? state.current : state.previous;

      if (state.tag === "value" && Object.is(state.current, value)) return;

      hasEmitted = true;
      state = { tag: "value", current: value, previous: prev };

      const result = valueResult(value);
      runWithPropagation(() => {
        notifyValueSubscribers(value);
        notifyResultSubscribers(result);
      });
    },
    error(err: Error) {
      if (state.tag === "disposed") return;

      const prev = state.tag === "value" ? state.current : state.previous;
      state = { tag: "error", current: err, previous: prev };

      const result = errorResult<T>(err);
      runWithPropagation(() => {
        notifyResultSubscribers(result);
      });
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
      return createSubscription(() => { valueSubs.delete(callback); });
    },

    subscribeResult(callback) {
      resultSubs.add(callback);
      return createSubscription(() => { resultSubs.delete(callback); });
    },

    dispose() {
      if (state.tag === "disposed") return;
      const prev = state.previous;
      state = { tag: "disposed", previous: prev };
      valueSubs.clear();
      resultSubs.clear();
      streamSub.unsubscribe();
    },
  };

  registerWithCurrentScope(instance);

  if (hasEmitted && state.tag === "value") {
    for (const cb of Array.from(valueSubs)) cb(state.current);
    for (const cb of Array.from(resultSubs)) cb(valueResult(state.current));
  }

  return instance;
}

/* ── atom ── */

export function atom<T>(initialValue: T): Atom<T> {
  let state: AtomState<T> = valueState(initialValue);

  const valueSubs = new Set<(value: T) => void>();
  const resultSubs = new Set<(result: AtomResult<T>) => void>();

  const notifyValueSubscribers = (value: T) => {
    for (const cb of Array.from(valueSubs)) cb(value);
  };

  const notifyResultSubscribers = (result: AtomResult<T>) => {
    for (const cb of Array.from(resultSubs)) cb(result);
  };

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
      return createSubscription(() => { valueSubs.delete(callback); });
    },

    subscribeResult(callback) {
      resultSubs.add(callback);
      return createSubscription(() => { resultSubs.delete(callback); });
    },

    set(value) {
      if (state.tag === "disposed") return;

      const prev = state.tag === "value" ? state.current : state.previous;
      if (state.tag === "value" && Object.is(state.current, value)) return;

      state = { tag: "value", current: value, previous: prev };

      const result = valueResult(value);
      runWithPropagation(() => {
        notifyValueSubscribers(value);
        notifyResultSubscribers(result);
      });
    },

    setError(error) {
      if (state.tag === "disposed") return;

      const prev = state.tag === "value" ? state.current : state.previous;
      if (state.tag === "error" && state.current === error) return;

      state = { tag: "error", current: error, previous: prev };

      const result = errorResult<T>(error);
      runWithPropagation(() => {
        notifyResultSubscribers(result);
      });
    },

    dispose() {
      if (state.tag === "disposed") return;
      const prev = state.previous;
      state = { tag: "disposed", previous: prev };
      valueSubs.clear();
      resultSubs.clear();
    },
  };

  registerWithCurrentScope(instance);

  for (const cb of Array.from(valueSubs)) cb(initialValue);
  for (const cb of Array.from(resultSubs)) cb(valueResult(initialValue));

  return instance;
}

/* ── asyncAtom ── */

export interface AsyncAtomOptions { capacity?: number; }

export interface AsyncAtom<T = any> extends AtomBase<T> {
  set(value: T): void;
  setError(error: Error): void;
}

export function asyncAtom<T>(): AsyncAtom<T>;
export function asyncAtom<T>(options: AsyncAtomOptions): AsyncAtom<T>;
export function asyncAtom<T>(options?: AsyncAtomOptions): AsyncAtom<T> {
  const capacity = options?.capacity ?? 0;
  const isFiniteCapacity = capacity !== Infinity && capacity > 0;
  const replay: AtomResult<T>[] = [];
  let replayHead = 0;

  // No initial value — previous is undefined until first set()
  let state: AtomState<T> = { tag: "error", current: new Error("Async atom has not emitted yet"), previous: undefined };
  let hasValue = false;

  const valueSubs = new Set<(value: T) => void>();
  const resultSubs = new Set<(result: AtomResult<T>) => void>();

  const pushReplay = (result: AtomResult<T>) => {
    if (capacity <= 0) return;
    if (!isFiniteCapacity) { replay.push(result); return; }
    if (replay.length < capacity) { replay.push(result); }
    else { replay[replayHead] = result; replayHead = (replayHead + 1) % capacity; }
  };

  const forEachReplay = (fn: (result: AtomResult<T>) => void) => {
    if (capacity <= 0) return;
    if (!isFiniteCapacity) { for (const r of replay) fn(r); return; }
    const size = replay.length;
    const start = size < capacity ? 0 : replayHead;
    for (let i = 0; i < size; i++) fn(replay[(start + i) % capacity]);
  };

  const notifyValueSubscribers = (value: T) => {
    for (const cb of Array.from(valueSubs)) cb(value);
  };

  const notifyResultSubscribers = (result: AtomResult<T>) => {
    for (const cb of Array.from(resultSubs)) cb(result);
  };

  const instance: AsyncAtom<T> = {
    type: "atom",

    get disposed() { return state.tag === "disposed"; },
    get error() { return state.tag === "error" ? state.current : null; },
    get() { return getStateValue(state); },

    get value() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      // No guarantee of a value before first set() — throw would break
      // backward-compat, so return the non-null assertion. Consumers
      // should check .error or use .safeValue if the atom may not have
      // emitted yet.
      return state.tag === "value" ? state.current : state.previous!;
    },

    get safeValue() {
      if (activeFormula) activeFormula.dependencies.add(instance);
      return state.tag === "value" ? state.current : state.previous;
    },

    get prior() { return state.previous; },

    subscribe(callback) {
      valueSubs.add(callback);
      forEachReplay((result) => {
        if (result.type === "value") callback(result.value);
      });
      return createSubscription(() => { valueSubs.delete(callback); });
    },

    subscribeResult(callback) {
      resultSubs.add(callback);
      forEachReplay((result) => callback(result));
      return createSubscription(() => { resultSubs.delete(callback); });
    },

    set(value) {
      if (state.tag === "disposed") return;

      const prev = state.tag === "value" ? state.current : state.previous;
      if (hasValue && state.tag === "value" && Object.is(state.current, value)) return;

      state = { tag: "value", current: value, previous: prev };
      hasValue = true;

      const result = valueResult(value);
      pushReplay(result);
      runWithPropagation(() => {
        notifyValueSubscribers(value);
        notifyResultSubscribers(result);
      });
    },

    setError(error) {
      if (state.tag === "disposed") return;

      const prev = state.tag === "value" ? state.current : state.previous;
      if (state.tag === "error" && state.current === error) return;

      state = { tag: "error", current: error, previous: prev };

      const result = errorResult<T>(error);
      pushReplay(result);
      runWithPropagation(() => {
        notifyResultSubscribers(result);
      });
    },

    dispose() {
      if (state.tag === "disposed") return;
      const prev = state.previous;
      state = { tag: "disposed", previous: prev };
      valueSubs.clear();
      resultSubs.clear();
      replay.length = 0;
      replayHead = 0;
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
  const resultSubs = new Set<(result: AtomResult<T>) => void>();
  const dependencies = new Set<AtomBase<any>>();
  const depSubscriptions = new Map<AtomBase<any>, Subscription>();

  const notifyValueSubscribers = (value: T) => {
    for (const cb of Array.from(valueSubs)) cb(value);
  };

  const notifyResultSubscribers = (result: AtomResult<T>) => {
    for (const cb of Array.from(resultSubs)) cb(result);
  };

  const run = (): AtomResult<T> => {
    if (running) throw new Error("Circular dependency detected in derived()");

    const oldDeps = new Set(depSubscriptions.keys());
    dependencies.clear();

    running = true;
    const prev = activeFormula;
    activeFormula = context;
    let result: AtomResult<T>;
    try {
      result = valueResult(fn());
    } catch (err) {
      result = errorResult<T>(err instanceof Error ? err : new Error(String(err)));
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
                notifyValueSubscribers(next.value);
                notifyResultSubscribers(next);
              });
            } else {
              state = { tag: "error", current: next.error, previous: prevValue };
              runWithPropagation(() => {
                notifyResultSubscribers(next);
              });
            }
          })
        );
      }
    }

    return result;
  };

  const context = { dependencies, run };

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
      return createSubscription(() => { valueSubs.delete(callback); });
    },

    subscribeResult(callback) {
      resultSubs.add(callback);
      return createSubscription(() => { resultSubs.delete(callback); });
    },

    dispose() {
      if (state.tag === "disposed") return;
      const prev = state.previous;
      state = { tag: "disposed", previous: prev };
      for (const sub of depSubscriptions.values()) sub.unsubscribe();
      depSubscriptions.clear();
      valueSubs.clear();
      resultSubs.clear();
    },
  };

  registerWithCurrentScope(instance);

  if (initial.type === "value") {
    for (const cb of Array.from(valueSubs)) cb(initial.value);
  }
  for (const cb of Array.from(resultSubs)) cb(initial);

  return instance;
}

/* ── iterate ── */

export function iterate<T>(atom: AtomBase<T>): AsyncIterator<AtomResult<T>> {
  const buffer: AtomResult<T>[] = [];
  let resolveNext: ((value: IteratorResult<AtomResult<T>>) => void) | null = null;
  let done = false;

  const currentError = atom.error;
  if (currentError) {
    buffer.push(errorResult<T>(currentError));
  } else {
    buffer.push(valueResult(atom.safeValue!));
  }

  const subscription = atom.subscribeResult((result) => {
    if (done) return;
    if (resolveNext) {
      resolveNext({ value: result, done: false });
      resolveNext = null;
    } else {
      buffer.push(result);
    }
  });

  const checkDisposed = () => {
    if (atom.disposed && !done) {
      done = true;
      if (resolveNext) {
        resolveNext({ value: undefined as any, done: true });
        resolveNext = null;
      }
    }
  };

  const disposeInterval = setInterval(checkDisposed, 0);

  return {
    async next(): Promise<IteratorResult<AtomResult<T>>> {
      if (done) return { value: undefined as any, done: true };
      if (buffer.length > 0) return { value: buffer.shift()!, done: false };
      return new Promise<IteratorResult<AtomResult<T>>>((resolve) => { resolveNext = resolve; });
    },
    async return(): Promise<IteratorResult<AtomResult<T>>> {
      done = true;
      clearInterval(disposeInterval);
      subscription.unsubscribe();
      return { value: undefined as any, done: true };
    },
  };
}