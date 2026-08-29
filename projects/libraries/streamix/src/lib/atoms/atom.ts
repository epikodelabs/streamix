import { createAsyncCoordinator, getIterator, raceNext, type AsyncCoordinator } from "../utils/coordinator";
import { isAtom } from "../utils/helpers";
import { iterate } from "./iterate";
import { DONE, isPromiseLike, NEXT, type MaybePromise } from "./operator";

import {
  markAtomAsEmitted,
  registerWithCurrentScope,
} from "./scope";
import { ANALOG_DELIVERY } from "./delivery";
import { createSubscription, type Subscription } from "./subscription";

/* ─────────────────────────────────────────────────────────────────────────────
 * Architectural Symbols
 * ───────────────────────────────────────────────────────────────────────────*/

const NODE = Symbol("engine.node");
const META = Symbol("engine.meta");
const MARK_DIRTY = Symbol("engine.markDirty");
const FLUSH = Symbol("engine.flush");

export const NO_INITIAL_VALUE = Symbol("streamix.noInitialValue");

/**
 * Runtime options shared by writable atoms, derived atoms, and scope-created
 * atoms.
 */
export interface AtomOptions {
  /**
   * Soft subscriber limit used to detect likely leaks. The atom still works
   * after the limit, but the runtime may warn.
   */
  maxSubscribers?: number;
  /**
   * Handles errors raised by the atom source or subscribers.
   */
  onError?: (error: any) => void;
  /**
   * Disposes the atom after an error instead of keeping it recoverable.
   */
  terminateOnError?: boolean;
  /**
   * Controls whether subscriber/source errors are rethrown after error handlers
   * run.
   */
  propagateErrors?: boolean;
}

/**
 * Readable reactive value.
 *
 * Atoms expose the current value synchronously through {@link value}, can be
 * subscribed to, and are also async iterable for `for await...of` consumers.
 */
export interface Atom<T = any> {
  /** Runtime discriminator for atom-like values. */
  readonly type: "atom";
  /** Optional human-readable name used by integrations and diagnostics. */
  readonly name?: string;
  /** Current value. Throws if the atom is currently in an error state. */
  readonly value: T;
  /** Current value, returning the last safe value when the atom has errored. */
  readonly safeValue: T;
  /** Previously emitted value. */
  readonly previous: T;
  /** True after the atom has been disposed. */
  readonly disposed: boolean;
  /** True when reactive work is queued but not flushed yet. */
  readonly dirty: boolean;
  /** Last error captured by this atom, if any. */
  readonly error?: any;
  /** Number of active subscribers, when exposed by the implementation. */
  readonly subscriberCount?: number;
  /**
   * Subscribes to value changes.
   *
   * The callback receives `(current, previous)`. The returned subscription must
   * be disposed when the listener is no longer needed.
   */
  subscribe(callback?: (current: T, previous: T) => MaybePromise): Subscription;
  /** Subscribes to atom errors. */
  onError(handler: (error: any) => void): Subscription;
  /** Stops the atom and releases all subscribers/resources. */
  dispose(): void;
  /** Iterates emitted values until the atom is disposed or iteration is closed. */
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

/**
 * Read-only atom projection that preserves observation APIs while hiding
 * mutation and disposal controls.
 */
export interface Readable<T = any> {
  readonly type: "atom";
  readonly name?: string;
  readonly value: T;
  readonly safeValue: T;
  readonly previous: T;
  readonly disposed: boolean;
  readonly dirty: boolean;
  readonly error?: any;
  readonly subscriberCount?: number;
  subscribe(callback?: (current: T, previous: T) => MaybePromise): Subscription;
  onError(handler: (error: any) => void): Subscription;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

/**
 * Minimal reactive dependency contract accepted by derived formulas.
 *
 * This intentionally supports foreign/read-only atom-like sources that expose
 * synchronous `.value` reads plus a `subscribe(...)` change channel, even if
 * they are not full Streamix atoms.
 */
export interface DependencySource<T = any> {
  readonly value: T;
  subscribe(callback?: (current: T, previous: T) => MaybePromise): Subscription;
}

/**
 * Extracts the value type of an {@link Atom}.
 *
 * Useful when you want to name the type produced by a piped atom without
 * repeating it manually:
 *
 * ```ts
 * const combined = pipe([atom(1), atom('hello')]);
 * type CombinedValue = AtomValue<typeof combined>; // [number, string]
 * ```
 */
export type AtomValue<A> = A extends { value: infer T } ? T : never;

/**
 * Writable atom returned by {@link atom}.
 */
export interface Writable<T = any> extends Atom<T> {
  /** Emits a new value. */
  next(value: T): void;
  /** Alias for {@link next}. */
  set(value: T): void;
  /** Puts the atom into an error state and notifies error handlers. */
  fail(err: any, options?: { terminate?: boolean }): void;
  /** Clears a recoverable error state, when supported. */
  recover?(): void;
  /** Clears the stored error without emitting a value, when supported. */
  clearError?(): void;
}

/** Internal Node State */
/**
 * Scope object passed to self-based derived formulas.
 *
 * The scope is itself callable: `$(atom)` is shorthand for `$.read(atom)`, and
 * `$(atom1, atom2)` destructures multiple tracked atoms.
 */
export type DerivedScope = {
  <A>(atom: DependencySource<A>): A;
  <T extends DependencySource<any>[]>(...atoms: T): { [K in keyof T]: AtomValue<T[K]> };
  /** Read an atom and register it as a dependency of the current derived computation. */
  read<A>(atom: DependencySource<A>): A;
  /** Register closure or global-scope atoms and return them for destructuring. */
  use<T extends DependencySource<any>[]>(...atoms: T): T extends [infer U] ? U : T;
} & Record<string, unknown>;

interface AtomNode {
  depth: number;
  version: number;
  queued: boolean;
  isResource: boolean;
  conflate: boolean;
  flush: () => void;
  flushing?: boolean;
}

type DisposeHandler = () => MaybePromise<void>;

interface AtomRuntimeMeta {
  changeHandlers: Set<() => void>;
  dirtyHandlers: Set<(dirty: boolean) => void>;
  emitHandlers: Set<() => void>;
  disposeHandlers: Set<DisposeHandler>;
  startOnEmitObserve?: () => void;
  readableView?: Readable<any>;
}

/** Engine Interface */
interface InternalAtomContainer {
  [NODE]: AtomNode;
  [META]: AtomRuntimeMeta;
  [MARK_DIRTY](): void;
  [FLUSH](): void;
  _onDispose?: Set<DisposeHandler>;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Scheduler
 * ───────────────────────────────────────────────────────────────────────────*/

export interface Scheduler {
  queueFlush(node: AtomNode): void;
  flush(): void;
  remove(node: AtomNode): void;
  flushImmediately(node: AtomNode): void;
  get isDirty(): boolean;
}

class DefaultScheduler implements Scheduler {
  private isBatchScheduled = false;
  private isFlushing = false;
  private queuedCount = 0;

  // Min-heap of queued nodes ordered by depth (shallow first).
  // A node may appear multiple times if it was re-queued; stale entries are
  // skipped via queuedNodes membership and node.queued checks.
  private heap: AtomNode[] = [];
  private heapSeq = 0;
  private heapSeqMap = new WeakMap<AtomNode, number>();

  private heapCompare(a: AtomNode, b: AtomNode): number {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return (this.heapSeqMap.get(a) ?? 0) - (this.heapSeqMap.get(b) ?? 0);
  }

  private siftUp(i: number): void {
    const node = this.heap[i];
    while (i > 0) {
      const parentIdx = (i - 1) >>> 1;
      const parent = this.heap[parentIdx];
      if (this.heapCompare(node, parent) >= 0) break;
      this.heap[i] = parent;
      i = parentIdx;
    }
    this.heap[i] = node;
  }

  private siftDown(i: number): void {
    const node = this.heap[i];
    const len = this.heap.length;
    while (true) {
      const left = (i << 1) + 1;
      if (left >= len) break;
      const right = left + 1;
      let smallest = i;
      if (this.heapCompare(this.heap[left], node) < 0) smallest = left;
      if (right < len && this.heapCompare(this.heap[right], this.heap[smallest]) < 0) smallest = right;
      if (smallest === i) break;
      this.heap[i] = this.heap[smallest];
      i = smallest;
    }
    this.heap[i] = node;
  }

  private heapPush(node: AtomNode): void {
    this.heapSeqMap.set(node, this.heapSeq++);
    this.heap.push(node);
    this.siftUp(this.heap.length - 1);
  }

  private heapPop(): AtomNode | undefined {
    const last = this.heap.pop();
    if (last === undefined) return undefined;
    if (this.heap.length === 0) return last;
    const result = this.heap[0];
    this.heap[0] = last;
    this.siftDown(0);
    return result;
  }

  flush(): void {
    if (this.isFlushing || isTransactionActive()) return;
    this.isFlushing = true;

    try {
      let node = this.heapPop();
      while (node !== undefined) {
        if (node.queued && !node.flushing) {
          node.queued = false;
          this.queuedCount--;
          node.flush();
        }
        node = this.heapPop();
      }
    } finally {
      this.isFlushing = false;
      this.isBatchScheduled = false;
      this.heap.length = 0;
    }
  }

  flushImmediately(node: AtomNode): void {
    if (this.isFlushing) {
      this.queueFlush(node);
      return;
    }

    if (!node.queued || node.flushing) return;
    node.queued = false;
    this.queuedCount--;
    node.flush();
  }

  queueFlush(node: AtomNode): void {
    if (node.queued) return;
    node.queued = true;
    this.queuedCount++;
    this.heapPush(node);
    if (this.isBatchScheduled) return;

    this.isBatchScheduled = true;
    queueMicrotask(() => {
      if (!this.isFlushing) this.flush();
    });
  }

  remove(node: AtomNode): void {
    if (!node.queued) return;
    node.queued = false;
    this.queuedCount = Math.max(0, this.queuedCount - 1);
  }

  get isDirty(): boolean { return this.queuedCount > 0; }
}

let currentScheduler: Scheduler = new DefaultScheduler();

export function setScheduler(scheduler: Scheduler): void { currentScheduler = scheduler; }
export function getScheduler(): Scheduler { return currentScheduler; }

/* ─────────────────────────────────────────────────────────────────────────────
 * Transactions
 * ───────────────────────────────────────────────────────────────────────────*/

let transactionDepth = 0;
const transactionFinalizers = new Set<() => void>();

function isTransactionActive(): boolean {
  return transactionDepth > 0;
}

function finalizeAfterTransaction(callback: () => void): void {
  transactionFinalizers.add(callback);
}

/**
 * Groups synchronous atom writes into one reactive state transition.
 *
 * Writes are visible synchronously through `.value`, but subscriber delivery and
 * dependent recomputation are deferred until the outermost transaction commits.
 * Nested transactions join the outer transaction. Errors do not roll state back:
 * queued changes are committed before the original error is rethrown.
 *
 * Async callbacks are intentionally unsupported. Resolve async work first, then
 * apply its result inside a synchronous transaction.
 */
export function transaction<T>(fn: () => T extends PromiseLike<any> ? never : T): T {
  transactionDepth++;

  try {
    const result = fn() as T;
    if (isPromiseLike(result)) {
      throw new TypeError("transaction() callback must be synchronous");
    }
    return result;
  } finally {
    transactionDepth--;

    if (transactionDepth === 0) {
      // Reset per-atom transaction flags before flushing. Subscriber callbacks
      // invoked during the commit flush may write atoms or trigger derived
      // recomputations; with the flags still set, those writes would skip
      // `previous` updates and derived commits would defer to notifyPending
      // without a queued flush, dropping the emission entirely.
      const finalizers = Array.from(transactionFinalizers);
      transactionFinalizers.clear();
      for (const finalize of finalizers) finalize();

      currentScheduler.flush();
    }
  }
}


/* ─────────────────────────────────────────────────────────────────────────────
 * Dependency Tracking
 * ───────────────────────────────────────────────────────────────────────────*/

interface FormulaContext {
  dependencies: Set<DependencySource<any>>;
}

const activeFormulaStack: FormulaContext[] = [];

function pushFormulaContext(context?: FormulaContext): FormulaContext {
  const ctx: FormulaContext = context ?? { dependencies: new Set<Atom<any>>() };
  activeFormulaStack.push(ctx);
  return ctx;
}

function popFormulaContext(): void {
  activeFormulaStack.pop();
}

export function getCurrentFormulaContext(): FormulaContext | null {
  return activeFormulaStack.length > 0 ? activeFormulaStack[activeFormulaStack.length - 1] : null;
}

/**
 * Runs the provided function inside a fresh formula context and returns both its
 * result and the set of atoms that were read. Useful for reactive renderers that
 * need to discover dependencies without manually walking every proxy layer.
 */
export function trackDependencies<T>(fn: () => T): { result: T; dependencies: Set<DependencySource<any>> } {
  const context = pushFormulaContext();
  try {
    return { result: fn(), dependencies: context.dependencies };
  } finally {
    popFormulaContext();
  }
}


/**
 * Owns a single derived evaluation. Reads made through this owner are recorded
 * as dependencies, and atom proxies created via the owner delegate `.value`
 * reads to `owner.read()`.
 */
class EvaluationOwner {
  private ctx: FormulaContext | null = null;
  private generation = 0;
  private atomViews = new WeakMap<Atom<any>, Atom<any>>();

  /** Read an atom and record it as a dependency of the active evaluation. */
  read<A>(atom: DependencySource<A>): A {
    if (this.ctx) {
      this.ctx.dependencies.add(atom);
    }
    return atom.value;
  }

  /** Register closure or global-scope atoms and return them for destructuring. */
  use<T extends DependencySource<any>[]>(...atoms: T): T extends [infer U] ? U : T {
    atoms.forEach(a => this.read(a));
    // Return single atom if only one, otherwise return array
    return (atoms.length === 1 ? atoms[0] : atoms) as any;
  }

  /** Return a cached atom facade that tracks `.value` reads without a Proxy. */
  wrapAtom<A>(atom: Atom<A>): Atom<A> {
    let view = this.atomViews.get(atom) as Atom<A> | undefined;
    if (!view) {
      view = createTrackedAtomView(this, atom);
      this.atomViews.set(atom, view);
    }
    return view;
  }

  /** Begin a new evaluation generation and return its context. */
  enter(): { context: FormulaContext; generation: number } {
    this.generation++;
    const context: FormulaContext = { dependencies: new Set<Atom<any>>() };
    this.ctx = context;
    return { context, generation: this.generation };
  }

  /** True if the given context/generation is still the active evaluation. */
  isCurrent(context: FormulaContext, generation: number): boolean {
    return this.ctx === context && this.generation === generation;
  }

  /**
   * End an evaluation and return its collected dependencies, or `null` if a
   * newer evaluation has already superseded it.
   */
  leave(context: FormulaContext, generation: number): Set<DependencySource<any>> | null {
    if (!this.isCurrent(context, generation)) return null;
    this.ctx = null;
    return context.dependencies;
  }
}

/**
 * The callable API surface of a derived scope. Kept as a real class so methods
 * are normal functions and the scope remains debuggable.
 */
class DerivedScopeFacade {
  constructor(private owner: EvaluationOwner) {}

  read<A>(atom: DependencySource<A>): A {
    return this.owner.read(atom);
  }

  use<T extends DependencySource<any>[]>(...atoms: T): T extends [infer U] ? U : T {
    return this.owner.use(...atoms);
  }

  invoke<T extends DependencySource<any>>(first: T, ...rest: DependencySource<any>[]): AtomValue<T> | AtomValue<DependencySource<any>>[] {
    if (rest.length === 0) {
      return this.owner.read(first) as AtomValue<T>;
    }
    return [first, ...rest].map(a => this.owner.read(a)) as AtomValue<DependencySource<any>>[];
  }
}

/**
 * Creates a derived scope proxy over the provided computable instance. Atom
 * properties are lazily wrapped so that `.value` reads register dependencies
 * with the owner. The returned scope is also callable: `$(atom)` reads and
 * tracks the atom.
 */
function createSelf(instance: ComputableInstance, owner: EvaluationOwner): DerivedScope {
  const facade = new DerivedScopeFacade(owner);
  const callable = facade.invoke.bind(facade);

  return new Proxy(callable, {
    get(_target, prop, receiver) {
      if (prop === "read" || prop === "use") {
        const value = Reflect.get(facade, prop, receiver);
        if (typeof value === "function") {
          return value.bind(facade);
        }
        return value;
      }
      const instanceValue = Reflect.get(instance as object, prop, receiver);
      if (isAtom(instanceValue)) {
        return owner.wrapAtom(instanceValue);
      }
      return instanceValue;
    }
  }) as DerivedScope;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Shared Internals
 * ───────────────────────────────────────────────────────────────────────────*/

function createAtomRuntimeMeta(): AtomRuntimeMeta {
  return {
    changeHandlers: new Set(),
    dirtyHandlers: new Set(),
    emitHandlers: new Set(),
    disposeHandlers: new Set(),
  };
}

function getAtomRuntimeMeta(atom: Atom<any>): AtomRuntimeMeta {
  return (atom as unknown as InternalAtomContainer)[META];
}

function tryGetAtomRuntimeMeta(atom: unknown): AtomRuntimeMeta | null {
  if (atom === null || (typeof atom !== "object" && typeof atom !== "function")) {
    return null;
  }

  return (atom as InternalAtomContainer)[META] ?? null;
}

export function asReadable<A>(atom: Atom<A>): Readable<A> {
  const meta = getAtomRuntimeMeta(atom);
  const existing = meta.readableView as Readable<A> | undefined;
  if (existing) return existing;

  const view: Readable<A> = {
    get type() { return atom.type; },
    get name() { return atom.name; },
    get value() { return atom.value; },
    get safeValue() { return atom.safeValue; },
    get previous() { return atom.previous; },
    get disposed() { return atom.disposed; },
    get dirty() { return atom.dirty; },
    get error() { return atom.error; },
    get subscriberCount() { return atom.subscriberCount; },
    subscribe: atom.subscribe.bind(atom),
    onError: atom.onError.bind(atom),
    [Symbol.asyncIterator]: atom[Symbol.asyncIterator].bind(atom),
  };

  meta.readableView = view;
  return view;
}

function createTrackedAtomView<A>(owner: EvaluationOwner, atom: Atom<A>): Atom<A> {
  const view = {} as Record<PropertyKey, unknown>;

  for (const key of Object.getOwnPropertyNames(atom)) {
    const descriptor = Object.getOwnPropertyDescriptor(atom, key);
    if (!descriptor) continue;

    if (key === "value") {
      Object.defineProperty(view, key, {
        get: () => owner.read(atom),
        enumerable: descriptor.enumerable ?? true,
        configurable: true,
      });
      continue;
    }

    if (typeof descriptor.value === "function") {
      Object.defineProperty(view, key, {
        value: descriptor.value.bind(atom),
        enumerable: descriptor.enumerable ?? true,
        configurable: true,
        writable: false,
      });
      continue;
    }

    Object.defineProperty(view, key, {
      get: descriptor.get ? () => Reflect.get(atom as object, key, atom) : () => Reflect.get(atom as object, key, atom),
      set: descriptor.set ? (value) => Reflect.set(atom as object, key, value, atom) : undefined,
      enumerable: descriptor.enumerable ?? true,
      configurable: true,
    });
  }

  Object.defineProperty(view, Symbol.asyncIterator, {
    value: atom[Symbol.asyncIterator].bind(atom),
    enumerable: false,
    configurable: true,
  });

  return view as unknown as Atom<A>;
}

function finalizeAtomInstance<T extends Atom<any> & InternalAtomContainer>(instance: T, conflate: boolean): T {
  Object.defineProperty(instance, "_onDispose", {
    get: () => instance[META].disposeHandlers,
    enumerable: false,
  });
  if (conflate) (instance as any)[ANALOG_DELIVERY] = true;
  registerWithCurrentScope(instance as any);
  return instance;
}

export function normalizeError(err: any): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Subscriber Set
 * ───────────────────────────────────────────────────────────────────────────*/

/**
 * Creates a subscriber set for an atom.
 *
 * @param conflate - If true, values emitted while a subscriber callback is still
 *   running are coalesced: only the latest pending value is delivered once the
 *   callback finishes. This is used by latest-value sequence delivery. If false, every emitted value
 *   is still delivered sequentially (callbacks are never re-entered), but no
 *   intermediate values are dropped.
 */
function createSubscriberSet<T>(errorHandlers: Set<(error: any) => void>, conflate: boolean) {
  type Callback = (current: T, previous: T) => MaybePromise;

  type Subscriber = {
    callback: Callback;
    busy: boolean;
    pending: Array<{ current: T; previous: T }>;
  };

  const subs = new Map<Callback, Subscriber>();

  const finish = (sub: Subscriber): void => {
    if (!subs.has(sub.callback)) return;
    sub.busy = false;
    const queued = sub.pending.shift();
    if (queued !== undefined) invoke(sub, queued);
  };

  const invoke = (sub: Subscriber, initial: { current: T; previous: T }): void => {
    sub.busy = true;
    let queued = initial;

    while (queued !== undefined) {
      if (!subs.has(sub.callback)) {
        sub.busy = false;
        sub.pending.length = 0;
        return;
      }

      const { current, previous } = queued;
      queued = undefined;

      try {
        const result = sub.callback(current, previous);
        if (isPromiseLike(result)) {
          // Async callback: delivery resumes from finish() once the promise
          // settles, so values emitted meanwhile queue up in `pending`.
          Promise.resolve(result).then(
            () => finish(sub),
            err => {
              const e = normalizeError(err);
              for (const h of Array.from(errorHandlers)) try { h(e); } catch {}
              finish(sub);
            }
          );
          return;
        }
      } catch (err) {
        const e = normalizeError(err);
        for (const h of Array.from(errorHandlers)) try { h(e); } catch {}
      }

      // Drain synchronously emitted follow-up values iteratively so feedback
      // loops (a subscriber writing the same atom) cannot grow the stack.
      queued = sub.pending.shift();
    }

    sub.busy = false;
  };

  return {
    get size() { return subs.size; },
    add(callback: Callback) {
      subs.set(callback, { callback, busy: false, pending: [] });
    },
    delete(callback: Callback) { subs.delete(callback); },
    clear() { subs.clear(); },
    has(callback: Callback) { return subs.has(callback); },
    broadcast(current: T, previous: T) {
      for (const sub of Array.from(subs.values())) {
        if (sub.busy) {
          if (conflate) sub.pending.length = 0;
          sub.pending.push({ current, previous });
        } else {
          invoke(sub, { current, previous });
        }
      }
    }
  };
}

function notifyChangeHandlers(atom: Atom<any>): void {
  const handlers = getAtomRuntimeMeta(atom).changeHandlers;
  for (const h of Array.from(handlers)) {
    try { h(); } catch { /* suppress dependent errors */ }
  }
}

export function onAtomDirtyChange(atom: Atom<any>, handler: (dirty: boolean) => void): () => void {
  const handlers = getAtomRuntimeMeta(atom).dirtyHandlers;
  handlers.add(handler);
  return () => handlers?.delete(handler);
}

function notifyDirtyHandlers(atom: Atom<any>, dirty: boolean): void {
  const handlers = getAtomRuntimeMeta(atom).dirtyHandlers;
  for (const h of Array.from(handlers)) {
    try { h(dirty); } catch { /* suppress dirty observers */ }
  }
}

export function onAtomEmit(atom: Atom<any>, handler: () => void): () => void {
  const meta = getAtomRuntimeMeta(atom);
  meta.startOnEmitObserve?.();
  const handlers = meta.emitHandlers;
  handlers.add(handler);
  return () => handlers.delete(handler);
}

function notifyEmitHandlers(atom: Atom<any>): void {
  const handlers = getAtomRuntimeMeta(atom).emitHandlers;
  for (const h of Array.from(handlers)) {
    try { h(); } catch { /* suppress emit observers */ }
  }
}

function observeDependencyChange(dep: DependencySource<any>, handler: () => void): Subscription {
  const meta = tryGetAtomRuntimeMeta(dep);
  if (meta) {
    meta.changeHandlers.add(handler);
    return createSubscription(() => {
      meta.changeHandlers.delete(handler);
    });
  }

  if (typeof dep.subscribe === "function") {
    const unsubscribe = dep.subscribe(() => handler());
    return createSubscription(() => {
      try {
        return unsubscribe();
      } catch {
        return undefined;
      }
    });
  }

  return createSubscription(() => {});
}

type AtomSubscriber<T> = (current: T, previous: T) => MaybePromise;

interface AtomBaseConfig<T> {
  conflate: boolean;
  maxSubscribers: number;
  node: AtomNode;
  getDisposed: () => boolean;
  getDirty: () => boolean;
  getError: () => any;
  getValue: (instance: Atom<T> & InternalAtomContainer) => T;
  getSafeValue?: (instance: Atom<T> & InternalAtomContainer) => T;
  getPrevious: (instance: Atom<T> & InternalAtomContainer) => T;
  markDirty: (instance: Atom<T> & InternalAtomContainer) => void;
  beforeSubscribe?: (instance: Atom<T> & InternalAtomContainer) => void;
  onSubscribed?: (
    callback: AtomSubscriber<T> | undefined,
    unsubscribe: Subscription,
    instance: Atom<T> & InternalAtomContainer,
  ) => void;
  onUnsubscribe?: (
    callback: AtomSubscriber<T> | undefined,
    unsubscribe: Subscription,
    instance: Atom<T> & InternalAtomContainer,
  ) => MaybePromise<void>;
  onDispose: (instance: Atom<T> & InternalAtomContainer) => MaybePromise<void>;
}

interface AtomBaseResult<T> {
  instance: Atom<T> & InternalAtomContainer;
  meta: AtomRuntimeMeta;
  errorHandlers: Set<(error: any) => void>;
  subs: ReturnType<typeof createSubscriberSet<T>>;
}

function createAtomBase<T>(config: AtomBaseConfig<T>): AtomBaseResult<T> {
  const meta = createAtomRuntimeMeta();
  const errorHandlers = new Set<(error: any) => void>();
  const subs = createSubscriberSet<T>(errorHandlers, config.conflate);

  const instance: Atom<T> & InternalAtomContainer = {
    type: "atom",
    [META]: meta,

    get disposed() { return config.getDisposed(); },
    get dirty() { return config.getDirty(); },
    get error() { return config.getError(); },
    get subscriberCount() { return subs.size; },

    get value() {
      const value = config.getValue(instance);
      const ctx = getCurrentFormulaContext();
      if (ctx) ctx.dependencies.add(instance);
      return value;
    },

    get safeValue() {
      if (config.getSafeValue) {
        return config.getSafeValue(instance);
      }
      try {
        return instance.value;
      } catch {
        return config.getPrevious(instance);
      }
    },

    get previous() {
      return config.getPrevious(instance);
    },

    [NODE]: config.node,
    [MARK_DIRTY]() { config.markDirty(instance); },
    [FLUSH]() { config.node.flush(); },

    subscribe(callback) {
      config.beforeSubscribe?.(instance);
      if (config.getDisposed()) return createSubscription(() => {});
      if (subs.size >= config.maxSubscribers) {
        throw new Error(`Maximum subscriber limit (${config.maxSubscribers}) reached`);
      }
      if (callback) subs.add(callback);

      const unsubscribe = createSubscription(async () => {
        if (callback) subs.delete(callback);
        await config.onUnsubscribe?.(callback, unsubscribe, instance);
      });
      config.onSubscribed?.(callback, unsubscribe, instance);
      return unsubscribe;
    },

    onError(handler: (error: any) => void): Subscription {
      if (config.getDisposed()) return createSubscription(() => {});
      errorHandlers.add(handler);
      const error = config.getError();
      if (error !== undefined) try { handler(error); } catch {}
      return createSubscription(() => { errorHandlers.delete(handler); });
    },

    [Symbol.asyncIterator]() { return iterate(this); },
    dispose() { void config.onDispose(instance); },
  };

  return {
    instance: finalizeAtomInstance(instance, config.conflate),
    meta,
    errorHandlers,
    subs,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * atomFromIterator() - Atom runtime over an async iterable
 * ───────────────────────────────────────────────────────────────────────────*/

export interface AtomFromIteratorOptions<T> extends AtomOptions {
  /** Value exposed before the source async iterable emits for the first time. */
  initialValue?: T;
}

/**
 * Creates a readable atom backed by an async iterable.
 *
 * The source starts when the first subscriber attaches and is closed when the
 * atom is disposed. Values yielded by the iterable become atom emissions.
 */
function atomFromIteratorInternal<T>(
  source: AsyncIterable<T>,
  options: AtomFromIteratorOptions<T> | undefined,
  conflate: boolean,
): Atom<T> {
  const maxSubscribers = options?.maxSubscribers ?? 1000;

  let current: T = options?.initialValue !== undefined ? options.initialValue : undefined as T;
  let previous: T = current;
  let disposed = false;
  let started = false;
  let activeSubCount = 0;
  let errorValue: any = undefined;
  let isErrorState = false;
  let hasNewValue = false;
  let dirty = false;

  let instance!: Atom<T> & InternalAtomContainer & { fail(err: any, options?: { terminate?: boolean }): void };
  const subscriptions = new Set<Subscription>();
  let iterator: AsyncIterator<T> | undefined;
  let runPromise: Promise<void> | null = null;

  const setDirty = (next: boolean) => {
    if (dirty === next) return;
    dirty = next;
    notifyDirtyHandlers(instance, next);
  };

  const cleanupRuntime = () => {
    instance[META].changeHandlers.clear();
    instance[META].dirtyHandlers.clear();
    instance[META].emitHandlers.clear();
  };

  const broadcast = (val: T) => subs.broadcast(val, previous);

  const broadcastLatest = () => {
    if (!hasNewValue) return;
    hasNewValue = false;
    broadcast(current);
  };

  const stopIterator = async () => {
    if (iterator && typeof (iterator as any).return === "function") {
      try { await (iterator as any).return(); } catch {}
    }
    iterator = undefined;
  };

  const disposeInstance = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    setDirty(false);
    node.version++;
    subs.clear();
    activeSubCount = 0;

    await stopIterator();

    for (const handler of instance[META].disposeHandlers) await Promise.resolve(handler()).catch(() => {});
    instance[META].disposeHandlers.clear();

    for (const sub of subscriptions) await sub().catch(() => {});
    subscriptions.clear();

    getScheduler().remove(node);
    cleanupRuntime();
  };

  const run = async () => {
    if (runPromise) return runPromise;
    runPromise = (async () => {
      iterator = source[Symbol.asyncIterator]();
      try {
        while (!disposed) {
          const result = await iterator.next();
          if (disposed || result.done) break;

          previous = current;
          current = result.value;
          hasNewValue = true;
          isErrorState = false;
          errorValue = undefined;
          markAtomAsEmitted(instance as any);
          notifyEmitHandlers(instance as any);
          notifyChangeHandlers(instance);

          if (conflate) {
            if (subs.size > 0) instance[MARK_DIRTY]();
          } else {
            broadcast(current);
          }
        }
        if (!disposed) await disposeInstance();
      } catch (err) {
        if (!disposed) {
          errorValue = normalizeError(err);
          isErrorState = true;
          instance.fail(errorValue, { terminate: options?.terminateOnError });
        }
      } finally {
        await stopIterator();
        runPromise = null;
      }
    })();
    return runPromise;
  };

  const node: AtomNode = {
    depth: 0, version: 0, queued: false, flushing: false,
    isResource: true, conflate,
    flush() {
      if (disposed || (!dirty && !hasNewValue) || node.flushing) return;
      node.flushing = true;
      try {
        setDirty(false);
        broadcastLatest();
      } finally {
        node.flushing = false;
      }
    },
  };

  const base = createAtomBase<T>({
    conflate,
    maxSubscribers,
    node,
    getDisposed: () => disposed,
    getDirty: () => dirty,
    getError: () => errorValue,
    getValue: () => {
      if (disposed) throw new Error("Atom has been disposed");
      if (isErrorState && errorValue) throw errorValue;
      return current;
    },
    getSafeValue: () => current,
    getPrevious: () => previous,
    markDirty: () => {
      if (disposed || dirty) return;
      setDirty(true);
      getScheduler().queueFlush(node);
    },
    onSubscribed: (_callback, unsubscribe) => {
      if (!started) {
        started = true;
        run().catch(() => {});
      }
      subscriptions.add(unsubscribe);
      activeSubCount++;
    },
    onUnsubscribe: async (_callback, unsubscribe) => {
      subscriptions.delete(unsubscribe);
      if (--activeSubCount <= 0) await disposeInstance();
    },
    onDispose: () => disposeInstance(),
  });

  const { instance: baseInstance, errorHandlers, subs } = base;
  instance = baseInstance as typeof instance;
  instance[META].startOnEmitObserve = () => {
    if (!started) {
      started = true;
      run().catch(() => {});
    }
  };
  if (instance[META].emitHandlers.size > 0) {
    instance[META].startOnEmitObserve();
  }

  Object.assign(instance, {
    fail(err: any, errorOptions?: { terminate?: boolean }) {
      if (disposed) return;
      errorValue = normalizeError(err);
      isErrorState = true;
      for (const h of errorHandlers) try { h(errorValue); } catch {}
      if (options?.onError) try { options.onError(errorValue); } catch {}

      if (errorOptions?.terminate ?? false) {
        void disposeInstance();
      }
    }
  });

  return instance;
}

/**
 * Creates a readable atom backed by an async iterable. Atom state itself has no
 * analog/discrete delivery mode; every source value is observable.
 */
export function atomFromIterator<T>(
  source: AsyncIterable<T>,
  options?: AtomFromIteratorOptions<T>,
): Atom<T> {
  return atomFromIteratorInternal(source, options, false);
}

function watchDependencies(
  deps: Iterable<DependencySource<any>>,
  callback: (dep: DependencySource<any>) => void
): () => void {
  const subscriptions = new Map<DependencySource<any>, Subscription>();
  for (const dep of deps) {
    const handler = () => {
      cleanup();
      callback(dep);
    };
    subscriptions.set(dep, observeDependencyChange(dep, handler));
  }
  function cleanup() {
    for (const unsubscribe of subscriptions.values()) {
      unsubscribe();
    }
    subscriptions.clear();
  }
  return cleanup;
}

function createLatestAsyncCoordinator<T>() {
  let generation = 0;
  let coordinator: AsyncCoordinator<T> | undefined;
  const sourceGeneration = new Map<number, number>();

  return {
    addLatestSource(source: AsyncIterator<T>): number {
      generation++;
      if (!coordinator) {
        coordinator = createAsyncCoordinator<T>([source], { syncDrain: true });
        sourceGeneration.set(0, generation);
      } else {
        const index = coordinator.addSource(source);
        sourceGeneration.set(index, generation);
      }
      return generation;
    },

    async next() {
      if (!coordinator) return DONE;

      while (true) {
        const result = await coordinator.next();
        if (result.done) return DONE;
        if (sourceGeneration.get(result.value.sourceIndex) !== generation) {
          continue;
        }
        return result;
      }
    },

    async return() {
      sourceGeneration.clear();
      await coordinator?.return?.();
      coordinator = undefined;
    }
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * flow() - Async Resource Node
 * ───────────────────────────────────────────────────────────────────────────*/

export interface FlowOptions extends AtomOptions {
  /** Sequence delivery mode. `discrete` preserves every emission; `analog` keeps the latest pending value. */
  mode?: "discrete" | "analog";
}

export function flow<T>(
  source: AsyncIterable<T> | Iterable<T> | ((signal: AbortSignal) => AsyncIterable<T> | Iterable<T>),
  options?: FlowOptions
): Atom<T> {
  const { mode = "discrete", ...atomOptions } = options ?? {};
  let initialValue: T | undefined;
  let hasInitialValue = false;

  if (isAtom(source)) {
    try {
      initialValue = (source as any).safeValue;
      hasInitialValue = true;
    } catch {}
  }

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      let controller: AbortController | undefined;
      const latest = createLatestAsyncCoordinator<T>();
      let stopped = false;

      const makeSource = (): AsyncIterator<T> => {
        const localController = new AbortController();
        controller = localController;
        const signal = localController.signal;

        let cleanupDeps: (() => void) | undefined;

        async function* run() {
          const context = pushFormulaContext();
          let produced: AsyncIterable<T> | Iterable<T>;

          try {
            produced = typeof source === "function"
              ? source(signal)
              : source;
          } finally {
            popFormulaContext();
          }

          cleanupDeps = watchDependencies(context.dependencies, () => {
            if (stopped) return;

            controller?.abort();
            latest.addLatestSource(makeSource());
          });

          signal.addEventListener("abort", () => cleanupDeps?.(), { once: true });

          const iterator = getIterator(produced);

          try {
            while (!signal.aborted) {
              const result = await raceNext(iterator, signal);
              if (signal.aborted || result.done) break;
              yield result.value;
            }
          } finally {
            cleanupDeps?.();
            await (iterator as any).return?.().catch?.(() => {});
          }
        }

        return run()[Symbol.asyncIterator]();
      };

      latest.addLatestSource(makeSource());

      const iterator: AsyncIterator<T> = {
        async next() {
          while (!stopped) {
            const event = await latest.next();
            if (event.done) return DONE;

            const item = event.value;

            if (item.type === "value") {
              return NEXT(item.value);
            }

            if (item.type === "error") {
              throw item.error;
            }

            if (item.type === "complete") {
              return DONE;
            }
          }

          return DONE;
        },

        async return() {
          stopped = true;
          controller?.abort();
          await latest.return();
          return DONE;
        }
      };

      return iterator;
    }
  };

  return atomFromIteratorInternal(
    iterable,
    hasInitialValue ? { ...atomOptions, initialValue } : atomOptions,
    mode === "analog",
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * atom() - Mutable State Node
 * ───────────────────────────────────────────────────────────────────────────*/

/**
 * Creates a writable atom without an initial value.
 *
 * The value type should usually be provided explicitly:
 *
 * ```ts
 * const user = atom<User>();
 * ```
 */
export function atom<T = any>(): Writable<T>;
/**
 * Creates a writable atom that intentionally starts without an initial value.
 */
export function atom<T = any>(noInitialValue: typeof NO_INITIAL_VALUE, options?: AtomOptions): Writable<T>;
/**
 * Creates a writable atom with an initial value.
 *
 * ```ts
 * const count = atom(0);
 * count.set(count.value + 1);
 * ```
 */
export function atom<T = any>(initialValue: T, options?: AtomOptions): Writable<T>;
export function atom<T = any>(
  initialValue?: T | typeof NO_INITIAL_VALUE,
  options?: AtomOptions
): Writable<T> {
  const resolvedOptions = options;

  const maxSubscribers = resolvedOptions?.maxSubscribers ?? 1000;
  const terminateOnError = resolvedOptions?.terminateOnError ?? false;
  const propagateErrors = resolvedOptions?.propagateErrors ?? true;

  const hasInitialValue = arguments.length > 0 && initialValue !== NO_INITIAL_VALUE;
  let current: T;
  let previous: T;
  if (hasInitialValue) {
    current = initialValue as T;
    previous = initialValue as T;
  } else {
    current = undefined as T;
    previous = undefined as T;
  }
  let disposed = false;
  let lastNotified = current;
  let errorValue: any = undefined;
  let isErrorState = false;
  let dirty = false;
  let transactionTouched = false;

  let instance!: Writable<T> & InternalAtomContainer;
  const subscriptions = new Set<Subscription>();

  const broadcast = () => subs.broadcast(current, previous);

  const setDirty = (next: boolean): void => {
    if (dirty === next) return;
    dirty = next;
    notifyDirtyHandlers(instance, next);
  };

  const cleanupRuntime = () => {
    instance[META].changeHandlers.clear();
    instance[META].dirtyHandlers.clear();
    instance[META].emitHandlers.clear();
  };

  const flushInternal = () => {
    if (disposed) return;
    if (Object.is(lastNotified, current)) return;
    
    lastNotified = current;
    node.version++;
    broadcast();
  };

  const node: AtomNode = {
    depth: 0, version: 0, queued: false, flushing: false,
    isResource: false, conflate: false,
    flush() {
      if (disposed || node.flushing) return;
      
      node.flushing = true;
      try {
        // Clear before broadcasting so a write from a subscriber can queue a
        // subsequent transactional flush.
        setDirty(false);
        flushInternal();
      } finally {
        node.flushing = false;
      }
    },
  };

  const base = createAtomBase<T>({
    conflate: false,
    maxSubscribers,
    node,
    getDisposed: () => disposed,
    getDirty: () => dirty,
    getError: () => errorValue,
    getValue: () => {
      if (disposed) throw new Error("Atom has been disposed");
      if (isErrorState && errorValue) throw errorValue;
      return current;
    },
    getSafeValue: () => current,
    getPrevious: () => previous,
    markDirty: () => {
      if (disposed || node.queued) return;
      if (isTransactionActive()) setDirty(true);
      getScheduler().queueFlush(node);
    },
    onSubscribed: (_callback, unsubscribe) => {
      subscriptions.add(unsubscribe);
    },
    onUnsubscribe: (_callback, unsubscribe) => {
      subscriptions.delete(unsubscribe);
    },
    onDispose: () => {
      if (disposed) return;
      disposed = true;
      setDirty(false);
      getScheduler().remove(node);
      for (const h of instance[META].disposeHandlers) Promise.resolve(h()).catch(() => {});
      instance[META].disposeHandlers.clear();
      for (const s of subscriptions) s();
      subscriptions.clear();
      subs.clear();
      errorHandlers.clear();
      cleanupRuntime();
    },
  });

  const { instance: baseInstance, errorHandlers, subs } = base;
  instance = baseInstance as Writable<T> & InternalAtomContainer;

  Object.assign(instance, {
    next(value: T) {
      if (disposed) return;
      if (isErrorState) { isErrorState = false; errorValue = undefined; }

      if (isTransactionActive()) {
        if (!transactionTouched) {
          previous = current;
          transactionTouched = true;
          finalizeAfterTransaction(() => { transactionTouched = false; });
        }
      } else if (!transactionTouched) {
        previous = current;
      }
      current = value;
      markAtomAsEmitted(instance as any);
      notifyEmitHandlers(instance as any);

      // Dependents are notified immediately. During a transaction they queue
      // their recomputation; otherwise derived state updates synchronously.
      notifyChangeHandlers(instance);

      if (isTransactionActive()) {
        if (subs.size > 0) instance[MARK_DIRTY]();
      } else {
        lastNotified = current;
        node.version++;
        broadcast();
      }
    },
    set(value: T) { this.next(value); },
    fail(err: any, errorOptions?: { terminate?: boolean }) {
      if (disposed) return;
      errorValue = normalizeError(err);
      isErrorState = true;

      const shouldTerminate = errorOptions?.terminate ?? terminateOnError;
      for (const h of errorHandlers) try { h(errorValue); } catch {}
      if (resolvedOptions?.onError) try { resolvedOptions.onError(errorValue); } catch {}

      if (shouldTerminate) {
        setDirty(false);
        disposed = true;
        getScheduler().remove(node);
        
        for (const h of instance[META].disposeHandlers) Promise.resolve(h()).catch(() => {});
        instance[META].disposeHandlers.clear();
        for (const s of subscriptions) s();
        subscriptions.clear();
        subs.clear();
        errorHandlers.clear();
        cleanupRuntime();
      } else if (propagateErrors) {
        instance[MARK_DIRTY]();
      }
    },
    recover() {
      if (disposed || !isErrorState) return;
      isErrorState = false;
      errorValue = undefined;
      instance[MARK_DIRTY]();
    },
    clearError() { this.recover?.(); },
  });
  if (hasInitialValue) {
    markAtomAsEmitted(instance as any);
    notifyEmitHandlers(instance as any);
  }
  return instance;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Computable helpers - manufactured class around callback
 * ───────────────────────────────────────────────────────────────────────────*/

type AnyFn = (...args: any[]) => any;

interface ComputableInstance {
  compute(self?: DerivedScope): unknown;
  onInit?(self?: DerivedScope): void;
  onDispose?(): void;
}

function isGeneratorFunction(fn: AnyFn): boolean {
  return fn.constructor?.name === "GeneratorFunction";
}

function bindComputableMembers(target: Record<string, unknown>, fn: AnyFn): void {
  const excluded = new Set([
    "length",
    "name",
    "prototype",
    "arguments",
    "caller",
    "compute",
    "onConstruct",
    "onInit",
    "onDispose",
  ]);

  for (const source of [fn, fn.prototype]) {
    if (!source) continue;
    for (const name of Object.getOwnPropertyNames(source)) {
      if (name === "constructor" || excluded.has(name) || name in target) continue;
      const value = (source as any)[name];
      target[name] = typeof value === "function" ? value.bind(target) : value;
    }
  }
}

function runGenerator(gen: Generator<unknown, unknown, unknown>, self: DerivedScope): unknown {
  const step = (value?: unknown): unknown => {
    const result = value === undefined ? gen.next() : gen.next(value);

    if (result.done) return result.value;

    const yielded = result.value;

    if (isPromiseLike(yielded)) {
      return Promise.resolve(yielded).then(step);
    }

    if (isAtom(yielded)) {
      return step(self.read(yielded));
    }

    return step(yielded);
  };

  return step();
}

function createFunctionComputable(fn: AnyFn): ComputableInstance {
  const state = Object.create(fn.prototype ?? Object.prototype) as ComputableInstance & Record<string, unknown>;
  const bound = fn.bind(state);

  bindComputableMembers(state, fn);

  const onConstruct = (fn as any).onConstruct;
  const onInit = (fn as any).onInit;
  const onDispose = (fn as any).onDispose;

  if (typeof onConstruct === "function") {
    onConstruct.call(state);
  }

  state.compute = (self?: DerivedScope) => {
    const result = bound(self);
    return isGeneratorFunction(fn)
      ? runGenerator(result as Generator<unknown, unknown, unknown>, self as DerivedScope)
      : result;
  };

  state.onInit = (self?: DerivedScope) => {
    if (typeof onInit === "function") {
      onInit.call(state, self);
    }
  };

  state.onDispose = () => {
    if (typeof onDispose === "function") {
      onDispose.call(state);
    }
  };

  return state;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * derived() - Computed Node
 * ───────────────────────────────────────────────────────────────────────────*/

export type SyncOnly<T> = T extends PromiseLike<any> ? never : Awaited<T>;

/**
 * Creates a readonly atom computed from other atoms.
 *
 * Dependencies are tracked when the callback reads atoms through `self.read`,
 * `self.use`, or the callable shorthand `self(atom)`.
 *
 * `derived()` is intentionally synchronous. If the computation needs `await`,
 * cancellation, or restart semantics, model it as a `flow()` instead.
 */
export function derived<T>(fn: (self: DerivedScope) => SyncOnly<T>, options?: AtomOptions): Atom<T>;
/**
 * Creates a readonly atom from a generator-based computation.
 *
 * The generator may yield atoms or promises before returning the computed value.
 */
export function derived<T>(fn: (self: DerivedScope) => Generator<Atom<any> | Promise<any>, T, any>, options?: AtomOptions): Atom<T>;
export function derived<T>(...args: any[]): Atom<T> {
  let computableFactory: () => ComputableInstance;
  let options: AtomOptions | undefined;

  const first = args[0];
  const second = args[1];

  // Handle the supported overloads:
  // 1. derived((self) => T, options?)
  if (typeof first === "function") {
    // Check if it's a class with compute method (for ComputableInstance)
    if (first.prototype && typeof first.prototype.compute === "function") {
      const Class = first as new () => ComputableInstance;
      computableFactory = () => new Class();
    } else {
      // Regular function
      computableFactory = () => createFunctionComputable(first);
    }
    options = second as AtomOptions | undefined;
  } else {
    throw new Error("derived() requires a function as the first argument");
  }

  const computable = computableFactory();
  const owner = new EvaluationOwner();
  const self = createSelf(computable, owner);

  if (typeof computable.onInit === "function") {
    computable.onInit(self);
  }

  const maxSubscribers = options?.maxSubscribers ?? 1000;
  const terminateOnError = options?.terminateOnError ?? false;

  let current!: T;
  let previous!: T;
  let disposed = false;
  let initialized = false;
  let running = false;
  let errorValue: any = undefined;
  let isErrorState = false;
  let notifyPending = false;
  let dirty = false;
  let transactionTouched = false;

  let instance!: Atom<T> & InternalAtomContainer;
  const dependencies = new Set<DependencySource<any>>();
  const depSubscriptions = new Map<DependencySource<any>, Subscription>();

  const setDirty = (next: boolean) => {
    if (dirty === next) return;
    dirty = next;
    notifyDirtyHandlers(instance, next);
  };

  const cleanupRuntime = () => {
    instance[META].changeHandlers.clear();
    instance[META].dirtyHandlers.clear();
    instance[META].emitHandlers.clear();
  };

  const broadcast = () => subs.broadcast(current, previous);

  const commitValue = (next: T) => {
    if (Object.is(current, next)) return;

    if (isTransactionActive()) {
      if (!transactionTouched) {
        previous = current;
        transactionTouched = true;
        finalizeAfterTransaction(() => { transactionTouched = false; });
      }
    } else if (!transactionTouched) {
      previous = current;
    }
    current = next;
    node.version++;

    notifyChangeHandlers(instance);

    if (isTransactionActive() || transactionTouched) {
      notifyPending = true;
    } else if (subs.size > 0) {
      broadcast();
    }
  };

  const processDependencies = (context: FormulaContext) => {
    let maxDepth = -1;

    for (const dep of context.dependencies) {
      dependencies.add(dep);

      const depNode = (dep as Partial<InternalAtomContainer> as any)[NODE] as AtomNode | undefined;
      if (depNode !== undefined && depNode.depth > maxDepth) {
        maxDepth = depNode.depth;
      }

      if (depSubscriptions.has(dep)) continue;

      const handler = () => {
        if (disposed) return;

        if (!isTransactionActive()) {
          if (!node.flushing && !running) {
            try {
              recompute();
            } catch (err) {
              errorValue = normalizeError(err);
              isErrorState = true;
              if (terminateOnError) {
                instance.dispose();
              }
            }
          } else {
            instance[MARK_DIRTY]();
          }
          return;
        }

        instance[MARK_DIRTY]();
      };

      depSubscriptions.set(dep, observeDependencyChange(dep, handler));
    }

    node.depth = maxDepth + 1;
  };
  const compute = (): { result: T; context: FormulaContext; generation: number } => {
    if (running) throw new Error("Circular dependency detected in derived()");

    running = true;
    const { context, generation } = owner.enter();
    pushFormulaContext(context);

    try {
      const result = computable.compute(self);
      if (isPromiseLike(result)) {
        throw new Error("derived() formulas must return synchronously. Use flow() for async work.");
      }
      initialized = true;
      processDependencies(context);
      return { result: result as T, context, generation };
    } catch (err) {
      // Subscribe the dependencies observed before the failure so a later
      // change can trigger a recovery recompute instead of leaving the atom
      // stuck in its initial error state with no subscriptions at all.
      processDependencies(context);
      throw err;
    } finally {
      popFormulaContext();
      running = false;
      owner.leave(context, generation);
    }
  };

  const recompute = () => {
    const { result: next } = compute();
    setDirty(false);

    isErrorState = false;
    errorValue = undefined;

    commitValue(next);
  };

  const flushInternal = () => {
    if ((!dirty && !notifyPending) || disposed || node.flushing) return;
    node.flushing = true;
    try {
      if (dirty) recompute();
      if (notifyPending && subs.size > 0) {
        broadcast();
        notifyPending = false;
      }
    } catch (err) {
      errorValue = normalizeError(err);
      isErrorState = true;
      setDirty(false);
      notifyPending = false;
      if (terminateOnError) {
        instance.dispose();
      } else {
        // Report the error through the error channel instead of re-broadcasting
        // the stale last value, which would surface as a duplicate emission.
        for (const h of errorHandlers) try { h(errorValue); } catch {}
      }
    } finally {
      node.flushing = false;
    }
  };

  const node: AtomNode = {
    depth: 0, version: 0, queued: false, flushing: false,
    isResource: false, conflate: false,
    flush() {
      if (disposed || (!dirty && !notifyPending) || node.flushing) return;
      flushInternal();
    },
  };

  const base = createAtomBase<T>({
    conflate: false,
    maxSubscribers,
    node,
    getDisposed: () => disposed,
    getDirty: () => dirty,
    getError: () => errorValue,
    getValue: () => {
      if (disposed) throw new Error("Atom has been disposed");
      if (running) throw new Error("Circular dependency detected in derived()");

      if (!initialized) {
        try {
          const { result } = compute();
          current = result;
          previous = current;
          markAtomAsEmitted(instance as any);
          notifyEmitHandlers(instance as any);
        } catch (err) {
          initialized = true;
          errorValue = normalizeError(err);
          isErrorState = true;
          for (const h of errorHandlers) try { h(errorValue); } catch {}
          if (terminateOnError) {
            instance.dispose();
            throw errorValue;
          }
        }
      } else if (dirty) {
        try {
          recompute();
          if (notifyPending && subs.size > 0) instance[MARK_DIRTY]();
        } catch (err) {
          errorValue = normalizeError(err);
          isErrorState = true;
          for (const h of errorHandlers) try { h(errorValue); } catch {}
          if (terminateOnError) {
            instance.dispose();
            throw errorValue;
          }
        }
      }

      if (isErrorState && errorValue) throw errorValue;
      return current;
    },
    getSafeValue: () => {
      try {
        return instance.value;
      } catch {
        return current;
      }
    },
    getPrevious: () => {
      try { instance.value; } catch {}
      return previous;
    },
    markDirty: () => {
      if (disposed || dirty) return;
      setDirty(true);
      getScheduler().queueFlush(node);
    },
    beforeSubscribe: () => {
      try { instance.value; } catch {}
    },
    onDispose: () => {
      if (disposed) return;
      disposed = true;
      setDirty(false);
      getScheduler().remove(node);
      notifyPending = false;

      for (const sub of depSubscriptions.values()) sub();
      depSubscriptions.clear();
      dependencies.clear();
      subs.clear();
      errorHandlers.clear();
      for (const handler of instance[META].disposeHandlers) {
        Promise.resolve(handler()).catch(() => {});
      }
      instance[META].disposeHandlers.clear();
      cleanupRuntime();

      if (typeof computable.onDispose === "function") {
        computable.onDispose();
      }
    },
  });

  const { instance: baseInstance, errorHandlers, subs } = base;
  instance = baseInstance;

  return instance;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Test Harness
 * ───────────────────────────────────────────────────────────────────────────*/

export function createTestScheduler(): Scheduler { return new DefaultScheduler(); }

export function createTestEnvironment() {
  const scheduler = createTestScheduler();
  const originalScheduler = getScheduler();

  return {
    scheduler,
    run<T>(fn: () => T): T {
      setScheduler(scheduler);
      try { return fn(); } finally { setScheduler(originalScheduler); }
    },
    flush() { scheduler.flush(); },
    reset() { setScheduler(originalScheduler); }
  };
}