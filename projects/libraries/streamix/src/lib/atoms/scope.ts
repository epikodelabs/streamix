import {
  createContainer,
  globalContainer,
  type Container,
  type Factory,
  type RegistrationOptions,
  type Token,
} from "../ioc/container";
import { normalizeError } from "../utils/helpers";
import { atom, getCurrentFormulaContext, Writable, type Atom } from "./atom";
import type { Subscription } from "./subscription";
import { getGlobalScope, isScope, resolveMode, type RootScope } from "./root";

// Define a recursive type to unwrap atom values and handle nested scopes
type UnwrapSnapshotValues<T> = {
  [K in keyof T]: T[K] extends Scope & Record<string, any>
    ? UnwrapSnapshotValues<T[K]>
    : T[K] extends { value: infer U }
      ? U
      : T[K] extends Record<string, any>
        ? UnwrapSnapshotValues<T[K]>
        : T[K];
};

type UnwrapScopeValues<T> = {
  [K in keyof T]: T[K] extends Atom<infer U>
    ? U
    : T[K] extends Scope
      ? T[K]
      : T[K];
};

type AtomOf<T> = T extends Writable<infer U>
  ? Writable<U>
  : T extends Atom<infer U>
    ? Atom<U>
    : never;

type AtomValueOf<T> = T extends Atom<infer U> ? U : never;

/**
 * Interface definition for a lifecycle scope execution context.
 */
export interface Scope {
  /** Unique discriminator for the runtime context. */
  type: "scope";
  /** State container for active elements captured by this window. */
  atoms: Set<Atom<any> | Scope>;
  /** Registered callbacks triggered when this context collapses. */
  cleanups: Set<() => void>;
  /** Scope mode: 'discrete' or 'analog' */
  mode: "discrete" | "analog";
  /** Parent scope reference */
  parent: Scope | RootScope | null;
  /** IoC container for this scope. Inherits from the parent scope's container. */
  container: Container;
  /**
   * Reactive atom that tracks whether the scope is still loading.
   * True until every owned atom (and nested scope) has emitted at least one value.
   */
  loading: Writable<boolean>;
  /** Returns a plain object snapshot of all current atom values. */
  snapshot(): this extends (infer T extends Record<string, any>) ? UnwrapSnapshotValues<T> : Record<string, any>;
  /** Disposes the scope and all of its atoms. */
  dispose(): void;
  /** @internal Number of atoms in this scope's subtree that have not yet emitted. */
  _pendingCount: number;
  /** @internal Factory keys that belong in snapshots. */
  _exports: Set<string | symbol>;
  /** @internal True once the scope has begun disposal. */
  _disposed: boolean;
  /** @internal Original factory results for raw atom access. */
  _rawState: Record<string | symbol, any>;
}

// Active execution context tracking frames
let currentScope: Scope | null = null;

// Tracks which scope each registered atom belongs to.
const atomScopeRegistry = new WeakMap<Atom<any>, Scope>();

// Tracks atoms that have produced at least one value.
const emittedAtomsRegistry = new WeakSet<Atom<any>>();

/* ── Active Window Accessors ──────────────────────────────────────────────── */

export function getCurrentScope(): Scope | null {
  return currentScope;
}

export function getScopeMode(scope: Scope): "discrete" | "analog" {
  return scope.mode ?? "discrete";
}

export function setCurrentScope(scope: Scope | null): Scope | null {
  const previous = currentScope;
  currentScope = scope;
  return previous;
}

/* ── IoC Helpers ──────────────────────────────────────────────────────────── */

/**
 * Registers a service on the current scope's container.
 *
 * Falls back to the global container when called outside of a scope.
 */
export function provide<T>(
  token: Token<T>,
  factory: Factory<T>,
  options?: RegistrationOptions<T>
): void {
  const scope = getCurrentScope();
  const container = scope?.container ?? globalContainer;
  container.register(token, factory, options);
}

/**
 * Resolves a required service from the current scope's container.
 *
 * Falls back to the global container when called outside of a scope.
 */
export function inject<T>(token: Token<T>): T {
  const scope = getCurrentScope();
  const container = scope?.container ?? globalContainer;
  return container.resolve(token, scope);
}

/**
 * Resolves an optional service from the current scope's container.
 *
 * Falls back to the global container when called outside of a scope.
 */
export function injectOptional<T>(token: Token<T>): T | undefined {
  const scope = getCurrentScope();
  const container = scope?.container ?? globalContainer;
  return container.resolveOptional(token, scope);
}

/* ── Context Lifecycle Management ─────────────────────────────────────────── */

/**
 * Creates an execution boundary to encapsulate, track, and bulk-dispose reactive
 * units. Atoms created inside an analog scope defer public broadcasts to the
 * scheduler instead of notifying subscribers synchronously.
 *
 * The returned object is a Proxy: reading an exported atom returns its current
 * value, and writing to an exported atom forwards the value to atom.next().
 * Use `scope.at('key')` to reach the underlying atom when you need to subscribe,
 * dispose, or call other atom methods directly.
 */
export function scope<T extends Record<string, any>>(
  factory: () => T,
  options?: { mode?: "discrete" | "analog" },
): Scope &
  UnwrapScopeValues<T> & {
    at<K extends keyof T>(key: K): AtomOf<T[K]>;
    subscribeTo<K extends keyof T>(
      key: K,
      callback: (value: AtomValueOf<T[K]>) => void,
    ): Subscription;
  } {
  const parent = currentScope ?? getGlobalScope();
  const mode = resolveMode(options, parent);

  // Create the base scope structure
  const parentContainer = isScope(parent) ? parent.container : globalContainer;
  const newScope: Scope = {
    type: "scope",
    atoms: new Set(),
    cleanups: new Set(),
    mode,
    parent,
    container: createContainer(parentContainer),
    loading: null as any,
    snapshot() {
      const result: Record<string, any> = {};
      collectScopeValues(this as Scope & T, result);
      return result as any;
    },
    dispose() {
      disposeScope(this as Scope & T);
    },
    _pendingCount: 0,
    _exports: new Set(),
    _disposed: false,
    _rawState: {},
  };

  // Register this nested scope with its real (non-root) parent so disposal
  // recurses through the scope tree.
  if (isScope(parent)) {
    parent.atoms.add(newScope);
  }

  // Swap the active execution context. The factory is synchronous, so a single
  // saved previous value is enough; no stack is required.
  const previous = currentScope;
  currentScope = newScope;

  try {
    // Create a reactive atom that mirrors this scope's loading state.
    // Loading starts true and becomes false once every registered atom has
    // emitted at least one value.
    const loadingAtom = atom(true);
    (newScope as any).loading = loadingAtom;

    const result = factory();

    if (result && typeof result === "object") {
      // Store the original factory result so the proxy can route reads/writes
      // to the underlying atoms while exposing values to callers.
      const exportKeys = Reflect.ownKeys(result);
      Object.assign(newScope, result);
      (newScope as any)._rawState = result;
      for (const key of exportKeys) {
        newScope._exports.add(key);
      }
    }

    const internalKeys = new Set([
      "type",
      "atoms",
      "cleanups",
      "mode",
      "parent",
      "container",
      "loading",
      "snapshot",
      "dispose",
      "_pendingCount",
      "_exports",
      "_disposed",
      "_rawState",
      "at",
    ]);

    const scopeProxy = new Proxy(newScope, {
      get(target, prop, receiver) {
        if (prop === "at") {
          return (key: string | symbol) => target._rawState[key];
        }
        if (prop === "subscribeTo") {
          return (key: string | symbol, callback: (value: any) => void) => {
            const atom = target._rawState[key] as Atom<any>;
            if (!atom || typeof atom.subscribe !== "function") {
              throw new Error(`Cannot subscribe to non-atom property: ${String(key)}`);
            }
            callback(atom.value);
            return atom.subscribe(callback);
          };
        }
        if (internalKeys.has(prop as string)) {
          return Reflect.get(target, prop, receiver);
        }
        const factoryItem = target._rawState[prop];
        if (
          factoryItem &&
          typeof factoryItem === "object" &&
          (factoryItem as any).type === "atom"
        ) {
          const ctx = getCurrentFormulaContext();
          if (ctx) ctx.dependencies.add(factoryItem as any);
          return (factoryItem as Atom<any>).value;
        }
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver): boolean {
        if (internalKeys.has(prop as string)) {
          return Reflect.set(target, prop, value, receiver);
        }
        const factoryItem = target._rawState[prop];
        if (
          factoryItem &&
          typeof factoryItem === "object" &&
          (factoryItem as any).type === "atom"
        ) {
          const atom = factoryItem as Writable<any>;
          if (typeof atom.next !== "function" || typeof atom.set !== "function") {
            // Derived and flow atoms are read-only; assignment is not allowed.
            return false;
          }
          atom.next(value);
          return true;
        }
        target._rawState[prop] = value;
        return Reflect.set(target, prop, value, receiver);
      },
    });

    // Ensure nested scopes point to this proxied parent so identity checks like
    // `parent.child.parent === parent` hold.
    for (const value of Object.values(newScope._rawState)) {
      if (value && typeof value === "object" && (value as any).type === "scope") {
        (value as Scope).parent = scopeProxy as any;
      }
    }

    // Empty scopes or scopes where every atom already emitted synchronously
    // should report loading=false.
    if (newScope._pendingCount === 0 && loadingAtom.value !== false) {
      loadingAtom.next(false);
    }

    return scopeProxy as any;
  } catch (error) {
    disposeScope(newScope);
    throw normalizeError(error);
  } finally {
    currentScope = previous;
  }
}

/* ── Scope Disposal ───────────────────────────────────────────────────────── */

/**
 * Tears down a scope: runs cleanup hooks and disposes all owned atoms and
 * nested scopes recursively.
 */
export function disposeScope(sc: Scope): void {
  if (sc._disposed) return;
  sc._disposed = true;

  for (const cleanup of Array.from(sc.cleanups)) {
    try {
      cleanup();
    } catch {
      /* suppress secondary cleanup errors */
    }
  }
  sc.cleanups.clear();

  // Remove this scope's pending-atom contribution from its ancestors before
  // disposing children, so parent loading states stay consistent.
  decrementPendingBy(sc.parent, sc._pendingCount);
  sc._pendingCount = 0;

  if (isScope(sc.parent)) {
    sc.parent.atoms.delete(sc);
  }

  for (const item of Array.from(sc.atoms)) {
    // Both atoms and scopes have a `dispose` method.
    try {
      if (!(item as any).disposed) {
        (item as any).dispose();
      }
    } catch {
      /* suppress structural errors during sweep */
    }
  }
  sc.atoms.clear();

  // Dispose the scope's IoC container and run cleanup for scoped services.
  sc.container.dispose().catch(() => {});
}

/* ── Registry Linkage Handlers ───────────────────────────────────────────── */

/**
 * Links a newly created atom to the active scope so it is disposed with the scope.
 */
export function registerWithCurrentScope(atom: Atom<any>): void {
  if (!currentScope) return;

  const scopeRef = currentScope;
  scopeRef.atoms.add(atom);
  atomScopeRegistry.set(atom, scopeRef);

  // Every registered atom starts life as pending; loading becomes true when
  // at least one atom in the subtree has not yet emitted.
  incrementPending(scopeRef);

  // Auto-detach from the scope's tracked set if the atom is manually disposed early
  const onDisposeHandlers = (atom as any)._onDispose;
  if (onDisposeHandlers instanceof Set) {
    const trackingCleanup = () => {
      scopeRef.atoms.delete(atom);
      if (!emittedAtomsRegistry.has(atom) && !scopeRef._disposed) {
        decrementPending(scopeRef);
      }
    };
    onDisposeHandlers.add(trackingCleanup);
    scopeRef.cleanups.add(() => onDisposeHandlers.delete(trackingCleanup));
  }

  // Subscribe to the atom so that:
  // - derived atoms initialize eagerly (subscribe() calls ensureInit()),
  // - flow atoms stay active and actually receive values from their source, and
  // - every emission is recorded for scope.loading.
  try {
    const sub = atom.subscribe(() => markAtomAsEmitted(atom));
    scopeRef.cleanups.add(() => {
      if ((atom as any).disposed) return;
      sub.unsubscribe();
    });
  } catch {
    // ignore initialization errors (e.g. derived that throws on first run)
  }
}

/**
 * Records that an atom has emitted its first value.
 */
export function markAtomAsEmitted(atom: Atom<any>): void {
  if (emittedAtomsRegistry.has(atom)) return;
  emittedAtomsRegistry.add(atom);

  const scope = atomScopeRegistry.get(atom);
  if (scope) decrementPending(scope);
}

/* ── Loading State ────────────────────────────────────────────────────────── */

function incrementPending(scope: Scope): void {
  let sc: Scope | RootScope | null = scope;
  while (isScope(sc)) {
    sc._pendingCount++;
    const loadingAtom = sc.loading;
    if (loadingAtom) {
      const loading = sc._pendingCount > 0;
      if (loadingAtom.value !== loading) loadingAtom.next(loading);
    }
    sc = sc.parent;
  }
}

function decrementPending(scope: Scope): void {
  let sc: Scope | RootScope | null = scope;
  while (isScope(sc) && !sc._disposed) {
    sc._pendingCount = Math.max(0, sc._pendingCount - 1);
    const loadingAtom = sc.loading;
    if (loadingAtom) {
      const loading = sc._pendingCount > 0;
      if (loadingAtom.value !== loading) loadingAtom.next(loading);
    }
    sc = sc.parent;
  }
}

function decrementPendingBy(scope: Scope | RootScope | null, amount: number): void {
  if (amount <= 0) return;
  let sc: Scope | RootScope | null = scope;
  while (isScope(sc) && !sc._disposed) {
    sc._pendingCount = Math.max(0, sc._pendingCount - amount);
    const loadingAtom = sc.loading;
    if (loadingAtom) {
      const loading = sc._pendingCount > 0;
      if (loadingAtom.value !== loading) loadingAtom.next(loading);
    }
    sc = sc.parent;
  }
}

/* ── Snapshot Helper ─────────────────────────────────────────────────────── */

function collectScopeValues(sc: Scope, result: Record<string, any>): void {
  for (const key of sc._exports) {
    const value = sc._rawState[key];
    if (value && typeof value === "object" && (value as any).type === "atom") {
      try {
        result[key as string] = (value as Atom<any>).value;
      } catch {
        result[key as string] = (value as any).safeValue;
      }
    } else if (
      value &&
      typeof value === "object" &&
      (value as any).type === "scope"
    ) {
      result[key as string] = (value as Scope).snapshot();
    } else {
      result[key as string] = value;
    }
  }
}
