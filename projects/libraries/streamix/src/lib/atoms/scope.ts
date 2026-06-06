import type { Atom } from "./atom";

function isAtom(value: unknown): value is Atom<any> {
  return typeof value === "object" && value !== null && "previousValue" in value;
}

function isScope(value: unknown): value is Scope {
  return typeof value === "object" && value !== null && "snapshot" in value && "dispose" in value;
}

/**
 * A composite container that owns atoms and child scopes.
 *
 * Scopes form a tree via {@link parent}, track a {@link loading} flag
 * that becomes `false` once every d atom (recursively) has
 * emitted at least once, and support bulk snapshotting and disposal.
 *
 * Items created inside a scope factory are registered automatically —
 * no manual bookkeeping is required.
 */
export interface Scope {
  /** Runtime type identifier. */
  readonly type: "scope";

  /** The scope that was active when this one was created, if any. */
  readonly parent?: Scope;

  /**
   * `true` while any d atom (in this scope or a descendant)
   * has not yet emitted its first value.
   */
  readonly loading: boolean;

  /**
   * Captures the current values of all d items.
   *
   * For atoms this reads {@link Atom.value};
   * for child scopes this recurses into their snapshot.
   * Non-atom/scope values are passed through as-is.
   */
  snapshot(): Record<string, any>;

  /** Disposes every d atom or child scope recursively. */
  dispose(): void;
}

interface ScopeInternal {
  d: Set<Atom<any> | Scope>;
  emittedAtoms: Set<Atom<any>>;
  localLoading: boolean;
  snapshotSource?: Record<string, any>;
  checkLoading(): void;
}

const scopeInternals = new WeakMap<Scope, ScopeInternal>();

let currentScope: Scope | undefined;

/** @internal Returns the scope currently executing its factory. */
export function getCurrentScope(): Scope | undefined {
  return currentScope;
}

/** @internal Registers a value with the scope that is currently active. */
export function registerWithCurrentScope(value: Atom<any> | Scope): void {
  const scope = currentScope;
  if (!scope) return;

  const internal = scopeInternals.get(scope);
  if (!internal) return;

  internal.d.add(value);

  if (isAtom(value)) {
    value.subscribe(() => {
      internal.emittedAtoms.add(value);
      internal.checkLoading();
    });
  }
}

/**
 * Creates a scope.
 *
 * The factory runs with the new scope as the active context. Any atoms or
 * nested scopes created inside the factory are automatically d and
 * will be disposed when this scope is disposed. The factory's return value
 * is merged onto the scope object for typed access.
 *
 * @param factory - Setup function that creates atoms and nested scopes.
 * @returns A scope object merged with the factory's return value.
 *
 * @example
 * ```ts
 * const app = scope(() => {
 *   const count = atom(counterStream, 0);
 *   const label = atom(labelStream, 'hello');
 *   return { count, label };
 * });
 *
 * console.log(app.count.value);
 * app.dispose(); // disposes count and label
 * ```
 */
export function scope<T>(factory: () => T): Scope & T {
  const previousScope = currentScope;

  const d = new Set<Atom<any> | Scope>();
  const emittedAtoms = new Set<Atom<any>>();
  let localLoading = true;

  const internal: ScopeInternal = {
    d,
    emittedAtoms,
    localLoading,

    checkLoading() {
      if (!localLoading) return;
      const atomCount = Array.from(d).filter(isAtom).length;
      if (atomCount === 0 || emittedAtoms.size === atomCount) {
        localLoading = false;
      }
    }
  };

  const instance = {} as Scope;

  Object.defineProperty(instance, "type", {
    value: "scope",
    writable: false,
    enumerable: true,
    configurable: true
  });

  Object.defineProperty(instance, "parent", {
    value: previousScope,
    writable: false,
    enumerable: true,
    configurable: true
  });

  Object.defineProperty(instance, "loading", {
    get() {
      if (localLoading) return true;
      for (const item of Array.from(d)) {
        if (isScope(item) && item.loading) return true;
      }
      return false;
    },
    enumerable: true,
    configurable: true
  });

  Object.defineProperty(instance, "snapshot", {
    value() {
      const source = internal.snapshotSource;
      if (!source) return {};

      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(source)) {
        if (isAtom(value)) {
          result[key] = value.value;
        } else if (isScope(value)) {
          result[key] = value.snapshot();
        } else {
          result[key] = value;
        }
      }
      return result;
    },
    writable: false,
    enumerable: true,
    configurable: true
  });

  Object.defineProperty(instance, "dispose", {
    value() {
      const items = Array.from(d);
      d.clear();
      for (const item of items) {
        item.dispose();
      }
    },
    writable: false,
    enumerable: true,
    configurable: true
  });

  scopeInternals.set(instance, internal);

  currentScope = instance;

  let result: T;
  try {
    result = factory();
  } finally {
    currentScope = previousScope;
  }

  if (currentScope) {
    registerWithCurrentScope(instance);
  }

  if (
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result)
  ) {
    internal.snapshotSource = result as Record<string, any>;
  }

  // Empty scopes are immediately not loading
  if (Array.from(d).filter(isAtom).length === 0) {
    localLoading = false;
  }

  return Object.assign(instance, result);
}
