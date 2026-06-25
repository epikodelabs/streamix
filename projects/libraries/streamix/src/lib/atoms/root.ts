import { globalContainer, type Container } from "../ioc/container";
import type { Scope } from "./scope";

/**
 * The global/root context is the default parent for top-level scopes.
 * Unlike a normal {@link Scope}, it is not disposable, has no atoms, and
 * carries only the global timing default.
 */
export interface RootScope {
  readonly type: "root";
  mode: "discrete" | "analog";
  /** IoC container shared by all top-level scopes. */
  container: Container;
}

let _globalScope: RootScope | null = null;

export function getGlobalScope(): RootScope {
  if (!_globalScope) {
    _globalScope = {
      type: "root",
      mode: "discrete",
      get container() {
        return globalContainer;
      },
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
 * Determines the effective mode for a new scope.
 *
 * Priority (highest → lowest):
 *   1. Explicit `mode` option.
 *   2. Mode inherited from a non-root parent scope.
 *   3. Global scope mode default.
 */
export function resolveMode(
  options: { mode?: "discrete" | "analog" } | undefined,
  parent: Scope | RootScope | null,
): "discrete" | "analog" {
  if (options?.mode) {
    return options.mode;
  }

  if (isScope(parent)) {
    return parent.mode;
  }

  return getGlobalScope().mode;
}