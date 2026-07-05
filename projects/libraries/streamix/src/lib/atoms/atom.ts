import { createAsyncCoordinator, getIterator, raceNext, type AsyncCoordinator } from "../utils/coordinator";
import { isAtom } from "../utils/helpers";
import { iterate } from "./iterate";
import { DONE, isPromiseLike, NEXT, type MaybePromise } from "./operator";

import {
  getCurrentScope,
  getScopeMode,
  markAtomAsEmitted,
  registerWithCurrentScope,
} from "./scope";
import { createSubscription, type Subscription } from "./subscription";

function promiseSource<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): AsyncIterator<T> {
  let done = false;

  return {
    async next() {
      if (done || signal.aborted) return DONE;

      try {
        const value = await promise;
        if (signal.aborted) return DONE;

        done = true;
        return NEXT(value);
      } catch (error) {
        if (signal.aborted) return DONE;
        throw error;
      }
    },

    async return() {
      done = true;
      return DONE;
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Architectural Symbols
 * ───────────────────────────────────────────────────────────────────────────*/

const NODE = Symbol("engine.node");
const MARK_DIRTY = Symbol("engine.markDirty");
const FLUSH = Symbol("engine.flush");

export const ANALOG = Symbol("engine.analog");
export const NO_INITIAL_VALUE = Symbol("streamix.noInitialValue");

export interface AtomOptions {
  discrete?: boolean;
  maxSubscribers?: number;
  onError?: (error: any) => void;
  terminateOnError?: boolean;
  propagateErrors?: boolean;
}

/** Public API Contract */
export interface Atom<T = any> {
  readonly type: "atom";
  readonly name?: string;
  readonly value: T;
  readonly safeValue: T;
  readonly previous: T;
  readonly disposed: boolean;
  readonly error?: any;
  readonly subscriberCount?: number;
  subscribe(callback?: (current: T, previous: T) => MaybePromise): Subscription;
  onError(handler: (error: any) => void): Subscription;
  dispose(): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
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
export type AtomValue<A> = A extends Atom<infer T> ? T : never;

export interface Writable<T = any> extends Atom<T> {
  next(value: T): void;
  set(value: T): void;
  fail(err: any, options?: { terminate?: boolean }): void;
  recover?(): void;
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
  <A>(atom: Atom<A>): A;
  <T extends Atom<any>[]>(...atoms: T): { [K in keyof T]: AtomValue<T[K]> };
  /** Read an atom and register it as a dependency of the current derived computation. */
  read<A>(atom: Atom<A>): A;
  /** Register closure or global-scope atoms and return them for destructuring. */
  use<T extends Atom<any>[]>(...atoms: T): T extends [infer U] ? U : T; // Changed this
} & Record<string, unknown>;

interface AtomNode {
  depth: number;
  version: number;
  dirty: boolean;
  isResource: boolean;
  isAnalog: boolean;
  flush: () => void;
  flushing?: boolean;
}

/** Engine Interface */
interface InternalAtomContainer {
  [NODE]: AtomNode;
  [MARK_DIRTY](): void;
  [FLUSH](): void;
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
  private dirtyNodes = new Set<AtomNode>();
  private flushingNodes = new Set<AtomNode>();

  // Min-heap of dirty nodes ordered by depth (shallow first).
  // A node may appear multiple times if it was re-dirtied; stale entries are
  // skipped via dirtyNodes membership and node.dirty checks.
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
    if (this.isFlushing) return;
    this.isFlushing = true;

    try {
      while (this.dirtyNodes.size > 0) {
        let node = this.heapPop();
        while (node !== undefined) {
          if (this.dirtyNodes.has(node) && !this.flushingNodes.has(node)) {
            this.dirtyNodes.delete(node);
            if (node.dirty) {
              this.flushingNodes.add(node);
              try {
                node.flush();
                node.dirty = false;
              } finally {
                this.flushingNodes.delete(node);
              }
            }
          }
          node = this.heapPop();
        }
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

    if (node.dirty && !this.flushingNodes.has(node)) {
      this.flushingNodes.add(node);
      try {
        node.flush();
        node.dirty = false;
      } finally {
        this.flushingNodes.delete(node);
      }
    }
  }

  queueFlush(node: AtomNode): void {
    this.dirtyNodes.add(node);
    this.heapPush(node);
    if (this.isBatchScheduled) return;

    this.isBatchScheduled = true;
    queueMicrotask(() => {
      if (!this.isFlushing) this.flush();
    });
  }

  remove(node: AtomNode): void {
    this.dirtyNodes.delete(node);
    this.flushingNodes.delete(node);
  }

  get isDirty(): boolean { return this.dirtyNodes.size > 0; }
}

let currentScheduler: Scheduler = new DefaultScheduler();

export function setScheduler(scheduler: Scheduler): void { currentScheduler = scheduler; }
export function getScheduler(): Scheduler { return currentScheduler; }


/* ─────────────────────────────────────────────────────────────────────────────
 * Dependency Tracking
 * ───────────────────────────────────────────────────────────────────────────*/

interface FormulaContext {
  dependencies: Set<InternalAtomContainer>;
}

const activeFormulaStack: FormulaContext[] = [];

function pushFormulaContext(context?: FormulaContext): FormulaContext {
  const ctx = context ?? { dependencies: new Set<InternalAtomContainer>() };
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
export function trackDependencies<T>(fn: () => T): { result: T; dependencies: Set<Atom<any>> } {
  const context = pushFormulaContext();
  try {
    return { result: fn(), dependencies: context.dependencies as unknown as Set<Atom<any>> };
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
  private atomProxies = new WeakMap<Atom<any>, any>();

  /** Read an atom and record it as a dependency of the active evaluation. */
  read<A>(atom: Atom<A>): A {
    if (this.ctx) {
      this.ctx.dependencies.add(atom as unknown as InternalAtomContainer);
    }
    return atom.value;
  }

  /** Register closure or global-scope atoms and return them for destructuring. */
  use<T extends Atom<any>[]>(...atoms: T): T extends [infer U] ? U : T {
    atoms.forEach(a => this.read(a));
    // Return single atom if only one, otherwise return array
    return (atoms.length === 1 ? atoms[0] : atoms) as any;
  }

  /** Return a cached proxy for an atom that intercepts `.value` reads. */
  wrapAtom(atom: Atom<any>): any {
    let proxy = this.atomProxies.get(atom);
    if (!proxy) {
      const owner = this;
      proxy = new Proxy(atom, {
        get(target, prop, receiver) {
          if (prop === "value") {
            return owner.read(target);
          }
          return Reflect.get(target, prop, receiver);
        }
      });
      this.atomProxies.set(atom, proxy);
    }
    return proxy;
  }

  /** Begin a new evaluation generation and return its context. */
  enter(): { context: FormulaContext; generation: number } {
    this.generation++;
    this.ctx = { dependencies: new Set<InternalAtomContainer>() };
    return { context: this.ctx, generation: this.generation };
  }

  /** True if the given context/generation is still the active evaluation. */
  isCurrent(context: FormulaContext, generation: number): boolean {
    return this.ctx === context && this.generation === generation;
  }

  /**
   * End an evaluation and return its collected dependencies, or `null` if a
   * newer evaluation has already superseded it.
   */
  leave(context: FormulaContext, generation: number): Set<InternalAtomContainer> | null {
    if (!this.isCurrent(context, generation)) return null;
    this.ctx = null;
    return context.dependencies;
  }
}

/**
 * The callable API surface of a derived scope. Kept as a real class so methods
 * are normal functions and the scope remains debuggable, while a Proxy wraps
 * the computable instance to expose atom properties.
 */
class DerivedScopeFacade {
  constructor(private owner: EvaluationOwner) {}

  read<A>(atom: Atom<A>): A {
    return this.owner.read(atom);
  }

  use<T extends Atom<any>[]>(...atoms: T): T extends [infer U] ? U : T {
    return this.owner.use(...atoms);
  }

  invoke<T extends Atom<any>>(first: T, ...rest: Atom<any>[]): AtomValue<T> | AtomValue<Atom<any>>[] {
    if (rest.length === 0) {
      return this.owner.read(first) as AtomValue<T>;
    }
    return [first, ...rest].map(a => this.owner.read(a)) as AtomValue<Atom<any>>[];
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

const disposedWeakMap = new WeakMap<object, boolean>();

function isDisposed(obj: object): boolean { return disposedWeakMap.get(obj) === true; }
function markDisposed(obj: object): void { disposedWeakMap.set(obj, true); }

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
 *   callback finishes. This is used in analog mode. If false, every emitted value
 *   is still delivered sequentially (callbacks are never re-entered), but no
 *   intermediate values are dropped.
 */
function createSubscriberSet<T>(errorHandlers: Set<(error: any) => void>, conflate: boolean) {
  type Callback = (current: T, previous: T) => MaybePromise;

  type Subscriber = {
    callback: Callback;
    busy: boolean;
    hasPending: boolean;
    pending: { current: T; previous: T } | undefined;
  };

  const subs = new Map<Callback, Subscriber>();

  const finish = (sub: Subscriber): void => {
    if (!subs.has(sub.callback)) return;
    sub.busy = false;
    while (sub.hasPending) {
      const { current, previous } = sub.pending!;
      sub.hasPending = false;
      sub.pending = undefined;
      invoke(sub, current, previous);
    }
  };

  const invoke = (sub: Subscriber, current: T, previous: T): void => {
    sub.busy = true;
    sub.hasPending = false;
    sub.pending = undefined;

    try {
      const result = sub.callback(current, previous);
      const thenable = result && typeof (result as any).then === "function"
        ? (result as PromiseLike<void>)
        : null;

      if (thenable) {
        thenable.then(
          () => finish(sub),
          (err: any) => {
            const e = normalizeError(err);
            for (const h of Array.from(errorHandlers)) try { h(e); } catch {}
            finish(sub);
          }
        );
      } else {
        finish(sub);
      }
    } catch (err) {
      const e = normalizeError(err);
      for (const h of Array.from(errorHandlers)) try { h(e); } catch {}
      finish(sub);
    }
  };

  return {
    get size() { return subs.size; },
    add(callback: Callback) {
      subs.set(callback, { callback, busy: false, hasPending: false, pending: undefined });
    },
    delete(callback: Callback) { subs.delete(callback); },
    clear() { subs.clear(); },
    has(callback: Callback) { return subs.has(callback); },
    broadcast(current: T, previous: T) {
      for (const sub of Array.from(subs.values())) {
        if (conflate && sub.busy) {
          sub.hasPending = true;
          sub.pending = { current, previous };
        } else {
          invoke(sub, current, previous);
        }
      }
    }
  };
}

// Dependency invalidation channel: separate from public subscriber broadcast.
// Dependent atoms register here so they are marked dirty immediately when a
// dependency changes, even in analog mode where public broadcasts are batched.
const atomChangeHandlers = new WeakMap<Atom<any>, Set<() => void>>();

function addAtomChangeHandler(atom: Atom<any>, handler: () => void): void {
  let handlers = atomChangeHandlers.get(atom);
  if (!handlers) {
    handlers = new Set();
    atomChangeHandlers.set(atom, handlers);
  }
  handlers.add(handler);
}

function removeAtomChangeHandler(atom: Atom<any>, handler: () => void): void {
  atomChangeHandlers.get(atom)?.delete(handler);
}

function notifyChangeHandlers(atom: Atom<any>): void {
  const handlers = atomChangeHandlers.get(atom);
  if (!handlers) return;
  for (const h of Array.from(handlers)) {
    try { h(); } catch { /* suppress dependent errors */ }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * atomFromIterator() - Atom runtime over an async iterable
 * ───────────────────────────────────────────────────────────────────────────*/

export interface AtomFromIteratorOptions<T> extends AtomOptions {
  initialValue?: T;
}

export function atomFromIterator<T>(
  source: AsyncIterable<T>,
  options?: AtomFromIteratorOptions<T>
): Atom<T> {
  const activeScope = getCurrentScope();
  const analog = activeScope !== null && getScopeMode(activeScope) === "analog" && !options?.discrete;
  const maxSubscribers = options?.maxSubscribers ?? 1000;

  let current: T = options?.initialValue !== undefined ? options.initialValue : undefined as T;
  let previous: T = current;
  let disposed = false;
  let started = false;
  let activeSubCount = 0;
  let errorValue: any = undefined;
  let isErrorState = false;
  let hasNewValue = false;

  const disposeHandlers = new Set<() => void>();
  const errorHandlers = new Set<(error: any) => void>();
  const subs = createSubscriberSet<T>(errorHandlers, analog);
  const subscriptions = new Set<Subscription>();

  let iterator: AsyncIterator<T> | undefined;
  let runPromise: Promise<void> | null = null;

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
    markDisposed(instance);
    node.version++;
    subs.clear();
    activeSubCount = 0;

    await stopIterator();

    for (const handler of disposeHandlers) await Promise.resolve(handler()).catch(() => {});
    disposeHandlers.clear();

    for (const sub of subscriptions) await sub().catch(() => {});
    subscriptions.clear();

    getScheduler().remove(node);
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
          notifyChangeHandlers(instance);

          if (analog) {
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
          for (const h of errorHandlers) try { h(errorValue); } catch {}
          if (options?.onError) try { options.onError(errorValue); } catch {}
          instance.fail(errorValue, { terminate: true });
        }
      } finally {
        await stopIterator();
        runPromise = null;
      }
    })();
    return runPromise;
  };

  const node: AtomNode = {
    depth: 0, version: 0, dirty: false, flushing: false,
    isResource: true, isAnalog: analog,
    flush() {
      if (disposed || (!node.dirty && !hasNewValue) || node.flushing) return;
      node.flushing = true;
      try {
        broadcastLatest();
      } finally {
        node.flushing = false;
      }
    },
  };

  const instance: Atom<T> & InternalAtomContainer & { fail(err: any, options?: { terminate?: boolean }): void } = {
    type: "atom",

    get disposed() { return disposed || isDisposed(this); },
    get error() { return errorValue; },
    get subscriberCount() { return subs.size; },

    get value() {
      if (disposed) throw new Error("Atom has been disposed");
      if (isErrorState && errorValue) throw errorValue;
      const ctx = getCurrentFormulaContext();
      if (ctx) ctx.dependencies.add(instance);
      return current;
    },
    get safeValue() { return current; },
    get previous() { return previous; },

    [NODE]: node,
    [MARK_DIRTY]() {
      if (disposed || node.dirty) return;
      node.dirty = true;
      getScheduler().queueFlush(node);
    },
    [FLUSH]() { node.flush(); },

    subscribe(callback) {
      if (disposed) return createSubscription(() => {});
      if (subs.size >= maxSubscribers) throw new Error(`Maximum subscriber limit (${maxSubscribers}) reached`);

      if (!started) {
        started = true;
        run().catch(() => {});
      }

      if (callback) subs.add(callback);
      activeSubCount++;

      const unsubscribe = createSubscription(async () => {
        if (callback) subs.delete(callback);
        subscriptions.delete(unsubscribe);
        if (--activeSubCount <= 0) await disposeInstance();
      });
      subscriptions.add(unsubscribe);
      return unsubscribe;
    },

    onError(handler) {
      if (disposed) return createSubscription(() => {});
      errorHandlers.add(handler);
      if (errorValue !== undefined) try { handler(errorValue); } catch {}
      return createSubscription(() => { errorHandlers.delete(handler); });
    },

    fail(err, errorOptions?) {
      if (disposed) return;
      errorValue = normalizeError(err);
      isErrorState = true;
      for (const h of errorHandlers) try { h(errorValue); } catch {}
      if (options?.onError) try { options.onError(errorValue); } catch {}

      if (errorOptions?.terminate ?? false) {
        void disposeInstance();
      }
    },

    [Symbol.asyncIterator]() { return iterate(this); },
    dispose() { void disposeInstance(); },
  };

  Object.defineProperty(instance, "_onDispose", { get: () => disposeHandlers, enumerable: false });
  (instance as any)[ANALOG] = analog;
  registerWithCurrentScope(instance as any);

  return instance;
}

function watchDependencies(
  deps: Iterable<InternalAtomContainer>,
  callback: (dep: InternalAtomContainer) => void
): () => void {
  const handlers = new Map<InternalAtomContainer, () => void>();
  for (const dep of deps) {
    const handler = () => {
      cleanup();
      callback(dep);
    };
    addAtomChangeHandler(dep as any, handler);
    handlers.set(dep, handler);
  }
  function cleanup() {
    for (const [dep, handler] of handlers) {
      removeAtomChangeHandler(dep as any, handler);
    }
    handlers.clear();
  }
  return cleanup;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * flow() - Async Resource Node
 * ───────────────────────────────────────────────────────────────────────────*/

export function flow<T>(
  source: AsyncIterable<T> | Iterable<T> | ((signal?: AbortSignal) => AsyncIterable<T> | Iterable<T>),
  options?: AtomOptions
): Atom<T> {
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
      let generation = 0;
      let controller: AbortController | undefined;
      let coordinator: AsyncCoordinator<T>;
      const sourceGeneration = new Map<number, number>();
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

            generation++;
            controller?.abort();

            const nextSource = makeSource();
            const nextIndex = coordinator.addSource(nextSource);
            sourceGeneration.set(nextIndex, generation);
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

      const firstSource = makeSource();
      coordinator = createAsyncCoordinator<T>([firstSource], { syncDrain: true });
      sourceGeneration.set(0, generation);

      const iterator: AsyncIterator<T> = {
        async next() {
          while (!stopped) {
            const event = await coordinator.next();

            if (event.done) return DONE;

            const item = event.value;
            const itemGeneration = sourceGeneration.get(item.sourceIndex);

            if (itemGeneration !== generation) {
              continue;
            }

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
          await coordinator.return?.();
          sourceGeneration.clear();
          return DONE;
        }
      };

      return iterator;
    }
  };

  return atomFromIterator(
    iterable,
    hasInitialValue ? { ...options, initialValue } : options
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * atom() - Mutable State Node
 * ───────────────────────────────────────────────────────────────────────────*/

const KNOWN_ATOM_OPTION_KEYS = new Set<keyof AtomOptions>([
  "discrete",
  "maxSubscribers",
  "onError",
  "terminateOnError",
  "propagateErrors",
]);

function isAtomOptionsObject(value: unknown): value is AtomOptions {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every(k => KNOWN_ATOM_OPTION_KEYS.has(k as keyof AtomOptions));
}

export function atom<T = any>(options?: AtomOptions): Writable<T>;
export function atom<T = any>(noInitialValue: typeof NO_INITIAL_VALUE, options?: AtomOptions): Writable<T>;
export function atom<T = any>(initialValue: T, options?: AtomOptions): Writable<T>;
export function atom<T = any>(
  initialValue?: T | typeof NO_INITIAL_VALUE | AtomOptions,
  options?: AtomOptions
): Writable<T> {
  const activeScope = getCurrentScope();
  const resolvedOptions = isAtomOptionsObject(initialValue) ? initialValue : options;
  const analog = activeScope !== null && getScopeMode(activeScope) === "analog" && !resolvedOptions?.discrete;

  const maxSubscribers = resolvedOptions?.maxSubscribers ?? 1000;
  const terminateOnError = resolvedOptions?.terminateOnError ?? false;
  const propagateErrors = resolvedOptions?.propagateErrors ?? true;

  const hasInitialValue = initialValue !== undefined && initialValue !== NO_INITIAL_VALUE && !(isAtomOptionsObject(initialValue) && arguments.length === 1);
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

  const disposeHandlers = new Set<() => void>();
  const errorHandlers = new Set<(error: any) => void>();
  const subs = createSubscriberSet<T>(errorHandlers, analog);
  const subscriptions = new Set<Subscription>();

  const broadcast = () => subs.broadcast(current, previous);

  const flushInternal = () => {
    if (!node.dirty || disposed) return;
    node.dirty = false;
    if (Object.is(lastNotified, current)) return;
    
    lastNotified = current;
    node.version++;
    broadcast();
  };

  const node: AtomNode = {
    depth: 0, version: 0, dirty: false, flushing: false,
    isResource: false, isAnalog: analog,
    flush() {
      if (disposed || !node.dirty || node.flushing) return;
      
      node.flushing = true;
      try {
        flushInternal();
      } finally {
        node.flushing = false;
      }
    },
  };

  const instance: Writable<T> & InternalAtomContainer = {
    type: "atom",

    get disposed() { return disposed || isDisposed(this); },
    get error() { return errorValue; },
    get subscriberCount() { return subs.size; },
    
    get value() {
      if (disposed) throw new Error("Atom has been disposed");
      if (isErrorState && errorValue) throw errorValue;
      const ctx = getCurrentFormulaContext();
      if (ctx) ctx.dependencies.add(instance);
      return current;
    },

    get safeValue() { return current; },
    get previous() { return previous; },

    [NODE]: node,
    [MARK_DIRTY]() {
      if (disposed || node.dirty) return;
      node.dirty = true;
      getScheduler().queueFlush(node);
    },
    [FLUSH]() { node.flush(); },

    subscribe(callback) {
      if (disposed) return createSubscription(() => {});
      if (subs.size >= maxSubscribers) throw new Error(`Maximum subscriber limit (${maxSubscribers}) reached`);
      if (callback) subs.add(callback);

      const unsubscribe = createSubscription(() => {
        if (callback) subs.delete(callback);
        subscriptions.delete(unsubscribe);
      });
      subscriptions.add(unsubscribe);
      return unsubscribe;
    },

    onError(handler: (error: any) => void): Subscription {
      if (disposed) return createSubscription(() => {});
      errorHandlers.add(handler);
      if (errorValue !== undefined) try { handler(errorValue); } catch {}
      return createSubscription(() => { errorHandlers.delete(handler); });
    },

    [Symbol.asyncIterator]() { return iterate(this); },

    next(value: T) {
      if (disposed) return;
      if (isErrorState) { isErrorState = false; errorValue = undefined; }

      previous = current;
      current = value;

      // Notify dependents immediately so derived atoms stay dirty-tracked
      // regardless of whether public broadcasts are discrete or analog-batched.
      notifyChangeHandlers(instance);

      if (node.isAnalog) {
        // Analog: Defer public broadcast to scheduler flush
        if (subs.size > 0) {
          instance[MARK_DIRTY]();
        }
      } else {
        // Discrete: Immediate broadcast.
        // Dependents are already queued by notifyChangeHandlers() above; there is
        // no need to re-queue this node — flushInternal() would short-circuit on
        // the Object.is(lastNotified, current) guard anyway, but getting here at
        // all wastes a microtask per discrete emit.
        node.dirty = false;
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
        disposed = true;
        markDisposed(instance);
        getScheduler().remove(node);
        
        for (const h of disposeHandlers) Promise.resolve(h()).catch(() => {});
        disposeHandlers.clear();
        for (const s of subscriptions) s();
        subscriptions.clear();
        subs.clear();
        errorHandlers.clear();
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

    dispose() {
      if (disposed) return;
      disposed = true;
      markDisposed(instance);
      getScheduler().remove(node);
      for (const h of disposeHandlers) Promise.resolve(h()).catch(() => {});
      disposeHandlers.clear();
      for (const s of subscriptions) s();
      subscriptions.clear();
      subs.clear();
      errorHandlers.clear();
    },
  };

  Object.defineProperty(instance, "_onDispose", { get: () => disposeHandlers, enumerable: false });
  (instance as any)[ANALOG] = analog;
  registerWithCurrentScope(instance as any);
  if (hasInitialValue) markAtomAsEmitted(instance as any);
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

function isAsyncFunction(fn: AnyFn): boolean {
  return fn.constructor?.name === "AsyncFunction";
}

function extractAllMembers(fn: AnyFn): Record<string, unknown> {
  const members: Record<string, unknown> = {};

  const excluded = new Set(["length", "name", "prototype", "arguments", "caller"]);

  for (const name of Object.getOwnPropertyNames(fn)) {
    if (excluded.has(name)) continue;
    members[name] = (fn as any)[name];
  }

  if (fn.prototype) {
    for (const name of Object.getOwnPropertyNames(fn.prototype)) {
      if (name === "constructor" || members[name] !== undefined) continue;
      members[name] = (fn.prototype as any)[name];
    }
  }

  return members;
}

function wrapFunctionInClass(fn: AnyFn): new () => ComputableInstance {
  const isGenerator = isGeneratorFunction(fn);
  const isAsync = isAsyncFunction(fn);
  const members = extractAllMembers(fn);

  class FunctionWrapper implements ComputableInstance {
    private _fn!: AnyFn;
    private _isGenerator!: boolean;
    private _isAsync!: boolean;
    [key: string]: unknown;

    constructor() {
      this._fn = fn.bind(this);
      this._isGenerator = isGenerator;
      this._isAsync = isAsync;

      for (const [name, value] of Object.entries(members)) {
        Object.defineProperty(this, name, {
          value: typeof value === "function" ? (value as AnyFn).bind(this) : value,
          writable: true,
          configurable: true
        });
      }

      const onConstruct = (this._fn as any).onConstruct;
      if (typeof onConstruct === "function") {
        onConstruct.apply(this);
      }
    }

    compute(self: DerivedScope): unknown {
      if (this._isGenerator) return this.runGenerator(self);
      if (this._isAsync) return this.runAsync(self);
      return this.runSync(self);
    }

    private runSync(self: DerivedScope): unknown {
      return this._fn(self);
    }

    private runAsync(self: DerivedScope): unknown {
      return this._fn(self);
    }

    private runGenerator(self: DerivedScope): unknown {
      const gen = this._fn(self);
      return this.iterateGenerator(gen as Generator<unknown, unknown, unknown>, self);
    }

    private iterateGenerator(gen: Generator<unknown, unknown, unknown>, self: DerivedScope): unknown {
      const step = (value?: unknown): unknown => {
        const result = value === undefined ? gen.next() : gen.next(value);

        if (result.done) return result.value;

        const yielded = result.value;

        if (yielded && typeof yielded === "object" && "then" in yielded) {
          return Promise.resolve(yielded).then(step);
        }

        if (yielded && typeof yielded === "object" && (yielded as Atom<any>).type === "atom") {
          return step(self.read(yielded as Atom<any>));
        }

        return step(yielded);
      };

      return step();
    }

    onInit(self: DerivedScope) {
      const hook = (this._fn as any).onInit;
      if (typeof hook === "function") hook.call(this, self);
    }

    onDispose() {
      const hook = (this._fn as any).onDispose;
      if (typeof hook === "function") hook.call(this);
    }
  }

  return FunctionWrapper as unknown as new () => ComputableInstance;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * derived() - Computed Node
 * ───────────────────────────────────────────────────────────────────────────*/

export type SyncOnly<T> = T extends Promise<any> ? never : T;

export function derived<T>(fn: (self: DerivedScope) => SyncOnly<T>, options?: AtomOptions): Atom<T>;
export function derived<T>(fn: (self: DerivedScope) => Promise<T>, options?: AtomOptions): Atom<T>;
export function derived<T>(...args: any[]): Atom<T> {
  let computableFactory: () => ComputableInstance;
  let options: AtomOptions | undefined;

  const first = args[0];
  const second = args[1];

  // Handle the two supported overloads:
  // 1. derived((self) => T, options?)
  // 2. derived((self) => Promise<T>, options?)
  if (typeof first === "function") {
    // Check if it's a class with compute method (for ComputableInstance)
    if (first.prototype && typeof first.prototype.compute === "function") {
      const Class = first as new () => ComputableInstance;
      computableFactory = () => new Class();
    } else {
      // Regular function
      computableFactory = () => new (wrapFunctionInClass(first))();
    }
    options = second as AtomOptions | undefined;
  } else {
    throw new Error("derived() requires a function as the first argument");
  }

  const computable = computableFactory();
  const owner = new EvaluationOwner();
  const self = createSelf(computable, owner);

  const activeScope = getCurrentScope();
  const analog = activeScope !== null && getScopeMode(activeScope) === "analog" && !options?.discrete;

  const maxSubscribers = options?.maxSubscribers ?? 1000;
  const terminateOnError = options?.terminateOnError ?? false;
  const propagateErrors = options?.propagateErrors ?? true;

  let current!: T;
  let previous!: T;
  let disposed = false;
  let initialized = false;
  let running = false;
  let errorValue: any = undefined;
  let isErrorState = false;
  let notifyPending = false;
  let isAsyncFormula = false;

  const errorHandlers = new Set<(error: any) => void>();
  const subs = createSubscriberSet<T>(errorHandlers, analog);
  const dependencies = new Set<InternalAtomContainer>();
  const depSubscriptions = new Map<InternalAtomContainer, Subscription>();

  let asyncCoordinator: AsyncCoordinator<T> | undefined;
  let asyncController: AbortController | undefined;
  let asyncGeneration = 0;
  const asyncSourceGeneration = new Map<number, number>();
  let asyncReaderStarted = false;

  const broadcast = () => subs.broadcast(current, previous);

  const commitValue = (next: T) => {
    if (Object.is(current, next)) return;

    previous = current;
    current = next;
    node.version++;

    notifyChangeHandlers(instance);

    if (node.isAnalog) {
      notifyPending = true;
    } else if (subs.size > 0) {
      broadcast();
    }
  };

  const processDependencies = (context: FormulaContext) => {
    let maxDepth = -1;

    for (const dep of context.dependencies) {
      dependencies.add(dep);

      if (dep[NODE]?.depth > maxDepth) {
        maxDepth = dep[NODE].depth;
      }

      if (depSubscriptions.has(dep)) continue;

      const handler = () => {
        if (disposed) return;

        if (isAsyncFormula) {
          recompute();
          return;
        }

        if (!node.isAnalog) {
          if (!node.flushing && !running) {
            node.dirty = true;
            recompute();
          } else {
            instance[MARK_DIRTY]();
          }
          return;
        }

        instance[MARK_DIRTY]();
      };

      addAtomChangeHandler(dep as any, handler);

      depSubscriptions.set(
        dep,
        createSubscription(() => {
          removeAtomChangeHandler(dep as any, handler);
        }),
      );
    }

    node.depth = maxDepth + 1;
  };

  const startAsyncReader = () => {
    if (asyncReaderStarted || !asyncCoordinator) return;
    asyncReaderStarted = true;

    void (async () => {
      try {
        while (!disposed && asyncCoordinator) {
          const result = await asyncCoordinator.next();
          if (disposed || result.done) break;

          const event = result.value;
          const eventGeneration = asyncSourceGeneration.get(event.sourceIndex);

          if (eventGeneration !== asyncGeneration) {
            continue;
          }

          if (event.type === "value") {
            isErrorState = false;
            errorValue = undefined;
            markAtomAsEmitted(instance as any);
            commitValue(event.value);
            continue;
          }

          if (event.type === "error") {
            errorValue = normalizeError(event.error);
            isErrorState = true;

            if (terminateOnError) {
              instance.dispose();
            } else if (propagateErrors && subs.size > 0) {
              broadcast();
            }
          }
        }
      } finally {
        asyncReaderStarted = false;
      }
    })();
  };

  const enqueueAsyncResult = (
    promise: Promise<T>,
    context: FormulaContext,
    ownerGeneration: number,
  ) => {
    asyncController?.abort();
    asyncController = new AbortController();

    const sourceGeneration = ++asyncGeneration;
    const source = promiseSource(promise, asyncController.signal);

    if (!asyncCoordinator) {
      asyncCoordinator = createAsyncCoordinator<T>([source], { syncDrain: true });
      asyncSourceGeneration.set(0, sourceGeneration);
    } else {
      const index = asyncCoordinator.addSource(source);
      asyncSourceGeneration.set(index, sourceGeneration);
    }

    promise
      .finally(() => {
        if (disposed || !owner.isCurrent(context, ownerGeneration)) return;

        owner.leave(context, ownerGeneration);
        processDependencies(context);
      })
      .catch(() => {});

    startAsyncReader();
  };

  const compute = (): { result: T | Promise<T>; context: FormulaContext; generation: number } => {
    if (running) throw new Error("Circular dependency detected in derived()");

    running = true;
    const { context, generation } = owner.enter();
    pushFormulaContext(context);
    let asyncResult = false;

    try {
      const result = computable.compute(self) as T | Promise<T>;
      initialized = true;
      asyncResult = isPromiseLike(result);
      isAsyncFormula = asyncResult;
      processDependencies(context);
      return { result, context, generation };
    } finally {
      popFormulaContext();
      running = false;
      if (!asyncResult) {
        owner.leave(context, generation);
      }
    }
  };

  const recompute = () => {
    const { result: next, context, generation } = compute();
    node.dirty = false;

    isErrorState = false;
    errorValue = undefined;

    if (isPromiseLike(next)) {
      enqueueAsyncResult(Promise.resolve(next), context, generation);
      return;
    }

    commitValue(next);
  };

  const flushInternal = () => {
    if ((!node.dirty && !notifyPending) || disposed || node.flushing) return;
    node.flushing = true;
    try {
      if (node.dirty) recompute();
      if (notifyPending && subs.size > 0) {
        broadcast();
        notifyPending = false;
      }
    } catch (err) {
      errorValue = normalizeError(err);
      isErrorState = true;
      node.dirty = false;
      notifyPending = false;
      if (terminateOnError) {
        instance.dispose();
      } else if (propagateErrors) {
        broadcast();
      }
    } finally {
      node.flushing = false;
    }
  };

  const node: AtomNode = {
    depth: 0, version: 0, dirty: false, flushing: false,
    isResource: false, isAnalog: analog,
    flush() {
      if (disposed || (!node.dirty && !notifyPending) || node.flushing) return;
      flushInternal();
    },
  };

  const instance: Atom<T> & InternalAtomContainer = {
    type: "atom",

    get disposed() { return disposed || isDisposed(this); },
    get error() { return errorValue; },
    get subscriberCount() { return subs.size; },

    get value() {
      if (disposed) throw new Error("Atom has been disposed");
      if (running) throw new Error("Circular dependency detected in derived()");

      const ctx = getCurrentFormulaContext();
      if (ctx) ctx.dependencies.add(instance);

      if (!initialized) {
        try {
          const { result, context, generation } = compute();
          if (isPromiseLike(result)) {
            enqueueAsyncResult(Promise.resolve(result), context, generation);
          } else {
            current = result;
            previous = current;
            markAtomAsEmitted(instance as any);
          }
        } catch (err) {
          initialized = true;
          errorValue = normalizeError(err);
          isErrorState = true;
          if (terminateOnError) {
            instance.dispose();
            throw errorValue;
          }
        }
      } else if (node.dirty) {
        try {
          recompute();
          if (notifyPending && subs.size > 0) instance[MARK_DIRTY]();
        } catch (err) {
          errorValue = normalizeError(err);
          isErrorState = true;
          if (terminateOnError) {
            instance.dispose();
            throw errorValue;
          }
        }
      }

      if (isErrorState && errorValue) throw errorValue;
      return current;
    },

    get safeValue() {
      try { return this.value; } catch (err) {
        return current;
      }
    },
    get previous() {
      try { this.value; } catch {}
      return previous;
    },

    [NODE]: node,
    [MARK_DIRTY]() {
      if (disposed || node.dirty) return;
      node.dirty = true;
      getScheduler().queueFlush(node);
    },
    [FLUSH]() { node.flush(); },

    subscribe(callback) {
      try { this.value; } catch {}
      if (disposed) return createSubscription(() => {});
      if (subs.size >= maxSubscribers) throw new Error(`Maximum subscriber limit (${maxSubscribers}) reached`);
      if (callback) subs.add(callback);
      return createSubscription(() => { if (callback) subs.delete(callback); });
    },

    onError(handler: (error: any) => void): Subscription {
      if (disposed) return createSubscription(() => {});
      errorHandlers.add(handler);
      if (errorValue !== undefined) try { handler(errorValue); } catch {}
      return createSubscription(() => { errorHandlers.delete(handler); });
    },

    [Symbol.asyncIterator]() { return iterate(this); },

    dispose() {
      if (disposed) return;
      disposed = true;
      markDisposed(instance);
      getScheduler().remove(node);
      notifyPending = false;

      asyncController?.abort();
      void asyncCoordinator?.return?.();
      asyncCoordinator = undefined;
      asyncSourceGeneration.clear();

      for (const sub of depSubscriptions.values()) sub();
      depSubscriptions.clear();
      dependencies.clear();
      subs.clear();
      errorHandlers.clear();

      if (typeof computable.onDispose === "function") {
        computable.onDispose();
      }
    },
  };

  (instance as any)[ANALOG] = analog;
  registerWithCurrentScope(instance as any);

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
