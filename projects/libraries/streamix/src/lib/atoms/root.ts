import { internalRuntime } from "../runtime/runtime";
import type { Scope } from "./scope";

/**
 * The global/root context is the default parent for top-level scopes.
 * Unlike a normal {@link Scope}, it is not disposable and owns no atoms.
 */
export interface RootScope {
  readonly type: "root";
}

export function getGlobalScope(): RootScope {
  return internalRuntime.root;
}

export const globalScope: RootScope = internalRuntime.root;

/** Type guard to distinguish a real {@link Scope} from a {@link RootScope}. */
export function isScope(value: Scope | RootScope | null | undefined): value is Scope {
  return value != null && (value as any).type === "scope";
}
