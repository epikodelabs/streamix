import { type AtomBase } from "./atom"; // Adjust import path to match your structure

/**
 * Interface definition for a lifecycle scope execution context.
 */
export interface Scope {
  /** Unique discriminator for the runtime context. */
  type: "scope";
  /** State container for active elements captured by this window. */
  atoms: Set<AtomBase<any>>;
  /** Registered callbacks triggered when this context collapses. */
  cleanups: Set<() => void>;
  /** * Strobe interval value or mode identifier. 
   * A value > 0 flags an analog deferred/batched notification window.
   */
  strobe?: number;
}

// Active execution context tracking frames
let currentScope: Scope | null = null;
const scopeStack: Scope[] = [];

// Analog state registration tracking
const analogFlushRegistry = new Map<Scope, Map<AtomBase<any>, () => void>>();
const emittedAtomsRegistry = new WeakSet<AtomBase<any>>();

/* ── Active Window Accessors ── */

/**
 * Retrieves the currently active tracking scope context from the execution frame.
 */
export function getCurrentScope(): Scope | null {
  return currentScope;
}

/**
 * Grabs the strobe value or strategy assigned to a designated scope context.
 */
export function getScopeStrobe(scope: Scope): number | undefined {
  return scope.strobe;
}

/* ── Context Lifecycle Management ── */

/**
 * Creates an execution boundary to encapsulate, track, and bulk-dispose reactive units.
 * Supports strobe settings for analog/deferred graph execution.
 */
export function scope<T>(factory: () => T, strobe?: number): T {
  const newScope: Scope = {
    type: "scope",
    atoms: new Set(),
    cleanups: new Set(),
    strobe,
  };

  // Push onto active execution context layout stack
  if (currentScope) {
    scopeStack.push(currentScope);
  }
  currentScope = newScope;

  if (strobe !== undefined && strobe > 0) {
    analogFlushRegistry.set(newScope, new Map());
  }

  try {
    const result = factory();

    // If the factory returns an object with a tear-down handler or an active composition,
    // we can attach an explicit cleanup hook back to this scope.
    return result;
  } catch (error) {
    // If the creation block panics, clean up the scope immediately to avoid memory leaks
    disposeScope(newScope);
    throw error;
  } finally {
    // Pop back to the previous running scope framework safely
    currentScope = scopeStack.pop() || null;
  }
}

/**
 * Tears down a scope, clearing all registered atoms, executing internal cleanup hooks,
 * and decoupling analog strobe frames to guarantee a clean exit.
 */
export function disposeScope(scope: Scope): void {
  // Clear any existing analog flush intervals or batches assigned to this scope
  analogFlushRegistry.delete(scope);

  // Safely unwind all registered cleanup hooks
  for (const cleanup of Array.from(scope.cleanups)) {
    try {
      cleanup();
    } catch {
      // Suppress secondary cleanup exceptions to guarantee complete tear-down
    }
  }
  scope.cleanups.clear();

  // Dispose all captured primitive blocks owned by this context boundary
  for (const atom of Array.from(scope.atoms)) {
    try {
      if (!atom.disposed) {
        atom.dispose();
      }
    } catch {
      // Suppress structural errors during total engine sweep
    }
  }
  scope.atoms.clear();
}

/* ── Registry Linkage Handlers ── */

/**
 * Links a newly generated atom node to the active tracking scope window.
 */
export function registerWithCurrentScope(atom: AtomBase<any>): void {
  if (!currentScope) return;

  currentScope.atoms.add(atom);

  // Automatically detach the atom from the scope's tracked set if it's manually disposed early
  const onDisposeHandlers = (atom as any)._onDispose;
  if (onDisposeHandlers instanceof Set) {
    const scopeRef = currentScope;
    const trackingCleanup = () => {
      scopeRef.atoms.delete(atom);
    };
    onDisposeHandlers.add(trackingCleanup);
    
    // Ensure the cleanup hook itself is un-registered if the scope collapses first
    scopeRef.cleanups.add(() => {
      onDisposeHandlers.delete(trackingCleanup);
    });
  }
}

/**
 * Identifies whether an atom was initialized with a baseline state or 
 * has already broadcast its first default value payload.
 */
export function markAtomAsEmitted(atom: AtomBase<any>): void {
  emittedAtomsRegistry.add(atom);
}

/**
 * Checks if an atom has previously emitted or been pre-loaded with an explicit setup state.
 */
export function hasAtomEmitted(atom: AtomBase<any>): boolean {
  return emittedAtomsRegistry.has(atom);
}

/**
 * Registers an analog or continuous atom flush coordinator inside the current scope frame.
 * Used exclusively when a scope-level or global strobe deferral engine is operational.
 */
export function registerAnalogAtom(atom: AtomBase<any>, flushFn: () => void): void {
  if (!currentScope) return;

  const scopeMap = analogFlushRegistry.get(currentScope);
  if (scopeMap) {
    scopeMap.set(atom, flushFn);
  }
}

/**
 * Disconnects an analog flush coordinator from all operational frames.
 * Ensures that dead or manually closed atoms don't block the engine batch processing loops.
 */
export function unregisterAnalogAtom(atom: AtomBase<any>): void {
  // Linear check is rare because atoms usually exist inside the immediate active running scope
  for (const scopeMap of analogFlushRegistry.values()) {
    scopeMap.delete(atom);
  }
}

/**
 * Explicit execution trigger to force-flush all buffered updates inside an analog scope framework.
 */
export function flushScopeStrobe(scope: Scope): void {
  const scopeMap = analogFlushRegistry.get(scope);
  if (!scopeMap || scopeMap.size === 0) return;

  // Clone tasks to safeguard against mid-loop deletions or target structural state shifts
  const flushActions = Array.from(scopeMap.values());
  
  for (const flush of flushActions) {
    try {
      flush();
    } catch {
      // Suppress mid-frame update execution panics to isolate mutations
    }
  }
}