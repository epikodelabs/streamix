import { AtomBase } from "./atom";

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
  mode: 'discrete' | 'analog';
  /** Parent scope reference */
  parent: Scope | null;
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
}

// Active execution context tracking frames
let currentScope: Scope | null = null;
const scopeStack: Scope[] = [];

// Analog flush registry: scope → Map<atom, flushFn>
// Populated by atom.ts via registerAnalogAtom(); drained by flushScopeStrobe().
const analogFlushRegistry = new Map<Scope, Map<AtomBase<any>, () => void>>();

// Tracks atoms that have produced at least one value.
const emittedAtomsRegistry = new WeakSet<AtomBase<any>>();

/* ── Active Window Accessors ──────────────────────────────────────────────── */

export function getCurrentScope(): Scope | null {
  return currentScope;
}

export function getScopeStrobe(scope: Scope): number | undefined {
  return scope.strobe;
}

export function getScopeMode(scope: Scope): 'discrete' | 'analog' {
  return scope.mode ?? 'discrete';
}

export function setCurrentScope(scope: Scope | null): Scope | null {
  const previous = currentScope;
  currentScope = scope;
  return previous;
}

/* ── Strobe / Mode Resolution ─────────────────────────────────────────────── */

/**
 * Determines the effective strobe and mode for a new scope.
 *
 * Priority (highest → lowest):
 *   1. Explicit `mode: 'discrete'` opt-out — always wins.
 *   2. Explicit `strobe` value on the options.
 *   3. Strobe inherited from a non-global parent scope.
 *   4. Global scope `mode` / `strobe` configuration flags.
 */
function resolveStrobeAndMode(
  options: { mode?: 'discrete' | 'analog'; strobe?: number } | undefined,
  parent: Scope | null,
): { mode: 'discrete' | 'analog'; strobe: number } {
  // 1. Explicit discrete opt-out
  if (options?.mode === 'discrete') {
    return { mode: 'discrete', strobe: 0 };
  }

  // 2. Explicit strobe on this scope
  if (options?.strobe !== undefined && options.strobe > 0) {
    return { mode: 'analog', strobe: options.strobe };
  }

  const globalSc = getGlobalScope();

  // 3. Inherit from a real (non-global) parent scope
  if (parent && parent !== globalSc && parent.strobe && parent.strobe > 0) {
    return { mode: 'analog', strobe: parent.strobe };
  }

  // 4. Inherit from global scope configuration
  if (globalSc.mode === 'analog' && globalSc.strobe > 0) {
    return { mode: 'analog', strobe: globalSc.strobe };
  }

  return { mode: options?.mode ?? 'discrete', strobe: 0 };
}

/* ── Context Lifecycle Management ─────────────────────────────────────────── */

/**
 * Creates an execution boundary to encapsulate, track, and bulk-dispose reactive
 * units. When `strobe > 0` (analog mode) the scope owns a `setInterval` that
 * periodically drains buffered atom updates registered via `registerAnalogAtom`.
 */
export function scope<T extends Record<string, any>>(
  factory: () => T,
  options?: { mode?: 'discrete' | 'analog'; strobe?: number },
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
  };

  // `loading` is a computed getter so it is always up-to-date without any
  // subscription wiring. The setter is a no-op to absorb any legacy writes.
  Object.defineProperty(newScope, 'loading', {
    get() { return computeLoadingState(this); },
    set(_v: boolean) { /* computed; writes are intentionally ignored */ },
    enumerable: true,
    configurable: true,
  });

  // Push onto the active execution context stack
  scopeStack.push(currentScope!);
  currentScope = newScope;

  // Register this nested scope with its real (non-global) parent so disposal
  // recurses through the scope tree.
  if (parent && parent !== getGlobalScope()) {
    parent.atoms.add(newScope);
  }

  if (strobe > 0) {
    // Prepare the flush map that atom.ts writes into via registerAnalogAtom()
    analogFlushRegistry.set(newScope, new Map());
    const strobeInterval = setInterval(() => flushScopeStrobe(newScope), strobe);
    newScope.strobeInterval = strobeInterval;
  }

  try {
    const result = factory();

    if (result && typeof result === 'object') {
      // Merge the factory result so callers can use dot notation (s.count, etc.)
      Object.assign(newScope, result);
    }

    return newScope as Scope & T;
  } catch (error) {
    disposeScope(newScope);
    throw error;
  } finally {
    currentScope = scopeStack.pop() ?? null;
  }
}

/* ── Scope Disposal ───────────────────────────────────────────────────────── */

/**
 * Tears down a scope: stops strobe intervals, runs cleanup hooks, and disposes
 * all owned atoms and nested scopes recursively.
 */
export function disposeScope(sc: Scope): void {
  if (sc.strobeInterval) {
    clearInterval(sc.strobeInterval);
    sc.strobeInterval = undefined;
  }

  analogFlushRegistry.delete(sc);

  for (const cleanup of Array.from(sc.cleanups)) {
    try { cleanup(); } catch { /* suppress secondary cleanup errors */ }
  }
  sc.cleanups.clear();

  for (const item of Array.from(sc.atoms)) {
    // Both atoms and scopes have a `dispose` method.
    try {
      if (!(item as any).disposed) {
        (item as any).dispose();
      }
    } catch { /* suppress structural errors during sweep */ }
  }
  sc.atoms.clear();
}

/* ── Registry Linkage Handlers ───────────────────────────────────────────── */

/**
 * Links a newly created atom to the active scope so it is disposed with the scope.
 */
export function registerWithCurrentScope(atom: AtomBase<any>): void {
  if (!currentScope) return;

  currentScope.atoms.add(atom);

  // Auto-detach from the scope's tracked set if the atom is manually disposed early
  const onDisposeHandlers = (atom as any)._onDispose;
  if (onDisposeHandlers instanceof Set) {
    const scopeRef = currentScope;
    const trackingCleanup = () => scopeRef.atoms.delete(atom);
    onDisposeHandlers.add(trackingCleanup);
    scopeRef.cleanups.add(() => onDisposeHandlers.delete(trackingCleanup));
  }

  // Subscribe to the atom so that:
  // - derived atoms initialize eagerly (subscribe() calls ensureInit()),
  // - flow atoms stay active and actually receive values from their source, and
  // - every emission is recorded for scope.loading.
  try {
    const sub = atom.subscribe(() => markAtomAsEmitted(atom));
    const scopeRef = currentScope;
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
 * Because `scope.loading` is a computed getter backed by `computeLoadingState`,
 * no explicit refresh step is needed — the next read of `scope.loading` will
 * automatically reflect this change.
 */
export function markAtomAsEmitted(atom: AtomBase<any>): void {
  emittedAtomsRegistry.add(atom);
}

export function hasAtomEmitted(atom: AtomBase<any>): boolean {
  return emittedAtomsRegistry.has(atom);
}

/**
 * Registers an analog flush callback for the current scope frame.
 * Called by atom.ts for every analog atom/derived atom constructed inside a
 * strobe scope. The callback is invoked periodically by `flushScopeStrobe`.
 */
export function registerAnalogAtom(atom: AtomBase<any>, flushFn: () => void): void {
  if (!currentScope) return;
  const scopeMap = analogFlushRegistry.get(currentScope);
  if (scopeMap) scopeMap.set(atom, flushFn);
}

/**
 * Removes an atom's flush callback from all scope registries.
 * Called on atom disposal so dead atoms don't block future strobe ticks.
 */
export function unregisterAnalogAtom(atom: AtomBase<any>): void {
  for (const scopeMap of analogFlushRegistry.values()) {
    scopeMap.delete(atom);
  }
}

/**
 * Drains all buffered updates for a strobe scope.
 * The Map preserves insertion order (atoms registered before derived atoms),
 * which guarantees sources are flushed before their dependents.
 */
export function flushScopeStrobe(sc: Scope): void {
  const scopeMap = analogFlushRegistry.get(sc);
  if (!scopeMap || scopeMap.size === 0) return;

  // Snapshot before iterating to guard against mid-loop mutations
  for (const flush of Array.from(scopeMap.values())) {
    try { flush(); } catch { /* suppress mid-frame panics */ }
  }
}

/* ── Loading State ────────────────────────────────────────────────────────── */

/**
 * Synchronously determines whether any atom in the scope tree has not yet
 * emitted. Recurses into nested scopes.
 */
function computeLoadingState(sc: Scope): boolean {
  for (const item of sc.atoms) {
    if ((item as any).type === 'scope') {
      if (computeLoadingState(item as Scope)) return true;
    } else {
      if (!hasAtomEmitted(item as AtomBase<any>)) return true;
    }
  }
  return false;
}

/* ── Snapshot Helper ─────────────────────────────────────────────────────── */

function collectScopeValues(sc: Scope, result: Record<string, any>): void {
  const INTERNAL = new Set([
    'type', 'atoms', 'cleanups', 'strobe', 'mode', 'parent',
    'loading', 'snapshot', 'dispose', '_strobeInterval',
  ]);

  for (const key of Object.keys(sc)) {
    if (INTERNAL.has(key)) continue;

    const value = (sc as any)[key];
    if (value && typeof value === 'object' && value.type === 'atom') {
      try {
        result[key] = value.value;
      } catch {
        result[key] = value.safeValue;
      }
    } else if (value && typeof value === 'object' && value.type === 'scope') {
      result[key] = value.snapshot();
    } else {
      result[key] = value;
    }
  }
}

/* ── Global Scope ─────────────────────────────────────────────────────────── */

let _globalScope: any = null;

export function getGlobalScope(): Scope {
  if (!_globalScope) {
    _globalScope = {
      type: "scope",
      atoms: new Set(),
      cleanups: new Set(),
      strobe: 0,
      mode: 'discrete',
      parent: null,
      loading: false,
      snapshot<T extends Record<string, any> = {}>(): T {
        return {} as T;
      },
      dispose() { /* global scope is never disposed */ },
    };
  }
  return _globalScope;
}

export const globalScope = getGlobalScope();