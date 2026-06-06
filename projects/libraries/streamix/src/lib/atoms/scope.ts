import type { Atom } from "./atom";

/**
 * A composite container that owns atoms and child scopes.
 *
 * Scopes form a tree via {@link parent} and support bulk snapshotting
 * and recursive disposal. Items created inside a scope factory are
 * registered automatically — no manual bookkeeping is required.
 */
export interface Scope {
  /** The scope that was active when this one was created, if any. */
  readonly parent?: Scope;

  /**
   * Captures the current values of all tracked atoms and scopes.
   *
   * For child scopes this recurses into their snapshot;
   * for atoms it reads {@link Atom.value}.
   */
  snapshot(): any[];

  /** Disposes every tracked atom or child scope recursively. */
  dispose(): void;
}

const scopeState = new WeakMap<Scope, { tracked: Set<Atom<any> | Scope> }>();

let currentScope: Scope | undefined;

/** @internal Returns the scope currently executing its factory. */
export function getCurrentScope(): Scope | undefined {
  return currentScope;
}

/** @internal Registers a value with the scope that is currently active. */
export function registerWithCurrentScope(value: Atom<any> | Scope): void {
  const scope = currentScope;
  if (scope) {
    scopeState.get(scope)?.tracked.add(value);
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
  const tracked = new Set<Atom<any> | Scope>();

  const instance: Scope = {
    parent: previousScope,

    snapshot() {
      const result: any[] = [];
      for (const item of tracked) {
        if ("snapshot" in item) {
          result.push(item.snapshot());
        } else {
          result.push(item.value);
        }
      }
      return result;
    },

    dispose() {
      for (const item of tracked) {
        item.dispose();
      }
      tracked.clear();
    }
  };

  scopeState.set(instance, { tracked });

  currentScope = instance;

  let result: T;
  try {
    result = factory();
  } finally {
    currentScope = previousScope;
  }

  if (currentScope) {
    scopeState.get(currentScope)?.tracked.add(instance);
  }

  return Object.assign(instance, result);
}
