import {
  createContainer,
  globalContainer,
  type Container,
  type Factory,
  type RegistrationOptions,
  type Token,
} from "../ioc/container";
import { isAtom, isAtomLike } from "../utils/helpers";
import { atom, derived, NO_INITIAL_VALUE, normalizeError, Writable, type Atom } from "./atom";
import {
  isAtomExpr,
  isDerivedExpr,
  isExprMarker as isExprMarkerBase,
  isFlowExpr,
  isPipeExpr,
  type AtomExpr,
  type DerivedExpr,
  type FlowExpr,
  type PipeExpr,
} from "./expr";
import { getGlobalScope, isScope, resolveMode, type RootScope } from "./root";
import type { Subscription } from "./subscription";

/* ── Internal expression markers for scope() ──────────────────────────────── */

const DYNAMIC_EXPR = Symbol("streamix.dynamicExpr");
const METHOD = Symbol("streamix.method");
const DYNAMIC_ATOM_FACTORY_EXPR = Symbol("streamix.dynamicAtomFactoryExpr");

interface DynamicAtomFactoryExpr<T = any, Self = any> {
  [DYNAMIC_ATOM_FACTORY_EXPR]: true;
  fn: (self: Self, atoms?: any) => Atom<T>;
}
interface DynamicExpr<T = any, Self = any> {
  [DYNAMIC_EXPR]: true;
  fn: (self: Self, atoms?: any) => Atom<T> | T;
}

interface Method<T extends (...args: any[]) => any = (...args: any[]) => any> {
  [METHOD]: true;
  fn: T;
}

function isDynamicExpr(value: any): value is DynamicExpr {
  return value != null && typeof value === "object" && value[DYNAMIC_EXPR] === true;
}

function dynamicExpr<T, Self = any>(fn: (self: Self, atoms?: any) => Atom<T> | T): DynamicExpr<T, Self> {
  return { [DYNAMIC_EXPR]: true, fn };
}

function isMethod(value: any): value is Method {
  return value != null && typeof value === "object" && value[METHOD] === true;
}

export function method<T extends (...args: any[]) => any>(fn: T): Method<T> {
  return { [METHOD]: true, fn };
}

function isExprMarkerOrDynamic(value: any): value is AtomExpr | DerivedExpr | PipeExpr | FlowExpr | DynamicExpr {
  return isExprMarkerBase(value) || isDynamicExpr(value);
}

function evaluateExprMarker(
  marker: AtomExpr | DerivedExpr | PipeExpr | FlowExpr | DynamicExpr | DynamicAtomFactoryExpr,
  self: any,
  atoms?: any,
): Atom<any> {
  if (isAtomExpr(marker)) {
    return atom(marker.initialValue === undefined ? NO_INITIAL_VALUE : marker.initialValue, marker.options);
  }
  if (isDerivedExpr(marker)) return derived(() => marker.fn(self));
  if (isPipeExpr(marker)) return marker.fn(self);
  if (isFlowExpr(marker)) return marker.fn(self);
  if (isDynamicExpr(marker)) {
    const value = marker.fn(self, atoms);

    // If the factory returns an atom, a pipe, or a flow, return it directly.
    if (isAtomLike(value)) {
      return value;
    }

    // If the factory returned a nested FlowExpr/PipeExpr/AtomExpr, evaluate it directly!
    if (isExprMarkerBase(value)) {
      return evaluateExprMarker(value, self, atoms);
    }
    
    return derived(() => {
      const inner = marker.fn(self, atoms);
      return inner && typeof inner === "object" && (inner as any).type === "atom"
        ? (inner as Atom<any>).value
        : inner;
    });
  }
  throw new Error("Unknown expression marker");
}

/* ── Type System Definitions ────────────────────────────────────────────────── */

type UnwrapSnapshotValues<T> = {
  [K in keyof T]: T[K] extends Scope<infer U>
    ? UnwrapSnapshotValues<U>
    : T[K] extends Scope & Record<string, any>
      ? UnwrapSnapshotValues<T[K]>
      : T[K] extends { value: infer U }
        ? U
        : T[K] extends Record<string, any>
          ? UnwrapSnapshotValues<T[K]>
          : T[K];
};

type UnwrapScopeValues<T> = {
  [K in keyof T]: T[K] extends Atom<infer U> ? U : T[K];
};

type AtomOf<T> = T extends Writable<infer U> ? Writable<U> : T extends Atom<infer U> ? Atom<U> : never;
type AtomValueOf<T> = T extends Atom<infer U> ? U : never;

type AtomAccessor<T> = { [K in keyof T]: AtomOf<T[K]> } & (<K extends keyof T>(key: K) => AtomOf<T[K]>);
type DefinedAtomAccessor<Shape extends Record<string, any>> = { [K in keyof Shape]: Atom<Shape[K]> } & (<K extends keyof Shape>(key: K) => Atom<Shape[K]>);

type DefinedValue<Top extends Record<string, any>, T> =
  | T
  | Method<T extends (...args: any[]) => any ? T : never>
  | AtomExpr<T>
  | DerivedExpr<T, Top>
  | PipeExpr<T, Top>
  | FlowExpr<T, Top>
  | ((self: Top, atoms: DefinedAtomAccessor<Top>) => T | Atom<T>);

type ScopeValue<T> =
  | T extends ScopeReturn<any> ? T
  : T extends Atom<any> ? T
  : T extends Scope<infer U> ? ScopeReturn<ScopeOf<U>>
  : T extends (...args: any[]) => any ? T
  : T extends readonly any[] ? Writable<T>
  : T extends DerivedExpr<infer U, any> ? Atom<U>
  : T extends PipeExpr<infer U, any> ? Atom<U>
  : T extends FlowExpr<infer U, any> ? Atom<U>
  : T extends AtomExpr<infer U> ? Atom<U>
  : T extends Record<string, any> ? ScopeReturn<ScopeOf<T>> : Writable<T>;

type ScopeOf<T extends Record<string, any>> = { [K in keyof T]: ScopeValue<T[K]>; };

export type ScopeReturn<T extends Record<string, any>> = Scope<T> & UnwrapScopeValues<T> & {
  at: AtomAccessor<T>;
  subscribeTo<K extends keyof T>(key: K, callback: (value: AtomValueOf<T[K]>) => void): Subscription;
};

export interface Scope<T extends Record<string, any> = Record<string, any>> {
  type: "scope";
  atoms: Set<Atom<any> | Scope>;
  cleanups: Set<() => void>;
  mode: "discrete" | "analog";
  parent: Scope | RootScope | null;
  container: Container;
  loading: boolean;
  snapshot(): UnwrapSnapshotValues<T>;
  dispose(): void;
  /** @internal */ _pendingCount: number;
  /** @internal */ _exports: Set<string | symbol>;
  /** @internal */ _disposed: boolean;
  /** @internal */ _rawState: Record<string | symbol, any>;
}

export type ScopeConfig<T extends Record<string, any>> = DefinedInput<T> & ThisType<ScopeReturn<ScopeOf<T>>>;

export type DefinedInput<Top extends Record<string, any>, Shape extends Record<string, any> = Top> = {
  [K in keyof Shape]: Shape[K] extends Scope<any>
    ? Shape[K]
    : Shape[K] extends readonly any[]
      ? DefinedValue<Top, Shape[K]>
      : Shape[K] extends Record<string, any>
        ? DefinedInput<Top, Shape[K]> | DefinedValue<Top, Shape[K]>
        : DefinedValue<Top, Shape[K]>;
};

let currentScope: Scope | null = null;
const atomScopeRegistry = new WeakMap<Atom<any>, Scope>();
const emittedAtomsRegistry = new WeakSet<Atom<any>>();

export const getCurrentScope = (): Scope | null => currentScope;
export const getScopeMode = (scope: Scope): "discrete" | "analog" => scope.mode ?? "discrete";
export const setCurrentScope = (scope: Scope | null): Scope | null => {
  const previous = currentScope;
  currentScope = scope;
  return previous;
};

/* ── IoC Helpers ──────────────────────────────────────────────────────────── */

export function provide<T>(token: Token<T>, factory: Factory<T>, options?: RegistrationOptions<T>): void {
  const container = currentScope?.container ?? globalContainer;
  container.register(token, factory, options);
}

export function inject<T>(token: Token<T>): T {
  return (currentScope?.container ?? globalContainer).resolve(token, currentScope);
}

export function injectOptional<T>(token: Token<T>): T | undefined {
  return (currentScope?.container ?? globalContainer).resolveOptional(token, currentScope);
}

/* ── Context Lifecycle Management ─────────────────────────────────────────── */

const INTERNAL_SCOPE_KEYS = new Set<string | symbol>([
  "type", "atoms", "cleanups", "mode", "parent", "container", 
  "snapshot", "dispose", "_pendingCount", "_exports", "_disposed", "_rawState", "at"
]);

function isPlainObject(value: any): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (value instanceof Date || value instanceof RegExp || value instanceof Map || value instanceof Set) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function materializeState(
  input: any,
  visited: WeakMap<object, boolean>,
  scopeProxy: any
): { rawState: Record<string | symbol, any>; self: any } {
  const rawState: Record<string | symbol, any> = {};
  const evaluating = new Set<string | symbol>();

  for (const key of Reflect.ownKeys(input)) {
    const item = input[key];
    if (isExprMarkerOrDynamic(item)) {
      rawState[key] = item;
    } else if (isMethod(item)) {
      rawState[key] = item.fn.bind(scopeProxy);
    } else if (typeof item === "function") {
      const dummyAtoms = new Proxy({}, {
        get: () => undefined,
        has: () => false,
        ownKeys: () => [],
        getOwnPropertyDescriptor: () => undefined
      });
      const evaluated = item(scopeProxy, dummyAtoms);
      if (typeof evaluated === "function") {
        rawState[key] = evaluated;
      } else {
        rawState[key] = dynamicExpr(item);
      }
    } else if (isAtomLike(item) || isScope(item)) {
      rawState[key] = item;
    } else if (isPlainObject(item)) {
      if (visited.has(item)) throw new Error(`Circular reference detected at key: ${String(key)}`);
      visited.set(item, true);
      try {
        rawState[key] = createScopeInternal(() => materializeState(item, visited, scopeProxy));
      } finally {
        visited.delete(item);
      }
    } else {
      rawState[key] = atom(item);
    }
  }

  const self: any = function (targetAtom: any) {
    if (isAtom(targetAtom)) {
      return targetAtom.value; // Let targetAtom.value handle dependency tracking intrinsically
    }
  };

  const getRawAtom = (key: string | symbol): any => {
    let current = rawState[key];
    if (isExprMarkerOrDynamic(current)) {
      void self[key]; 
      current = rawState[key];
    }
    return current;
  };

  const atomsProxy = new Proxy(getRawAtom, {
    get: (_, key) => (typeof key === "symbol" && key in getRawAtom) ? (getRawAtom as any)[key] : getRawAtom(key),
    has: (_, key) => key in rawState,
    ownKeys: () => Reflect.ownKeys(rawState),
    getOwnPropertyDescriptor: (_, key) => Object.getOwnPropertyDescriptor(rawState, key)
  });

  for (const key of Reflect.ownKeys(rawState)) {
    Object.defineProperty(self, key, {
      get() {
        let current = rawState[key];
        if (isExprMarkerOrDynamic(current)) {
          if (evaluating.has(key)) throw new Error(`Circular dependency loop encountered on: ${String(key)}`);
          evaluating.add(key);
          try {
            current = evaluateExprMarker(current, self, atomsProxy);
            rawState[key] = current;
          } finally {
            evaluating.delete(key);
          }
        }
        if (isAtom(current)) {
          return current.value; // Prevent redundant context dependencies appends
        }
        return current;
      },
      set(nextVal: any) {
        const current = rawState[key];
        if (isAtomLike(current) && typeof (current as any).next === "function") {
          (current as any).next(nextVal);
        } else {
          rawState[key] = nextVal;
        }
      },
      enumerable: true,
      configurable: true
    });
  }

  // Materialize dependencies safely
  for (const key of Reflect.ownKeys(rawState)) {
    if (isExprMarkerOrDynamic(rawState[key])) {
      void self[key];
    }
  }

  return { rawState, self };
}

function createScopeInternal<T extends Record<string, any>>(
  factory: (this: any, self: any) => any,
  options?: { mode?: "discrete" | "analog" },
): ScopeReturn<T> {
  const parent = currentScope ?? getGlobalScope();
  const mode = resolveMode(options, parent);
  let resolvedSelf: any;

  const parentContainer = isScope(parent) ? parent.container : globalContainer;
  const newScope: Scope = {
    type: "scope",
    atoms: new Set(),
    cleanups: new Set(),
    mode,
    parent,
    container: createContainer(parentContainer),
    loading: true,
    snapshot() {
      const out: Record<string, any> = {};
      collectScopeValues(this as any, out);
      return out as any;
    },
    dispose() {
      disposeScope(this);
    },
    _pendingCount: 0,
    _exports: new Set(),
    _disposed: false,
    _rawState: {},
  };

  if (isScope(parent)) {
    parent.atoms.add(newScope);
  }

  const previousScope = currentScope;
  currentScope = newScope;

  try {
    // Safely instantiate loading atom ensuring clean global scope context reversal
    let loadingAtom: any;
    currentScope = null;
    try {
      loadingAtom = atom(true);
    } finally {
      currentScope = newScope;
    }

    newScope._rawState["loading"] = loadingAtom;

    const atAccessor: any = Object.assign(
      (key: string | symbol) => {
        let current = newScope._rawState[key];
        if (isExprMarkerOrDynamic(current)) {
          void resolvedSelf[key];
          current = newScope._rawState[key];
        }
        return current;
      },
      { loading: loadingAtom }
    );

    const defineAccessorKey = (key: string | symbol) => {
      if (key in atAccessor) return;
      Object.defineProperty(atAccessor, key, {
        get: () => atAccessor(key),
        enumerable: true,
        configurable: true
      });
    };

    const scopeProxy = new Proxy(newScope, {
      get(target, prop, receiver) {
        if (prop === "at") return atAccessor;
        if (prop === "subscribeTo") {
          return (key: string | symbol, callback: Function) => {
            const node = target._rawState[key];
            if (!node || typeof node.subscribe !== "function") {
              throw new Error(`Cannot subscribe to non-atom structure at key: ${String(key)}`);
            }
            if (emittedAtomsRegistry.has(node)) {
              callback(node.value, node.previous);
            }
            return node.subscribe(callback);
          };
        }
        if (INTERNAL_SCOPE_KEYS.has(prop)) return Reflect.get(target, prop, receiver);

        const activeItem = target._rawState[prop];
        if (activeItem && typeof activeItem === "object") {
          if (activeItem.type === "atom") {
            return activeItem.value;
          }
          if (activeItem.type === "scope") return activeItem;
        }
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver): boolean {
        if (INTERNAL_SCOPE_KEYS.has(prop)) return Reflect.set(target, prop, value, receiver);
        const activeItem = target._rawState[prop];
        if (activeItem && typeof activeItem === "object" && activeItem.type === "atom") {
          if (typeof activeItem.next !== "function") return false;
          activeItem.next(value);
          return true;
        }
        target._rawState[prop] = value;
        return Reflect.set(target, prop, value, receiver);
      }
    });

    const output = factory.call(scopeProxy, scopeProxy);
    const dataState = (output && output.rawState) ? output.rawState : output;
    resolvedSelf = (output && output.self) ? output.self : scopeProxy;

    if (dataState && typeof dataState === "object") {
      if ("loading" in dataState) {
        console.warn("[streamix] scope(): 'loading' key is reserved and was overwritten.");
      }

      Object.assign(newScope, dataState);
      newScope._rawState = dataState;

      for (const key of Reflect.ownKeys(dataState)) {
        newScope._exports.add(key);
        defineAccessorKey(key);
      }
    }

    newScope._rawState["loading"] = loadingAtom;
    defineAccessorKey("loading");

    for (const item of Object.values(newScope._rawState)) {
      if (item && typeof item === "object" && (item as any).type === "scope") {
        (item as Scope).parent = scopeProxy as any;
      }
    }

    if (newScope._pendingCount === 0 && loadingAtom.value !== false) {
      loadingAtom.next(false);
    }

    newScope.cleanups.add(() => {
      if (!loadingAtom.disposed) loadingAtom.dispose();
    });

    return scopeProxy as any;
  } catch (err) {
    disposeScope(newScope);
    throw normalizeError(err);
  } finally {
    currentScope = previousScope;
  }
}

export function scope<T extends Record<string, any>>(state: ScopeConfig<T>, options?: { mode?: "discrete" | "analog" }): ScopeReturn<ScopeOf<T>>;
export function scope<T extends Record<string, any>>(factory: (this: ScopeReturn<ScopeOf<T>>) => ScopeConfig<T>, options?: { mode?: "discrete" | "analog" }): ScopeReturn<ScopeOf<T>>;
export function scope(arg: any, options?: any): any {
  const isFn = typeof arg === "function";
  return createScopeInternal(
    function (this: any, scopeProxy: any) {
      const source = isFn ? arg.call(this) : arg;
      return materializeState(source, new WeakMap(), scopeProxy);
    },
    options
  );
}

/* ── Scope Disposal ───────────────────────────────────────────────────────── */

export function disposeScope(sc: Scope): void {
  if (sc._disposed) return;
  sc._disposed = true;

  for (const hook of sc.cleanups) {
    try { hook(); } catch {}
  }
  sc.cleanups.clear();

  updatePendingHierarchy(sc.parent, -sc._pendingCount);
  sc._pendingCount = 0;

  if (isScope(sc.parent)) {
    sc.parent.atoms.delete(sc);
  }

  for (const activeItem of sc.atoms) {
    try {
      if (!(activeItem as any).disposed) (activeItem as any).dispose();
    } catch {}
  }
  sc.atoms.clear();
  sc.container.dispose().catch(() => {});
}

/* ── Registry Linkage Handlers ───────────────────────────────────────────── */

export function registerWithCurrentScope(atomInstance: Atom<any>): void {
  if (!currentScope) return;

  const targetContext = currentScope;
  targetContext.atoms.add(atomInstance);
  atomScopeRegistry.set(atomInstance, targetContext);

  updatePendingHierarchy(targetContext, 1);

  const disposers = (atomInstance as any)._onDispose;
  if (disposers instanceof Set) {
    const earlyDetachmentHook = () => {
      targetContext.atoms.delete(atomInstance);
      if (!emittedAtomsRegistry.has(atomInstance) && !targetContext._disposed) {
        updatePendingHierarchy(targetContext, -1);
      }
    };
    disposers.add(earlyDetachmentHook);
    targetContext.cleanups.add(() => disposers.delete(earlyDetachmentHook));
  }

  try {
    const unsub = atomInstance.subscribe(() => markAtomAsEmitted(atomInstance));
    targetContext.cleanups.add(() => {
      if (!(atomInstance as any).disposed) unsub();
    });
  } catch {}
}

export function markAtomAsEmitted(atomInstance: Atom<any>): void {
  if (emittedAtomsRegistry.has(atomInstance)) return;
  emittedAtomsRegistry.add(atomInstance);

  const contextRef = atomScopeRegistry.get(atomInstance);
  if (contextRef) updatePendingHierarchy(contextRef, -1);
}

export function hasAtomEmitted(atomInstance: Atom<any>): boolean {
  return emittedAtomsRegistry.has(atomInstance);
}

/* ── Hierarchical Structural Loading State Engine ─────────────────────────── */

function updatePendingHierarchy(startNode: Scope | RootScope | null, dynamicDelta: number): void {
  if (dynamicDelta === 0) return;
  let current: Scope | RootScope | null = startNode;

  while (isScope(current) && !current._disposed) {
    current._pendingCount = Math.max(0, current._pendingCount + dynamicDelta);
    const loadingAtom = current._rawState["loading"] as Writable<boolean> | undefined;
    
    if (loadingAtom) {
      const isCurrentlyLoading = current._pendingCount > 0;
      if (loadingAtom.value !== isCurrentlyLoading) {
        loadingAtom.next(isCurrentlyLoading);
      }
    }
    current = current.parent;
  }
}

/* ── Snapshot Generation ─────────────────────────────────────────────────── */

function collectScopeValues(sc: Scope, result: Record<string, any>): void {
  for (const key of sc._exports) {
    const instance = sc._rawState[key];
    if (instance && typeof instance === "object") {
      if (instance.type === "atom") {
        try {
          result[key as string] = instance.value;
        } catch {
          result[key as string] = instance.safeValue;
        }
      } else if (instance.type === "scope") {
        result[key as string] = (instance as Scope).snapshot();
      } else {
        result[key as string] = instance;
      }
    } else {
      result[key as string] = instance;
    }
  }
}