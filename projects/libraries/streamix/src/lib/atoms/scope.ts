import type { Atom } from "./atom";

export interface Scope {
  type: "scope";

  name?: string;
  parent?: Scope;

  loading: boolean;

  snapshot(): Record<string, any>;

  dispose(): void;
}

type Node = Atom<any> | Scope;

interface ScopeInternal {
  nodes: Map<string, Node>;
  atoms: Set<Atom<any>>;
  scopes: Set<Scope>;
  emitted: Set<Atom<any>>;
}

const internals = new WeakMap<Scope, ScopeInternal>();

let currentScope: Scope | undefined;

export function getCurrentScope(): Scope | undefined {
  return currentScope;
}

function isAtom(value: any): value is Atom<any> {
  return value?.type === "atom";
}

function isScope(value: any): value is Scope {
  return value?.type === "scope";
}

export function registerWithCurrentScope(node: Node, name?: string): void {
  const scope = currentScope;
  if (!scope) return;

  const internal = internals.get(scope);
  if (!internal) return;

  const key = name ?? (node as any).name ?? `${internal.nodes.size}`;

  internal.nodes.set(key, node);

  if (isAtom(node)) {
    internal.atoms.add(node);

    node.subscribe(() => {
      internal.emitted.add(node);
    });
  }

  if (isScope(node)) {
    internal.scopes.add(node);
  }
}

export function scope<T>(factory: () => T): Scope & T {
  const parent = currentScope;

  const instance: Scope = {
    type: "scope",
    parent,

    get loading() {
      const internal = internals.get(instance)!;

      // still waiting for first emission
      if (internal.atoms.size === 0) return false;

      for (const atom of internal.atoms) {
        if (!internal.emitted.has(atom)) return true;
      }

      return false;
    },

    snapshot() {
      const internal = internals.get(instance)!;

      const result: Record<string, any> = {};

      for (const [key, node] of internal.nodes) {
        if (isAtom(node)) {
          result[key] = node.value;
        } else if (isScope(node)) {
          result[key] = node.snapshot();
        } else {
          result[key] = node;
        }
      }

      return result;
    },

    dispose() {
      const internal = internals.get(instance)!;

      for (const node of internal.nodes.values()) {
        node.dispose();
      }

      internal.nodes.clear();
      internal.atoms.clear();
      internal.scopes.clear();
      internal.emitted.clear();
    }
  };

  const internal: ScopeInternal = {
    nodes: new Map(),
    atoms: new Set(),
    scopes: new Set(),
    emitted: new Set()
  };

  internals.set(instance, internal);

  currentScope = instance;

  let result: T;

  try {
    result = factory();
  } finally {
    currentScope = parent;
  }

  // register returned API (optional explicit structure)
  if (result && typeof result === "object") {
    for (const [key, value] of Object.entries(result as any)) {
      if (isAtom(value) || isScope(value)) {
        registerWithCurrentScope(value, key);
      }
    }
  }

  return Object.assign(instance, result);
}