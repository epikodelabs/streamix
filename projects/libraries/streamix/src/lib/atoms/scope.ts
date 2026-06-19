import type { AtomBase } from "./atom";
import { getGlobalScope, isScope, resolveStrobeAndMode, type RootScope } from "./root";
import { registerAnalogFlush, startStrobe, stopStrobe } from "./scheduler";

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

/**
 * Interface definition for a lifecycle scope execution context.
 */
export interface Scope {
  /** Unique discriminator for the runtime context. */
  type: "scope";
  /** State container for active elements captured by this window. */
  atoms: Set<AtomBase<any> | Scope>;
  /** Registered callbacks triggered when this context collapses. */
  cleanups: Set<() => void>;
  /**
   * Strobe interval value or mode identifier.
   * A value > 0 flags an analog deferred/batched notification window.
   */
  strobe: number;
  /** Scope mode: 'discrete' or 'analog' */
  mode: "discrete" | "analog";
  /** Parent scope reference */
  parent: Scope | RootScope | null;
  /**
   * Whether the scope is still loading.
   * True until every owned atom (and nested scope) has emitted at least one value.
   * Implemented as a computed getter — always current, no subscriptions needed.
   */
  loading: boolean;
  /** Returns a plain object snapshot of all current atom values. */
  snapshot(): this extends (infer T extends Record<string, any>) ? UnwrapSnapshotValues<T> : Record<string, any>;
  /** Disposes the scope and all of its atoms. */
  dispose(): void;
  /** Internal: active strobe interval id when the scope is analog. */
  strobeInterval?: ReturnType<typeof setInterval>;
  /** @internal Number of atoms in this scope's subtree that have not yet emitted. */
  _pendingCount: number;
  /** @internal Factory keys that belong in snapshots. */
  _exports: Set<string | symbol>;
  /** @internal True once the scope has begun disposal. */
  _disposed: boolean;
}

// Active execution context tracking frames
let currentScope: Scope | null = null;

// Tracks which scope each registered atom belongs to.
const atomScopeRegistry = new WeakMap<AtomBase<any>, Scope>();

// Tracks atoms that have produced at least one value.
const emittedAtomsRegistry = new WeakSet<AtomBase<any>>();

/* ── Active Window Accessors ──────────────────────────────────────────────── */

export function getCurrentScope(): Scope | null {
  return currentScope;
}

export function getScopeStrobe(scope: Scope): number | undefined {
  return scope.strobe;
}

export function getScopeMode(scope: Scope): "discrete" | "analog" {
  return scope.mode ?? "discrete";
}

export function setCurrentScope(scope: Scope | null): Scope | null {
  const previous = currentScope;
  currentScope = scope;
  return previous;
}

/* ── Context Lifecycle Management ─────────────────────────────────────────── */

/**
 * Creates an execution boundary to encapsulate, track, and bulk-dispose reactive
 * units. When `strobe > 0` (analog mode) the scope delegates timing to the
 * scope scheduler, which periodically drains buffered atom updates.
 */
export function scope<T extends Record<string, any>>(
  factory: () => T,
  options?: { mode?: "discrete" | "analog"; strobe?: number },
): Scope & T {
  const parent = currentScope ?? getGlobalScope();
  const { mode, strobe } = resolveStrobeAndMode(options, parent);

  // Create the base scope structure
  const newScope: Scope = {
    type: "scope",
    atoms: new Set(),
    cleanups: new Set(),
    strobe: strobe > 0 ? strobe : 0,
    mode,
    parent,
    loading: false,
    snapshot() {
      const result: Record<string, any> = {};
      collectScopeValues(this as Scope & T, result);
      return result as any; // TypeScript should infer the return type from the function signature
    },
    dispose() {
      disposeScope(this as Scope & T);
    },
    _pendingCount: 0,
    _exports: new Set(),
    _disposed: false,
  };

  // `loading` is a computed getter so it is always up-to-date without any
  // subscription wiring. The setter is a no-op to absorb any legacy writes.
  Object.defineProperty(newScope, "loading", {
    get() {
      return this._pendingCount > 0;
    },
    set(_v: boolean) {
      /* computed; writes are intentionally ignored */
    },
    enumerable: true,
    configurable: true,
  });

  // Register this nested scope with its real (non-root) parent so disposal
  // recurses through the scope tree.
  if (isScope(parent)) {
    parent.atoms.add(newScope);
  }

  if (strobe > 0) {
    startStrobe(newScope);
  }

  // Swap the active execution context. The factory is synchronous, so a single
  // saved previous value is enough; no stack is required.
  const previous = currentScope;
  currentScope = newScope;

  try {
    const result = factory();

    if (result && typeof result === "object") {
      // Merge the factory result so callers can use dot notation (s.count, etc.)
      const exportKeys = Reflect.ownKeys(result);
      Object.assign(newScope, result);
      for (const key of exportKeys) {
        newScope._exports.add(key);
      }
    }

    return newScope as Scope & T;
  } catch (error) {
    disposeScope(newScope);
    throw error;
  } finally {
    currentScope = previous;
  }
}

/* ── Scope Disposal ───────────────────────────────────────────────────────── */

/**
 * Tears down a scope: stops strobe intervals, runs cleanup hooks, and disposes
 * all owned atoms and nested scopes recursively.
 */
export function disposeScope(sc: Scope): void {
  if (sc._disposed) return;
  sc._disposed = true;

  stopStrobe(sc);

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
}

/* ── Registry Linkage Handlers ───────────────────────────────────────────── */

/**
 * Links a newly created atom to the active scope so it is disposed with the scope.
 */
export function registerWithCurrentScope(atom: AtomBase<any>): void {
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
 *
 * Called by:
 *   - atom()   immediately after construction when an initialValue is provided
 *   - derived() after its first successful synchronous computation
 *   - flow()   on the first value received from its async source
 *
 * Because `scope.loading` is derived from `_pendingCount`, no explicit refresh
 * step is needed — the next read of `scope.loading` will automatically reflect
 * this change.
 */
export function markAtomAsEmitted(atom: AtomBase<any>): void {
  if (emittedAtomsRegistry.has(atom)) return;
  emittedAtomsRegistry.add(atom);

  const scope = atomScopeRegistry.get(atom);
  if (scope) decrementPending(scope);
}

/**
 * Public wrapper that registers an analog flush callback using the current scope.
 * Prefer {@link registerAnalogFlush} from `./scope-scheduler` when the scope is
 * already known.
 */
export function registerAnalogAtom(atom: AtomBase<any>, flushFn: () => void): void {
  if (!currentScope) return;
  registerAnalogFlush(currentScope, atom, flushFn);
}

/* ── Loading State ────────────────────────────────────────────────────────── */

function incrementPending(scope: Scope): void {
  let sc: Scope | RootScope | null = scope;
  while (isScope(sc)) {
    sc._pendingCount++;
    sc = sc.parent;
  }
}

function decrementPending(scope: Scope): void {
  let sc: Scope | RootScope | null = scope;
  while (isScope(sc) && !sc._disposed) {
    sc._pendingCount = Math.max(0, sc._pendingCount - 1);
    sc = sc.parent;
  }
}

function decrementPendingBy(scope: Scope | RootScope | null, amount: number): void {
  if (amount <= 0) return;
  let sc: Scope | RootScope | null = scope;
  while (isScope(sc) && !sc._disposed) {
    sc._pendingCount = Math.max(0, sc._pendingCount - amount);
    sc = sc.parent;
  }
}

/* ── Snapshot Helper ─────────────────────────────────────────────────────── */

function collectScopeValues(sc: Scope, result: Record<string, any>): void {
  for (const key of sc._exports) {
    const value = (sc as any)[key];
    if (value && typeof value === "object" && value.type === "atom") {
      try {
        result[key as string] = value.value;
      } catch {
        result[key as string] = value.safeValue;
      }
    } else if (value && typeof value === "object" && value.type === "scope") {
      result[key as string] = value.snapshot();
    } else {
      result[key as string] = value;
    }
  }
}
