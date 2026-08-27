import type { Scope } from "./scope";

/**
 * The global/root context is the default parent for top-level scopes.
 * Unlike a normal {@link Scope}, it is not disposable and owns no atoms.
 */
export interface RootScope {
  readonly type: "root";
}

let _globalScope: RootScope | null = null;

export function getGlobalScope(): RootScope {
  if (!_globalScope) {
    _globalScope = { type: "root" };
  }
  return _globalScope;
}

export const globalScope = getGlobalScope();

/** Type guard to distinguish a real {@link Scope} from a {@link RootScope}. */
export function isScope(value: Scope | RootScope | null | undefined): value is Scope {
  return value != null && (value as any).type === "scope";
}
