import { iterate } from "./iterate";
import { type MaybePromise, type Operator } from "./operator";
import { pipe as pipeSource } from "./pipe";

import {
  getCurrentScope,
  getScopeStrobe,
  markAtomAsEmitted,
  registerAnalogAtom,
  registerWithCurrentScope,
  unregisterAnalogAtom,
} from "./scope";
import { createSubscription, type Subscription } from "./subscription";

/* ─────────────────────────────────────────────────────────────────────────────
 * Architectural Symbols (Hidden Engine Boundaries)
 * ───────────────────────────────────────────────────────────────────────────*/

export const NODE = Symbol("engine.node");
export const MARK_DIRTY = Symbol("engine.markDirty");
export const FLUSH = Symbol("engine.flush");

export interface AtomOptions {
  discrete?: boolean;
  maxSubscribers?: number;
  onError?: (error: any) => void;
  terminateOnError?: boolean;
  propagateErrors?: boolean;
}

/** Public API Contract - completely free of engine leaks */
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

/** Hidden Graph Node containing full reactive state metadata */
interface AtomNode {
  depth: number;
  version: number;
  dirty: boolean;
  isResource: boolean;
  isAnalog: boolean;
  flush: () => void;
  /** Track if flush is currently in progress to prevent reentrancy */
  flushing?: boolean;
}

/** Engine-facing container wrapper interface */
interface InternalAtomContainer {
  [NODE]: AtomNode;
  [MARK_DIRTY](): void;
  [FLUSH](): void;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Scheduler - Isolated for Multi-tenancy & Testing
 * ───────────────────────────────────────────────────────────────────────────*/

export interface Scheduler {
  transaction<T>(fn: () => T): T;
  queueFlush(node: AtomNode): void;
  flush(): void;
  remove(node: AtomNode): void;
  /** Add immediate flush for discrete updates */
  flushImmediately(node: AtomNode): void;
  get isDirty(): boolean;
  get depth(): number;
}

class DefaultScheduler implements Scheduler {
  private txDepth = 0;
  private isBatchScheduled = false;
  private dirtyNodes = new Set<AtomNode>();
  /** Track nodes being flushed to prevent reentrancy */
  private flushingNodes = new Set<AtomNode>();

  transaction<T>(fn: () => T): T {
    this.txDepth++;
    try {
      return fn();
    } finally {
      this.txDepth--;
      if (this.txDepth === 0) {
        this.flush();
      }
    }
  }

  flush(): void {
    if (this.txDepth > 0) return;

    this.txDepth++;
    try {
      while (this.dirtyNodes.size > 0) {
        const sorted = Array.from(this.dirtyNodes).sort((a, b) => a.depth - b.depth);
        this.dirtyNodes.clear();

        for (const node of sorted) {
          if (node.dirty && !this.flushingNodes.has(node)) {
            try {
              this.flushingNodes.add(node);
              node.flush();
              node.dirty = false;
            } catch (error) {
              console.error("Error flushing node:", error);
            } finally {
              this.flushingNodes.delete(node);
            }
          }
        }
      }
    } finally {
      this.txDepth--;
    }
    this.isBatchScheduled = false;
  }

  /** Implement immediate flush for discrete updates */
  flushImmediately(node: AtomNode): void {
    if (this.txDepth > 0) {
      this.queueFlush(node);
      return;
    }

    if (node.dirty && !this.flushingNodes.has(node)) {
      try {
        this.flushingNodes.add(node);
        node.flush();
        node.dirty = false;
      } catch (error) {
        console.error("Error flushing node:", error);
      } finally {
        this.flushingNodes.delete(node);
      }
    }
  }

  queueFlush(node: AtomNode): void {
    this.dirtyNodes.add(node);

    if (this.txDepth > 0) return;

    if (!this.isBatchScheduled) {
      this.isBatchScheduled = true;
      queueMicrotask(() => {
        if (this.txDepth === 0) {
          this.flush();
        }
      });
    }
  }

  remove(node: AtomNode): void {
    this.dirtyNodes.delete(node);
    this.flushingNodes.delete(node);
  }

  get isDirty(): boolean {
    return this.dirtyNodes.size > 0;
  }

  get depth(): number {
    return this.txDepth;
  }
}

let currentScheduler: Scheduler = new DefaultScheduler();

export function setScheduler(scheduler: Scheduler): void {
  currentScheduler = scheduler;
}

export function getScheduler(): Scheduler {
  return currentScheduler;
}

export function transaction<T>(fn: () => T): T {
  return currentScheduler.transaction(fn);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Active Formula Stack
 * ───────────────────────────────────────────────────────────────────────────*/

const activeFormulaStack: { dependencies: Set<InternalAtomContainer> }[] = [];

function pushFormulaContext(): { dependencies: Set<InternalAtomContainer> } {
  const context = { dependencies: new Set<InternalAtomContainer>() };
  activeFormulaStack.push(context);
  return context;
}

function popFormulaContext(): void {
  activeFormulaStack.pop();
}

function getCurrentFormulaContext(): { dependencies: Set<InternalAtomContainer> } | null {
  return activeFormulaStack.length > 0 ? activeFormulaStack[activeFormulaStack.length - 1] : null;
}

function subscribeToUpdates(atom: AtomBase<any>, handler: () => void): Subscription {
  const sub = atom.subscribe(() => {
    handler();
  });
  return sub;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Add WeakMap for tracking disposed state to prevent memory leaks
 * ───────────────────────────────────────────────────────────────────────────*/

const disposedWeakMap = new WeakMap<object, boolean>();

function isDisposed(obj: object): boolean {
  return disposedWeakMap.get(obj) === true;
}

function markDisposed(obj: object): void {
  disposedWeakMap.set(obj, true);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * flow() - Async Resource Lifecycle Node
 * ───────────────────────────────────────────────────────────────────────────*/

interface InternalFlowAtom<T> extends AtomBase<T>, InternalAtomContainer {
  fail(err: any, options?: { terminate?: boolean }): void;
}

export function flow<T>(
  source: AsyncIterable<T> | Iterable<T> | ((signal?: AbortSignal) => AsyncIterable<T> | Iterable<T>),
  initialValue?: T,
  options?: AtomOptions
): AtomBase<T> {
  const maxSubscribers = options?.maxSubscribers ?? 1000;
  let current = initialValue as T;
  let previous = initialValue as T;
  let disposed = false;
  let started = false;
  let activeSubCount = 0;
  let errorValue: any = undefined;
  const disposeHandlers = new Set<() => void>();
  const errorHandlers = new Set<(error: any) => void>();

  const subs = new Set<(value: T) => MaybePromise>();
  const subscriptions = new Set<Subscription>();

  const dependencies = new Set<InternalAtomContainer>();
  const depSubscriptions = new Map<InternalAtomContainer, Subscription>();

  const clearDepSubscriptions = () => {
    const values = Array.from(depSubscriptions.values());
    for (const sub of values) sub.unsubscribe();
    depSubscriptions.clear();
    dependencies.clear();
  };

  const broadcastNow = (value: T) => {
    // Take a snapshot of handlers to prevent mutation during iteration
    const handlers = Array.from(subs);
    for (const cb of handlers) {
      try {
        cb(value);
      } catch (error: unknown) {
        // Don't swallow errors, propagate them
        for (const handler of Array.from(errorHandlers)) {
          try { handler(error); } catch { /* ignore nested errors */ }
        }
      }
    }
  };

  const notifyError = (err: any) => {
    errorValue = err instanceof Error ? err : new Error(String(err));
    const handlers = Array.from(errorHandlers);
    for (const handler of handlers) {
      try { handler(errorValue); } catch { /* ignore */ }
    }
    if (options?.onError) {
      try { options.onError(errorValue); } catch { /* ignore */ }
    }
  };

  const notify = (value: T) => {
    if (disposed) return;
    previous = current;
    current = value;
    markAtomAsEmitted(instance as any);
    broadcastNow(current);
  };

  let iterator: AsyncIterator<T> | Iterator<T> | undefined;
  let cancelled = false;
  let cleanup: () => void | Promise<void> = () => {};
  let disposePromise: Promise<void> | null = null;
  let abortController: AbortController | undefined;
  let iterationAbortController: AbortController | undefined;
  /** Track iteration version to prevent stale iterations */
  let currentIterationVersion = 0;

  const stop = async () => {
    cancelled = true;
    iterationAbortController?.abort();
    try {
      await cleanup();
    } catch {
      // Ignore cleanup errors during stop
    }
  };

  const disposeInstance = async (): Promise<void> => {
    if (disposed) return;
    if (disposePromise) return disposePromise;

    // Create promise and store it before any async work
    disposePromise = (async () => {
      disposed = true;
      markDisposed(instance);
      node.version++;
      subs.clear();
      activeSubCount = 0;
      clearDepSubscriptions();

      try { await stop(); } catch { /* ignore */ }
      const handlers = Array.from(disposeHandlers);
      for (const handler of handlers) {
        try { await Promise.resolve(handler()); } catch { /* ignore */ }
      }
      disposeHandlers.clear();
      for (const sub of Array.from(subscriptions)) {
        try { await sub.unsubscribe(); } catch { /* ignore */ }
      }
      subscriptions.clear();
      const scheduler = getScheduler();
      scheduler.remove(node);
    })();

    try {
      await disposePromise;
    } finally {
      // Only clear after the promise resolves
      disposePromise = null;
    }
  };

  const restart = async (): Promise<void> => {
    if (disposed || activeSubCount <= 0) return;

    const currentVersion = ++node.version;
    currentIterationVersion = currentVersion;

    cancelled = true;
    iterationAbortController?.abort();
    if (iterator && typeof (iterator as any).return === "function") {
      try { await (iterator as any).return(); } catch { /* ignore */ }
    }

    if (currentVersion !== node.version) return;

    iterator = undefined;
    clearDepSubscriptions();
    cancelled = false;
    startIteration(currentVersion);
  };

  const startIteration = (version: number) => {
    // Check if this iteration is still current
    if (disposed || version !== node.version || version !== currentIterationVersion) return;

    iterationAbortController = new AbortController();
    abortController = new AbortController();

    const abortSignal = abortController.signal;
    const iterationSignal = iterationAbortController.signal;

    const formulaContext = pushFormulaContext();

    let iterable: AsyncIterable<T> | Iterable<T>;
    try {
      if (typeof source === "function") {
        const result = (source as (signal?: AbortSignal) => AsyncIterable<T> | Iterable<T>)(abortSignal);
        iterable = result;
      } else {
        iterable = source;
      }
    } catch (err: unknown) {
      popFormulaContext();
      instance.fail(err);
      void disposeInstance();
      return;
    }

    // Check if this iteration is still current after potential async operations
    if (version !== node.version || version !== currentIterationVersion) {
      popFormulaContext();
      return;
    }

    const asyncIter = (iterable as any)[Symbol.asyncIterator];
    const syncIter = (iterable as any)[Symbol.iterator];

    if (asyncIter) {
      iterator = asyncIter.call(iterable);
    } else if (syncIter) {
      iterator = syncIter.call(iterable);
    }

    if (!iterator) {
      popFormulaContext();
      abortController.abort();
      notifyError(new Error("Source is not iterable"));
      void disposeInstance();
      return;
    }

    cleanup = () => {
      if (!iterator) return Promise.resolve();
      cancelled = true;
      iterationAbortController?.abort();
      abortController?.abort();
      if (typeof (iterator as any).return === "function") {
        try {
          const result = (iterator as any).return();
          return result instanceof Promise ? result : Promise.resolve(result);
        } catch { /* ignore */ }
      }
      return Promise.resolve();
    };

    let maxDepth = -1;
    const deps = formulaContext.dependencies;
    for (const dep of deps) {
      dependencies.add(dep);
      if (dep[NODE] && dep[NODE].depth > maxDepth) {
        maxDepth = dep[NODE].depth;
      }
      if (!depSubscriptions.has(dep)) {
        depSubscriptions.set(
          dep,
          subscribeToUpdates(dep as any, () => {
            if (disposed || activeSubCount <= 0) return;
            instance[MARK_DIRTY]();
          })
        );
      }
    }
    node.depth = maxDepth + 1;

    popFormulaContext();

    const runIteration = async () => {
      try {
        let result = await iterator!.next();

        // Check currentIterationVersion in the loop
        while (!cancelled && version === node.version && version === currentIterationVersion && !iterationSignal.aborted && !result.done) {
          notify(result.value);
          // Use queueMicrotask consistently
          await new Promise<void>(resolve => queueMicrotask(resolve));

          result = await iterator!.next();
        }

        // Only dispose if this is still the current iteration
        if (!cancelled && version === node.version && version === currentIterationVersion && !iterationSignal.aborted && !disposed) {
          await disposeInstance();
        }
      } catch (err: unknown) {
        // Only handle errors if this iteration is still current
        if (version === node.version && version === currentIterationVersion && !disposed) {
          notifyError(err);
          instance.fail(err, { terminate: true });
        }
      }
    };

    runIteration().catch(() => {
      // Only dispose if this is still the current iteration
      if (version !== node.version || version !== currentIterationVersion || disposed) {
        void disposeInstance();
      }
    });
  };

  const start = () => {
    if (started || disposed) return;
    started = true;
    startIteration(node.version);
  };

  const node: AtomNode = {
    depth: 0,
    version: 0,
    dirty: false,
    flushing: false,
    isResource: true,
    isAnalog: false,
    flush() {
      if (disposed || !node.dirty || node.flushing) return;
      node.flushing = true;
      try {
        node.dirty = false;
        void restart();
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
      const context = getCurrentFormulaContext();
      if (context) context.dependencies.add(instance);
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
    [FLUSH]() {
      node.flush();
    },

    subscribe(callback) {
      if (disposed) return createSubscription(() => {});

      if (subs.size >= maxSubscribers) {
        throw new Error(`Maximum subscriber limit (${maxSubscribers}) reached`);
      }

      if (!started) start();

      if (callback) subs.add(callback);
      activeSubCount++;

      const sub = createSubscription(() => {
        if (callback) subs.delete(callback);
        subscriptions.delete(sub);
        activeSubCount--;
        if (activeSubCount <= 0) {
          return disposeInstance();
        }
        return undefined;
      });
      subscriptions.add(sub);
      return sub;
    },

    onError(handler: (error: any) => void): Subscription {
      if (disposed) return createSubscription(() => {});
      errorHandlers.add(handler);

      if (errorValue !== undefined) {
        try { handler(errorValue); } catch { /* ignore */ }
      }

      return createSubscription(() => {
        errorHandlers.delete(handler);
      });
    },

    fail(err: any, errorOptions?: { terminate?: boolean }) {
      if (disposed) return;

      errorValue = err instanceof Error ? err : new Error(String(err));
      const shouldTerminate = errorOptions?.terminate ?? false;

      for (const handler of Array.from(errorHandlers)) {
        try { handler(errorValue); } catch { /* ignore */ }
      }
      if (options?.onError) {
        try { options.onError(errorValue); } catch { /* ignore */ }
      }

      if (shouldTerminate) {
        // Stop the iterator immediately
        cancelled = true;
        iterationAbortController?.abort();
        abortController?.abort();
        
        // Try to clean up the iterator
        if (iterator && typeof (iterator as any).return === "function") {
          try {
            const result = (iterator as any).return();
            if (result instanceof Promise) {
              result.catch(() => {}); // Ignore errors
            }
          } catch { /* ignore */ }
        }
        
        // Mark as disposed and clean up synchronously
        disposed = true;
        markDisposed(instance);
        const scheduler = getScheduler();
        scheduler.remove(node);

        // Clean up all handlers and subscriptions
        for (const handler of Array.from(disposeHandlers)) {
          try { Promise.resolve(handler()); } catch { /* ignore */ }
        }
        disposeHandlers.clear();
        for (const sub of Array.from(subscriptions)) {
          try { sub.unsubscribe(); } catch { /* ignore */ }
        }
        subscriptions.clear();
        subs.clear();
        errorHandlers.clear();
        clearDepSubscriptions();
        
        // Clear the dispose promise if it exists
        disposePromise = null;
      }
    },

    pipe(...ops: Operator<any, any>[]) { return pipeSource(this, ...ops); },
    [Symbol.asyncIterator]() {
      return iterate(this);
    },
    dispose() { void disposeInstance(); },
  };

  Object.defineProperty(instance, "_onDispose", { get() { return disposeHandlers; }, enumerable: false });

  registerWithCurrentScope(instance as any);
  return instance;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * atom() - Standard User-Mutated Mutable Node
 * ───────────────────────────────────────────────────────────────────────────*/

export function atom<T = any>(initialValue?: T, options?: AtomOptions): Atom<T> {
  const scope = getCurrentScope();
  const strobe = scope ? getScopeStrobe(scope) : undefined;
  const analog = strobe !== undefined && strobe > 0 && !options?.discrete;
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

  const subs = new Set<(value: T) => MaybePromise>();
  const subscriptions = new Set<Subscription>();

  const broadcastNow = () => {
    const snap = current;
    const handlers = Array.from(subs);
    for (const cb of handlers) {
      try {
        cb(snap);
      } catch (err) {
        // Propagate errors to error handlers
        for (const handler of Array.from(errorHandlers)) {
          try { handler(err as Error); } catch { /* ignore */ }
        }
      }
    }
  };

  const strobeFlush = () => {
    if (!node.dirty || disposed) return;
    node.dirty = false;
    if (Object.is(lastNotified, current)) return;
    lastNotified = current;
    node.version++;
    broadcastNow();
  };

  const node: AtomNode = {
    depth: 0,
    version: 0,
    dirty: false,
    flushing: false,
    isResource: false,
    isAnalog: analog,
    flush() {
      if (disposed || !node.dirty || node.flushing) return;
      if (node.isAnalog) return;

      node.flushing = true;
      try {
        node.dirty = false;
        if (Object.is(lastNotified, current)) return;
        lastNotified = current;
        node.version++;
        broadcastNow();
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
      if (isErrorState && errorValue !== undefined) {
        throw errorValue;
      }
      const context = getCurrentFormulaContext();
      if (context) context.dependencies.add(instance);
      return current;
    },

    get safeValue() {
      return current;
    },

    get prior() { return previous; },

    [NODE]: node,
    [MARK_DIRTY]() {
      if (disposed || node.dirty) return;
      node.dirty = true;
      if (node.isAnalog) return;
      getScheduler().queueFlush(node);
    },
    [FLUSH]() {
      node.flush();
    },

    subscribe(callback) {
      if (disposed) return createSubscription(() => {});

      if (subs.size >= maxSubscribers) {
        throw new Error(`Maximum subscriber limit (${maxSubscribers}) reached`);
      }

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

      if (errorValue !== undefined) {
        try { handler(errorValue); } catch { /* ignore */ }
      }

      return createSubscription(() => {
        errorHandlers.delete(handler);
      });
    },

    pipe(...ops: Operator<any, any>[]) { return pipeSource(this, ...ops); },
    [Symbol.asyncIterator]() { return iterate(this); },

    next(value: T) {
      if (disposed) return;

      if (isErrorState) {
        isErrorState = false;
        errorValue = undefined;
      }

      previous = current;
      current = value;

      // Analog mode or inside a transaction: queue for batched flush.
      // Otherwise (discrete, outside transaction): broadcast synchronously.
      if (node.isAnalog || getScheduler().depth > 0) {
        instance[MARK_DIRTY]();
      } else {
        node.dirty = false;
        lastNotified = current;
        node.version++;
        broadcastNow();
        // Keep the scheduler aware so test schedulers can observe dirty state
        // and flush it even though the broadcast already happened.
        instance[MARK_DIRTY]();
      }
    },

    fail(err: any, errorOptions?: { terminate?: boolean }) {
      if (disposed) return;

      errorValue = err instanceof Error ? err : new Error(String(err));
      isErrorState = true;

      const shouldTerminate = errorOptions?.terminate ?? terminateOnError;

      for (const handler of Array.from(errorHandlers)) {
        try { handler(errorValue); } catch { /* ignore */ }
      }
      if (options?.onError) {
        try { options.onError(errorValue); } catch { /* ignore */ }
      }

      if (shouldTerminate) {
        disposed = true;
        markDisposed(instance);
        unregisterAnalogAtom(instance as any);
        const scheduler = getScheduler();
        scheduler.remove(node);

        for (const handler of Array.from(disposeHandlers)) {
          try { Promise.resolve(handler()); } catch { /* ignore */ }
        }
        disposeHandlers.clear();
        for (const sub of Array.from(subscriptions)) {
          try { sub.unsubscribe(); } catch { /* ignore */ }
        }
        subscriptions.clear();
        subs.clear();
        errorHandlers.clear();
      } else {
        if (propagateErrors) {
          instance[MARK_DIRTY]();
        }
      }
    },

    recover() {
      if (disposed || !isErrorState) return;
      isErrorState = false;
      errorValue = undefined;
      instance[MARK_DIRTY]();
    },

    clearError() {
      this.recover?.();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      markDisposed(instance);
      unregisterAnalogAtom(instance as any);
      const scheduler = getScheduler();
      scheduler.remove(node);
      for (const handler of Array.from(disposeHandlers)) {
        try { Promise.resolve(handler()); } catch { /* ignore */ }
      }
      disposeHandlers.clear();
      for (const sub of Array.from(subscriptions)) {
        try { sub.unsubscribe(); } catch { /* ignore */ }
      }
      subscriptions.clear();
      subs.clear();
      errorHandlers.clear();
    },
  };

  Object.defineProperty(instance, "_onDispose", { get() { return disposeHandlers; }, enumerable: false });

  registerWithCurrentScope(instance as any);
  if (hasInitialValue) markAtomAsEmitted(instance as any);
  if (analog) registerAnalogAtom(instance as any, strobeFlush);

  return instance;
}

export function discrete<T>(initialValue?: T, options?: AtomOptions): Atom<T> {
  return atom(initialValue, { ...options, discrete: true });
}

/* ─────────────────────────────────────────────────────────────────────────────
 * derived() - Synchronous Computed Pure Node
 * ───────────────────────────────────────────────────────────────────────────*/

export function derived<T>(fn: () => T, options?: AtomOptions): AtomBase<T> {
  const scope = getCurrentScope();
  const strobe = scope ? getScopeStrobe(scope) : undefined;
  const analog = strobe !== undefined && strobe > 0 && !options?.discrete;
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
  const subs = new Set<(value: T) => void>();
  const errorHandlers = new Set<(error: any) => void>();
  const dependencies = new Set<InternalAtomContainer>();
  const depSubscriptions = new Map<InternalAtomContainer, Subscription>();
  /** Track if we're currently recomputing to prevent cycles */
  let recomputing = false;

  const broadcastNow = () => {
    const snap = current;
    const handlers = Array.from(subs);
    for (const cb of handlers) {
      try {
        cb(snap);
      } catch (err) {
        for (const handler of Array.from(errorHandlers)) {
          try { handler(err as Error); } catch { /* ignore */ }
        }
      }
    }
  };

  const notifyError = (err: any) => {
    errorValue = err instanceof Error ? err : new Error(String(err));
    isErrorState = true;
    for (const handler of Array.from(errorHandlers)) {
      try { handler(errorValue); } catch { /* ignore */ }
    }
    if (options?.onError) {
      try { options.onError(errorValue); } catch { /* ignore */ }
    }
  };

  const ensureInit = () => {
    if (initialized || disposed || running || recomputing) return;
    recomputing = true;
    try {
      current = run();
      if (!initialized) previous = current;
      isErrorState = false;
      errorValue = undefined;
      if (analog) {
        node.dirty = false;
      }
      markAtomAsEmitted(instance as any);
    } catch (err) {
      notifyError(err);
      if (terminateOnError) {
        throw err;
      }
    } finally {
      recomputing = false;
    }
  };

  const run = (): T => {
    if (running) {
      popFormulaContext();
      throw new Error("Circular dependency detected in derived()");
    }

    const oldDeps = new Set(depSubscriptions.keys());
    dependencies.clear();

    running = true;
    const formulaContext = pushFormulaContext();
    let result: T;
    try {
      result = fn();
    } catch (err) {
      if (terminateOnError) {
        setTimeout(() => instance.dispose(), 0);
      }
      throw err;
    } finally {
      popFormulaContext();
      running = false;
      initialized = true;
    }

    for (const dep of oldDeps) {
      if (!dependencies.has(dep)) {
        depSubscriptions.get(dep)?.unsubscribe();
        depSubscriptions.delete(dep);
      }
    }

    let maxDepth = -1;
    for (const dep of formulaContext.dependencies) {
      dependencies.add(dep);
      if (dep[NODE] && dep[NODE].depth > maxDepth) {
        maxDepth = dep[NODE].depth;
      }
      if (!depSubscriptions.has(dep)) {
        depSubscriptions.set(
          dep,
          subscribeToUpdates(dep as any, () => {
            if (disposed) return;
            instance[MARK_DIRTY]();
          })
        );
      }
    }

    node.depth = maxDepth + 1;
    return result;
  };

  const flushAnalog = () => {
    if (!node.dirty || disposed || node.flushing) return;

    node.flushing = true;
    try {
      const next = run();
      node.dirty = false;

      isErrorState = false;
      errorValue = undefined;

      if (Object.is(current, next)) return;

      previous = current;
      current = next;
      if (!Object.is(previous, current)) node.version++;
      if (subs.size > 0) broadcastNow();
    } catch (err) {
      notifyError(err);
      node.dirty = false;

      if (!terminateOnError && propagateErrors) {
        broadcastNow();
      }
    } finally {
      node.flushing = false;
    }
  };

  const node: AtomNode = {
    depth: 0,
    version: 0,
    dirty: false,
    flushing: false,
    isResource: false,
    isAnalog: analog,
    flush() {
      if (disposed || !node.dirty || node.flushing) return;
      if (node.isAnalog) return;

      node.flushing = true;
      try {
        const next = run();
        node.dirty = false;

        isErrorState = false;
        errorValue = undefined;

        if (Object.is(current, next)) return;

        previous = current;
        current = next;
        if (!Object.is(previous, current)) node.version++;
        if (subs.size > 0) broadcastNow();
      } catch (err) {
        notifyError(err);
        node.dirty = false;

        if (!terminateOnError && propagateErrors) {
          broadcastNow();
        }
      } finally {
        node.flushing = false;
      }
    },
  };

  const instance: AtomBase<T> & InternalAtomContainer = {
    type: "atom",

    get disposed() { return disposed || isDisposed(this); },

    get error() { return errorValue; },

    get subscriberCount() { return subs.size; },

    get value() {
      if (disposed) throw new Error("Atom has been disposed");

      if (running) {
        throw new Error("Circular dependency detected in derived()");
      }

      const context = getCurrentFormulaContext();
      if (context) context.dependencies.add(instance);

      // Check and attempt to recompute BEFORE checking error state
      if (node.dirty && !node.isAnalog && !recomputing) {
        recomputing = true;
        try {
          const next = run();
          node.dirty = false;

          isErrorState = false;
          errorValue = undefined;

          if (!Object.is(current, next)) {
            previous = current;
            current = next;
            node.version++;
            if (subs.size > 0) {
              broadcastNow();
            }
          }
        } catch (err) {
          notifyError(err);
          if (terminateOnError) {
            throw err;
          }
        } finally {
          recomputing = false;
        }
      }

      // Ensure initialization if needed
      ensureInit();

      // Now check error state after potential recovery
      if (isErrorState && errorValue !== undefined) {
        throw errorValue;
      }

      return current;
    },

    get safeValue() {
      // Try to recompute if dirty, but don't throw on error
      if (node.dirty && !node.isAnalog && !recomputing) {
        recomputing = true;
        try {
          const next = run();
          node.dirty = false;
          isErrorState = false;
          errorValue = undefined;
          
          if (!Object.is(current, next)) {
            previous = current;
            current = next;
            node.version++;
            if (subs.size > 0) {
              broadcastNow();
            }
          }
        } catch (err) {
          // Keep old value on error, but update error state
          notifyError(err);
          node.dirty = false;
        } finally {
          recomputing = false;
        }
      }
      
      ensureInit();
      return current;
    },

    get prior() {
      try {
        this.value;
        return previous;
      } catch {
        return previous;
      }
    },

    [NODE]: node,
    [MARK_DIRTY]() {
      if (disposed || node.dirty) return;
      node.dirty = true;
      if (node.isAnalog) return;
      getScheduler().queueFlush(node);
    },
    [FLUSH]() {
      node.flush();
    },

    subscribe(callback) {
      ensureInit();

      if (subs.size >= maxSubscribers) {
        throw new Error(`Maximum subscriber limit (${maxSubscribers}) reached`);
      }

      if (callback) subs.add(callback);

      return createSubscription(() => {
        if (callback) subs.delete(callback);
      });
    },

    onError(handler: (error: any) => void): Subscription {
      if (disposed) return createSubscription(() => {});
      errorHandlers.add(handler);

      if (errorValue !== undefined) {
        try { handler(errorValue); } catch { /* ignore */ }
      }

      return createSubscription(() => {
        errorHandlers.delete(handler);
      });
    },

    pipe(...ops: Operator<any, any>[]) { return pipeSource(this, ...ops); },
    [Symbol.asyncIterator]() { return iterate(this); },

    dispose() {
      if (disposed) return;
      ensureInit();
      disposed = true;
      markDisposed(instance);
      unregisterAnalogAtom(instance as any);
      const scheduler = getScheduler();
      scheduler.remove(node);
      for (const sub of depSubscriptions.values()) sub.unsubscribe();
      depSubscriptions.clear();
      dependencies.clear();
      subs.clear();
      errorHandlers.clear();
    },
  };

  registerWithCurrentScope(instance as any);
  if (analog) registerAnalogAtom(instance as any, flushAnalog);

  return instance;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Test Harness - For Multi-tenancy & Testing
 * ───────────────────────────────────────────────────────────────────────────*/

export function createTestScheduler(): Scheduler {
  return new DefaultScheduler();
}

export function createTestEnvironment() {
  const scheduler = createTestScheduler();
  const originalScheduler = getScheduler();

  return {
    scheduler,

    run<T>(fn: () => T): T {
      setScheduler(scheduler);
      try {
        return fn();
      } finally {
        setScheduler(originalScheduler);
      }
    },

    flush() {
      scheduler.flush();
    },

    reset() {
      setScheduler(originalScheduler);
    }
  };
}