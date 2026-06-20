import { iterate } from "./iterate";
import { type MaybePromise, type Operator } from "./operator";
import { pipe as pipeSource } from "./pipe";

import {
  getCurrentScope,
  getScopeMode,
  markAtomAsEmitted,
  registerWithCurrentScope,
} from "./scope";
import { createSubscription, type Subscription } from "./subscription";

/* ─────────────────────────────────────────────────────────────────────────────
 * Architectural Symbols
 * ───────────────────────────────────────────────────────────────────────────*/

const NODE = Symbol("engine.node");
const MARK_DIRTY = Symbol("engine.markDirty");
const FLUSH = Symbol("engine.flush");

export interface AtomOptions {
  discrete?: boolean;
  maxSubscribers?: number;
  onError?: (error: any) => void;
  terminateOnError?: boolean;
  propagateErrors?: boolean;
}

/** Public API Contract */
export interface AtomBase<T = any> {
  readonly type: "atom";
  readonly name?: string;
  readonly value: T;
  readonly safeValue: T;
  readonly prior: T;
  readonly disposed: boolean;
  readonly error?: any;
  readonly subscriberCount?: number;
  subscribe(callback?: (value: T) => MaybePromise): Subscription;
  onError(handler: (error: any) => void): Subscription;
  dispose(): void;
  pipe<R = any>(...ops: Operator<any, any>[]): AtomBase<R>;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

export interface Atom<T = any> extends AtomBase<T> {
  next(value: T): void;
  fail(err: any, options?: { terminate?: boolean }): void;
  recover?(): void;
  clearError?(): void;
}

/** Internal Node State */
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

  flush(): void {
    if (this.isFlushing) return;
    this.isFlushing = true;

    try {
      while (this.dirtyNodes.size > 0) {
        // Topological sort: shallow nodes first
        const sorted = Array.from(this.dirtyNodes).sort((a, b) => a.depth - b.depth);
        this.dirtyNodes.clear();

        for (const node of sorted) {
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
      }
    } finally {
      this.isFlushing = false;
      this.isBatchScheduled = false;
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

function pushFormulaContext(): FormulaContext {
  const context = { dependencies: new Set<InternalAtomContainer>() };
  activeFormulaStack.push(context);
  return context;
}

function popFormulaContext(): void {
  activeFormulaStack.pop();
}

function getCurrentFormulaContext(): FormulaContext | null {
  return activeFormulaStack.length > 0 ? activeFormulaStack[activeFormulaStack.length - 1] : null;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Shared Internals
 * ───────────────────────────────────────────────────────────────────────────*/

const disposedWeakMap = new WeakMap<object, boolean>();

function isDisposed(obj: object): boolean { return disposedWeakMap.get(obj) === true; }
function markDisposed(obj: object): void { disposedWeakMap.set(obj, true); }

function normalizeError(err: any): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Subscriber Set
 * ───────────────────────────────────────────────────────────────────────────*/

function createSubscriberSet<T>(errorHandlers: Set<(error: any) => void>, conflate: boolean) {
  type Callback = (value: T) => MaybePromise;

  type Subscriber = {
    callback: Callback;
    busy: boolean;
    hasPending: boolean;
    pending: T | undefined;
  };

  const subs = new Map<Callback, Subscriber>();

  const finish = (sub: Subscriber): void => {
    if (!subs.has(sub.callback)) return;
    sub.busy = false;
    while (sub.hasPending) {
      const value = sub.pending as T;
      sub.hasPending = false;
      sub.pending = undefined;
      invoke(sub, value);
    }
  };

  const invoke = (sub: Subscriber, value: T): void => {
    sub.busy = true;
    sub.hasPending = false;
    sub.pending = undefined;

    try {
      const result = sub.callback(value);
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
    broadcast(value: T) {
      for (const sub of Array.from(subs.values())) {
        if (conflate && sub.busy) {
          sub.hasPending = true;
          sub.pending = value;
        } else {
          invoke(sub, value);
        }
      }
    }
  };
}

// Dependency invalidation channel: separate from public subscriber broadcast.
// Dependent atoms register here so they are marked dirty immediately when a
// dependency changes, even in analog mode where public broadcasts are batched.
const atomChangeHandlers = new WeakMap<AtomBase<any>, Set<() => void>>();

function addAtomChangeHandler(atom: AtomBase<any>, handler: () => void): void {
  let handlers = atomChangeHandlers.get(atom);
  if (!handlers) {
    handlers = new Set();
    atomChangeHandlers.set(atom, handlers);
  }
  handlers.add(handler);
}

function removeAtomChangeHandler(atom: AtomBase<any>, handler: () => void): void {
  atomChangeHandlers.get(atom)?.delete(handler);
}

function notifyChangeHandlers(atom: AtomBase<any>): void {
  const handlers = atomChangeHandlers.get(atom);
  if (!handlers) return;
  for (const h of Array.from(handlers)) {
    try { h(); } catch { /* suppress dependent errors */ }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * flow() - Async Resource Node
 * ───────────────────────────────────────────────────────────────────────────*/

interface InternalFlowAtom<T> extends AtomBase<T>, InternalAtomContainer {
  fail(err: any, options?: { terminate?: boolean }): void;
}

export function flow<T>(
  source: AsyncIterable<T> | Iterable<T> | ((signal?: AbortSignal) => AsyncIterable<T> | Iterable<T>),
  options?: AtomOptions
): AtomBase<T> {
  const maxSubscribers = options?.maxSubscribers ?? 1000;
  
  const scope = getCurrentScope();
  const analog = scope !== null && getScopeMode(scope) === "analog" && !options?.discrete;

  // State
  let current: T;
  let previous: T;

  // If the source is an atom, initialize the flow's current value from the
  // atom's current value so consumers see the latest value immediately.
  if (source != null && typeof source === "object" && (source as any).type === "atom") {
    try {
      current = (source as any).safeValue;
      previous = current;
    } catch {
      current = undefined as T;
      previous = undefined as T;
    }
  } else {
    current = undefined as T;
    previous = undefined as T;
  }
  let disposed = false;
  let started = false;
  let activeSubCount = 0;
  let errorValue: any = undefined;
  let hasNewValue = false;
  let restartPending = false;
  const disposeHandlers = new Set<() => void>();
  const errorHandlers = new Set<(error: any) => void>();
  const subs = createSubscriberSet<T>(errorHandlers, analog);
  const subscriptions = new Set<Subscription>();
  const depSubscriptions = new Map<InternalAtomContainer, Subscription>();

  // Iteration Control
  let iterator: AsyncIterator<T> | Iterator<T> | undefined;
  let abortController: AbortController | undefined;
  let disposePromise: Promise<void> | null = null;

  const clearDepSubscriptions = () => {
    for (const sub of depSubscriptions.values()) sub.unsubscribe();
    depSubscriptions.clear();
  };

  const broadcast = (val: T) => subs.broadcast(val);

  const broadcastLatest = () => {
    if (!hasNewValue) return;
    hasNewValue = false;
    broadcast(current);
  };

  const stop = async (
    controller: AbortController | undefined = abortController,
    iter: AsyncIterator<T> | Iterator<T> | undefined = iterator
  ): Promise<void> => {
    controller?.abort();
    if (iter && typeof (iter as any).return === "function") {
      try { await (iter as any).return(); } catch { /* ignore */ }
    }
  };

  const disposeInstance = async (): Promise<void> => {
    if (disposed) return;
    if (disposePromise) return disposePromise;

    disposePromise = (async () => {
      disposed = true;
      markDisposed(instance);
      node.version++;
      subs.clear();
      activeSubCount = 0;
      clearDepSubscriptions();

      await stop().catch(() => {});
      
      for (const handler of disposeHandlers) await Promise.resolve(handler()).catch(() => {});
      disposeHandlers.clear();
      
      for (const sub of subscriptions) await sub.unsubscribe().catch(() => {});
      subscriptions.clear();
      
      getScheduler().remove(node);
    })();

    try { await disposePromise; } finally { disposePromise = null; }
  };

  const startIteration = async (targetVersion: number) => {
    if (disposed || targetVersion !== node.version) return;

    abortController = new AbortController();
    const signal = abortController.signal;
    
    // 1. Resolve Source & Track Dependencies
    let iterable: AsyncIterable<T> | Iterable<T>;
    const context = pushFormulaContext();
    try {
      if (typeof source === "function") iterable = source(signal);
      else iterable = source;
    } catch (err) {
      popFormulaContext();
      instance.fail(err);
      void disposeInstance();
      return;
    }
    
    if (disposed || targetVersion !== node.version) {
      popFormulaContext();
      return;
    }

    // 2. Acquire Iterator
    const asyncIter = (iterable as any)[Symbol.asyncIterator];
    const syncIter = (iterable as any)[Symbol.iterator];
    iterator = asyncIter ? asyncIter.call(iterable) : (syncIter ? syncIter.call(iterable) : undefined);

    if (!iterator) {
      popFormulaContext();
      instance.fail(new Error("Source is not iterable"));
      void disposeInstance();
      return;
    }

    // 3. Update Dependencies
    let maxDepth = -1;
    for (const dep of context.dependencies) {
      if (dep[NODE]?.depth > maxDepth) maxDepth = dep[NODE].depth;
      if (!depSubscriptions.has(dep)) {
        const handler = () => {
          if (disposed || activeSubCount <= 0) return;

          restartPending = true;

          if (subs.size > 0) {
            instance[MARK_DIRTY]();
          }
        };
        addAtomChangeHandler(dep as any, handler);
        depSubscriptions.set(dep, createSubscription(() => {
          removeAtomChangeHandler(dep as any, handler);
        }));
      }
    }
    node.depth = maxDepth + 1;
    popFormulaContext();

    // 4. Run Loop
    try {
      while (targetVersion === node.version && !disposed && !signal.aborted) {
        const result = await iterator.next();
        if (result.done || targetVersion !== node.version || signal.aborted) break;
        
        previous = current;
        current = result.value;
        markAtomAsEmitted(instance as any);
        notifyChangeHandlers(instance);

        if (analog) {
          // In analog mode, buffer the emission and broadcast the latest value
          // once per scheduler flush instead of on every source emission.
          hasNewValue = true;

          if (subs.size > 0) {
            instance[MARK_DIRTY]();
          }
        } else {
          broadcast(current);
        }

        // Yield to event loop
        await new Promise<void>(r => queueMicrotask(r));
      }
      
      if (targetVersion === node.version && !disposed) await disposeInstance();
    } catch (err) {
      if (targetVersion === node.version && !disposed) {
        errorValue = normalizeError(err);
        for (const h of errorHandlers) try { h(errorValue); } catch {}
        if (options?.onError) try { options.onError(errorValue); } catch {}
        instance.fail(err, { terminate: true });
      }
    }
  };

  const node: AtomNode = {
    depth: 0, version: 0, dirty: false, flushing: false,
    isResource: true, isAnalog: analog,
    flush() {
      if (disposed || (!node.dirty && !hasNewValue) || node.flushing) return;
      node.flushing = true;
      try {
        // Analog mode: broadcast the latest buffered value first, then restart
        // if a dependency change requested it.
        broadcastLatest();
        if (restartPending) {
          restartPending = false;
          // Tear down the previous iteration before starting a new one so that
          // sources with real cleanup (subscriptions, generators, sockets) are
          // not leaked on every dependency-triggered restart.
          const oldController = abortController;
          const oldIterator = iterator;
          abortController = undefined;
          iterator = undefined;
          void stop(oldController, oldIterator).catch(() => {});

          // Restart triggers a new iteration version
          const targetVersion = ++node.version;
          startIteration(targetVersion).catch(() => {
             if (node.version !== targetVersion || disposed) void disposeInstance();
          });
        }
      } finally {
        node.flushing = false;
      }
    },
  };

  const instance: InternalFlowAtom<T> = {
    type: "atom",

    get disposed() { return disposed || isDisposed(this); },
    get error() { return errorValue; },
    get subscriberCount() { return subs.size; },
    
    get value() {
      if (disposed) throw new Error("Atom has been disposed");
      const ctx = getCurrentFormulaContext();
      if (ctx) ctx.dependencies.add(instance);
      return current;
    },
    get safeValue() { return current; },
    get prior() { return previous; },

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
        startIteration(node.version);
      }

      if (callback) subs.add(callback);
      activeSubCount++;

      const sub = createSubscription(async () => {
        if (callback) subs.delete(callback);
        subscriptions.delete(sub);
        if (--activeSubCount <= 0) await disposeInstance();
      });
      subscriptions.add(sub);
      return sub;
    },

    onError(handler: (error: any) => void): Subscription {
      if (disposed) return createSubscription(() => {});
      errorHandlers.add(handler);
      if (errorValue !== undefined) try { handler(errorValue); } catch {}
      return createSubscription(() => { errorHandlers.delete(handler); });
    },

    fail(err: any, errorOptions?: { terminate?: boolean }) {
      if (disposed) return;
      errorValue = normalizeError(err);
      for (const h of errorHandlers) try { h(errorValue); } catch {}
      if (options?.onError) try { options.onError(errorValue); } catch {}

      if (errorOptions?.terminate ?? false) {
        disposed = true;
        markDisposed(instance);
        getScheduler().remove(node);
        abortController?.abort();
        stop().catch(() => {}); // Best effort stop
        
        for (const h of disposeHandlers) Promise.resolve(h()).catch(() => {});
        disposeHandlers.clear();
        for (const s of subscriptions) s.unsubscribe();
        subscriptions.clear();
        subs.clear();
        errorHandlers.clear();
        clearDepSubscriptions();
      }
    },

    pipe(...ops: Operator<any, any>[]) { return pipeSource(this, ...ops); },
    [Symbol.asyncIterator]() { return iterate(this); },
    dispose() { void disposeInstance(); },
  };

  Object.defineProperty(instance, "_onDispose", { get: () => disposeHandlers, enumerable: false });
  registerWithCurrentScope(instance as any);
  return instance;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * atom() - Mutable State Node
 * ───────────────────────────────────────────────────────────────────────────*/

export function atom<T = any>(initialValue?: T, options?: AtomOptions): Atom<T> {
  const scope = getCurrentScope();
  const analog = scope !== null && getScopeMode(scope) === "analog" && !options?.discrete;
  
  const maxSubscribers = options?.maxSubscribers ?? 1000;
  const terminateOnError = options?.terminateOnError ?? false;
  const propagateErrors = options?.propagateErrors ?? true;

  const hasInitialValue = arguments.length > 0;
  let current = initialValue as T;
  let previous = initialValue as T;
  let disposed = false;
  let lastNotified = current;
  let errorValue: any = undefined;
  let isErrorState = false;

  const disposeHandlers = new Set<() => void>();
  const errorHandlers = new Set<(error: any) => void>();
  const subs = createSubscriberSet<T>(errorHandlers, analog);
  const subscriptions = new Set<Subscription>();

  const broadcast = () => subs.broadcast(current);

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

  const instance: Atom<T> & InternalAtomContainer = {
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
    get prior() { return previous; },

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

      const sub = createSubscription(() => {
        if (callback) subs.delete(callback);
        subscriptions.delete(sub);
      });
      subscriptions.add(sub);
      return sub;
    },

    onError(handler: (error: any) => void): Subscription {
      if (disposed) return createSubscription(() => {});
      errorHandlers.add(handler);
      if (errorValue !== undefined) try { handler(errorValue); } catch {}
      return createSubscription(() => { errorHandlers.delete(handler); });
    },

    pipe(...ops: Operator<any, any>[]) { return pipeSource(this, ...ops); },
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
        // Discrete: Immediate broadcast
        node.dirty = false;
        lastNotified = current;
        node.version++;
        broadcast();
        // Mark dirty for scheduler/test harness awareness (state changed)
        instance[MARK_DIRTY](); 
      }
    },

    fail(err: any, errorOptions?: { terminate?: boolean }) {
      if (disposed) return;
      errorValue = normalizeError(err);
      isErrorState = true;

      const shouldTerminate = errorOptions?.terminate ?? terminateOnError;
      for (const h of errorHandlers) try { h(errorValue); } catch {}
      if (options?.onError) try { options.onError(errorValue); } catch {}

      if (shouldTerminate) {
        disposed = true;
        markDisposed(instance);
        getScheduler().remove(node);
        
        for (const h of disposeHandlers) Promise.resolve(h()).catch(() => {});
        disposeHandlers.clear();
        for (const s of subscriptions) s.unsubscribe();
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
      for (const s of subscriptions) s.unsubscribe();
      subscriptions.clear();
      subs.clear();
      errorHandlers.clear();
    },
  };

  Object.defineProperty(instance, "_onDispose", { get: () => disposeHandlers, enumerable: false });
  registerWithCurrentScope(instance as any);
  if (hasInitialValue) markAtomAsEmitted(instance as any);
  return instance;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * derived() - Computed Node
 * ───────────────────────────────────────────────────────────────────────────*/

export function derived<T>(fn: () => T, options?: AtomOptions): AtomBase<T> {
  const scope = getCurrentScope();
  const analog = scope !== null && getScopeMode(scope) === "analog" && !options?.discrete;
  
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

  const errorHandlers = new Set<(error: any) => void>();
  const subs = createSubscriberSet<T>(errorHandlers, analog);
  const dependencies = new Set<InternalAtomContainer>();
  const depSubscriptions = new Map<InternalAtomContainer, Subscription>();

  const broadcast = () => subs.broadcast(current);

  /** Core computation: tracks deps, runs fn, returns value */
  const compute = (): T => {
    if (running) throw new Error("Circular dependency detected in derived()");

    const oldDeps = new Set(depSubscriptions.keys());
    dependencies.clear();
    running = true;

    try {
      const { result, context } = (function withTracking() {
        const ctx = pushFormulaContext();
        try {
          return { result: fn(), context: ctx };
        } finally {
          popFormulaContext();
        }
      })();

      initialized = true;

      // Cleanup stale deps
      for (const dep of oldDeps) {
        if (!context.dependencies.has(dep)) {
          depSubscriptions.get(dep)?.unsubscribe();
          depSubscriptions.delete(dep);
        }
      }

      // Setup new deps
      let maxDepth = -1;
      for (const dep of context.dependencies) {
        dependencies.add(dep);
        if (dep[NODE]?.depth > maxDepth) maxDepth = dep[NODE].depth;

        if (!depSubscriptions.has(dep)) {
          const handler = () => {
            if (disposed) return;

            if (node.isAnalog && subs.size === 0) {
              node.dirty = true;
              return;
            }

            instance[MARK_DIRTY]();
          };
          addAtomChangeHandler(dep as any, handler);
          depSubscriptions.set(dep, createSubscription(() => {
            removeAtomChangeHandler(dep as any, handler);
          }));
        }
      }
      node.depth = maxDepth + 1;
      return result;
    } finally {
      running = false;
    }
  };

  /** Performs state transition if computation changes value */
  const recompute = () => {
    const next = compute();
    node.dirty = false;

    isErrorState = false;
    errorValue = undefined;

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
      node.dirty = false; // Reset dirty even on error
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

  const instance: AtomBase<T> & InternalAtomContainer = {
    type: "atom",

    get disposed() { return disposed || isDisposed(this); },
    get error() { return errorValue; },
    get subscriberCount() { return subs.size; },

    get value() {
      if (disposed) throw new Error("Atom has been disposed");
      if (running) throw new Error("Circular dependency detected in derived()");

      const ctx = getCurrentFormulaContext();
      if (ctx) ctx.dependencies.add(instance);

      // Lazy pull-to-refresh
      if (node.dirty) {
        try {
          recompute();
          // In analog mode, value reads make the result live but still defer
          // subscriber notification to the scheduler.
          if (notifyPending && subs.size > 0) instance[MARK_DIRTY]();
        } catch (err) {
          errorValue = normalizeError(err);
          isErrorState = true;
          if (terminateOnError) {
            instance.dispose();
            throw err;
          }
        }
      }

      // Eager initialization
      if (!initialized) {
        try {
          current = compute();
          previous = current;
          markAtomAsEmitted(instance as any);
        } catch (err) {
          errorValue = normalizeError(err);
          isErrorState = true;
          if (terminateOnError) {
            instance.dispose();
            throw err;
          }
        }
      }

      if (isErrorState && errorValue) throw errorValue;
      return current;
    },

    get safeValue() {
      try { return this.value; } catch { return current; }
    },
    get prior() {
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
      try { this.value; } catch {} // Ensure initialization
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

    pipe(...ops: Operator<any, any>[]) { return pipeSource(this, ...ops); },
    [Symbol.asyncIterator]() { return iterate(this); },

    dispose() {
      if (disposed) return;
      disposed = true;
      markDisposed(instance);
      getScheduler().remove(node);
      
      for (const sub of depSubscriptions.values()) sub.unsubscribe();
      depSubscriptions.clear();
      dependencies.clear();
      subs.clear();
      errorHandlers.clear();
    },
  };

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