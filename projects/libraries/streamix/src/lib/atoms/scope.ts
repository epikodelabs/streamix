import type { Subscription } from "../abstractions/subscription";
import type { AtomBase } from "./atom";

/**
 * Checks whether a value is an atom.
 *
 * @param value - The value to check.
 * @returns `true` if the value is an atom, otherwise `false`.
 */
function isAtom(value: unknown): value is AtomBase<any> {
  return typeof value === "object" && value !== null && (value as any).type === "atom";
}

/**
 * Checks whether a value is a scope.
 *
 * @param value - The value to check.
 * @returns `true` if the value is a scope, otherwise `false`.
 */
function isScope(value: unknown): value is Scope {
  return typeof value === "object" && value !== null && (value as any).type === "scope";
}

/**
 * A composite container that owns atoms and child scopes.
 *
 * Scopes form a tree via {@link parent}. Each scope automatically tracks
 * every {@link AtomBase} and nested `Scope` created inside its factory.
 *
 * **Loading state**
 *
 * A scope's {@link loading} flag is `true` until every atom in its entire
 * subtree has emitted at least once. Inner scopes can resolve independently;
 * the outer scope waits for everything. Empty scopes (no atoms) are
 * immediately `false`.
 *
 * **Snapshot**
 *
 * {@link snapshot} walks the factory's return object, reading atom values
 * and recursing into child scopes. Non-atom/scope values are passed through
 * unchanged.
 *
 * **Disposal**
 *
 * {@link dispose} tears down every tracked atom or child scope recursively.
 * After disposal the scope should not be used.
 *
 * All tracking happens automatically — no manual bookkeeping is required.
 */
export interface Scope {
  /** Discriminator for runtime type checks. */
  readonly type: "scope";

  /** The scope that was active when this one was created, if any. */
  readonly parent?: Scope;

  /**
   * `true` while any tracked atom (in this scope or a descendant)
   * has not yet emitted its first value.
   */
  readonly loading: boolean;

  /**
   * Captures the current values of all tracked items.
   *
   * For atoms this reads {@link AtomBase.value};
   * for child scopes this recurses into their snapshot.
   * Non-atom/scope values are passed through as-is.
   */
  snapshot(): Record<string, any>;

  /** Disposes every tracked atom or child scope recursively. */
  dispose(): void;
}

interface ScopeInternal {
  tracked: Set<AtomBase<any> | Scope>;
  emittedAtoms: Set<AtomBase<any>>;
  localLoading: boolean;
  snapshotSource?: Record<string, any>;
  checkLoading(): void;
  loadingSubscriptions: Subscription[];
}

const scopeInternals = new WeakMap<Scope, ScopeInternal>();

/** The scope currently executing its factory, if any. */
let currentScope: Scope | undefined;

/** @internal Returns the scope currently executing its factory. */
export function getCurrentScope(): Scope | undefined {
  return currentScope;
}

/** @internal Registers a value with the scope that is currently active. */
export function registerWithCurrentScope(value: AtomBase<any> | Scope): void {
  const scope = currentScope;
  if (!scope) return;

  const internal = scopeInternals.get(scope);
  if (!internal) return;

  internal.tracked.add(value);

  if (isAtom(value)) {
    const sub = value.subscribe(() => {
      internal.emittedAtoms.add(value);
      internal.checkLoading();
    });
    internal.loadingSubscriptions.push(sub);
  }
}

/**
 * Creates a scope.
 *
 * The factory runs with the new scope as the active context. Any atoms or
 * nested scopes created inside the factory are automatically tracked and
 * will be disposed when this scope is disposed. The factory's return value
 * is merged onto the scope object for typed access.
 *
 * @param factory - Setup function that creates atoms and nested scopes.
 * @returns A scope object merged with the factory's return value.
 *
 * @example
 * ```ts
 * const app = scope(() => {
 *   const count = flow(counterStream, 0);
 *   const label = flow(labelStream, 'hello');
 *   return { count, label };
 * });
 *
 * console.log(app.count.value);
 * app.dispose(); // disposes count and label
 * ```
 *
 * @example
 * ```ts
 * // Nested scopes and loading
 * const parent = scope(() => {
 *   const child = scope(() => ({
 *     value: flow(delayedStream, 0)
 *   }));
 *   return { child };
 * });
 *
 * console.log(parent.loading); // true until delayedStream emits
 * ```
 *
 * @see {@link AtomBase}
 */
export function scope<T>(factory: () => T): Scope & T {
  const previousScope = currentScope;

  const tracked = new Set<AtomBase<any> | Scope>();
  const emittedAtoms = new Set<AtomBase<any>>();
  let localLoading = true;

  const internal: ScopeInternal = {
    tracked,
    emittedAtoms,
    localLoading,
    loadingSubscriptions: [],

    checkLoading() {
      if (!localLoading) return;
      const atomCount = Array.from(tracked).filter(isAtom).length;
      if (atomCount === 0 || emittedAtoms.size === atomCount) {
        localLoading = false;
      }
    }
  };

  const instance: Scope = {
    type: "scope",
    parent: previousScope,

    get loading() {
      if (localLoading) return true;
      for (const item of Array.from(tracked)) {
        if (isScope(item) && item.loading) return true;
      }
      return false;
    },

    snapshot() {
      const source = internal.snapshotSource;
      if (!source) return {};

      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(source)) {
        if (isAtom(value)) {
          result[key] = value.disposed ? undefined : value.value;
        } else if (isScope(value)) {
          result[key] = value.snapshot();
        } else {
          result[key] = value;
        }
      }
      return result;
    },

    dispose() {
      for (const sub of internal.loadingSubscriptions) {
        sub.unsubscribe();
      }
      internal.loadingSubscriptions.length = 0;
      for (const item of Array.from(tracked)) {
        item.dispose();
      }
      tracked.clear();
      emittedAtoms.clear();
      internal.snapshotSource = undefined;
    }
  };

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

  // Warn about properties that would overwrite Scope methods
  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    for (const key of Object.keys(result)) {
      if (key in instance) {
        console.warn(
          `Scope factory property "${key}" conflicts with the Scope interface and will overwrite it.`
        );
      }
    }
  }

  // Empty scopes are immediately not loading
  if (Array.from(tracked).filter(isAtom).length === 0) {
    localLoading = false;
  }

  return Object.assign(instance, result);
}
