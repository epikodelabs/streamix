import type { AtomBase } from "./atom";
import type { Scope } from "./scope";

// Analog flush registry: scope → Map<atom, flushFn>
// Populated by atom.ts via registerAnalogFlush(); drained by flushScopeStrobe().
const analogFlushRegistry = new Map<Scope, Map<AtomBase<any>, () => void>>();

/**
 * Registers an analog flush callback for an atom inside a strobe scope.
 * Called by atom.ts for every analog atom/derived atom constructed inside a
 * strobe scope. The callback is invoked periodically by the scope's strobe tick.
 */
export function registerAnalogFlush(
  scope: Scope,
  atom: AtomBase<any>,
  flushFn: () => void,
): void {
  const scopeMap = analogFlushRegistry.get(scope);
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
    try {
      flush();
    } catch {
      /* suppress mid-frame panics */
    }
  }
}

/** Starts the periodic strobe interval for an analog scope. */
export function startStrobe(scope: Scope): void {
  if (scope.strobeInterval || scope.strobe <= 0) return;
  analogFlushRegistry.set(scope, new Map());
  scope.strobeInterval = setInterval(() => flushScopeStrobe(scope), scope.strobe);
}

/** Stops the periodic strobe interval and releases the flush registry. */
export function stopStrobe(scope: Scope): void {
  if (scope.strobeInterval) {
    clearInterval(scope.strobeInterval);
    scope.strobeInterval = undefined;
  }
  analogFlushRegistry.delete(scope);
}
