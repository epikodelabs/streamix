import type { Scope } from "./scope";

/**
 * The global/root context is the default parent for top-level scopes.
 * Unlike a normal {@link Scope}, it is not disposable, has no atoms, and
 * carries only the global timing defaults.
 */
export interface RootScope {
  readonly type: "root";
  mode: "discrete" | "analog";
  strobe: number;
}

let _globalScope: RootScope | null = null;

export function getGlobalScope(): RootScope {
  if (!_globalScope) {
    _globalScope = {
      type: "root",
      mode: "discrete",
      strobe: 0,
    };
  }
  return _globalScope;
}

export const globalScope = getGlobalScope();

/** Type guard to distinguish a real {@link Scope} from a {@link RootScope}. */
export function isScope(value: Scope | RootScope | null | undefined): value is Scope {
  return value != null && (value as any).type === "scope";
}

/**
 * Determines the effective strobe and mode for a new scope.
 *
 * Priority (highest → lowest):
 *   1. Explicit `mode: 'discrete'` opt-out — always wins.
 *   2. Explicit `strobe` value on the options.
 *   3. Strobe inherited from a non-root parent scope.
 *   4. Global scope `mode` / `strobe` configuration flags.
 */
export function resolveStrobeAndMode(
  options: { mode?: "discrete" | "analog"; strobe?: number } | undefined,
  parent: Scope | RootScope | null,
): { mode: "discrete" | "analog"; strobe: number } {
  // 1. Explicit discrete opt-out
  if (options?.mode === "discrete") {
    return { mode: "discrete", strobe: 0 };
  }

  // 2. Explicit strobe on this scope
  if (options?.strobe !== undefined && options.strobe > 0) {
    return { mode: "analog", strobe: options.strobe };
  }

  const globalSc = getGlobalScope();

  // 3. Inherit from a real (non-root) parent scope
  if (isScope(parent) && parent.strobe > 0) {
    return { mode: "analog", strobe: parent.strobe };
  }

  // 4. Inherit from global scope configuration
  if (globalSc.mode === "analog" && globalSc.strobe > 0) {
    return { mode: "analog", strobe: globalSc.strobe };
  }

  return { mode: options?.mode ?? "discrete", strobe: 0 };
}
