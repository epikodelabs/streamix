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
  if (isPipeExpr(marker)) return marker.fn(self, atoms);
  if (isFlowExpr(marker)) return marker.fn(self, atoms);
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

type WidenValue<T> =
  T extends string ? string
  : T extends number ? number
  : T extends boolean ? boolean
  : T extends bigint ? bigint
  : T extends symbol ? symbol
  : T extends readonly (infer U)[] ? WidenValue<U>[]
  : T;

type UnwrapScopeValues<T> = {
  [K in keyof T]: T[K] extends Atom<infer U> ? WidenValue<U> : T[K];
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
  : T extends AtomExpr<infer U> ? Writable<U>
  : T extends Record<string, any> ? ScopeReturn<ScopeOf<T>> : Writable<T>;

type ScopeOf<T extends Record<string, any>> = { [K in keyof T]: ScopeValue<T[K]>; };

type ScopeResolvedFunctionValue<TResult> =
  TResult extends ScopeReturn<any> ? TResult
  : TResult extends Scope<infer U> ? ScopeReturn<ScopeOf<U>>
  : TResult extends Writable<any> ? TResult
  : TResult extends Atom<any> ? TResult
  : TResult extends AtomExpr<infer U> ? Writable<WidenValue<U>>
  : TResult extends DerivedExpr<infer U, any> ? Atom<U>
  : TResult extends PipeExpr<infer U, any> ? Atom<U>
  : TResult extends FlowExpr<infer U, any> ? Atom<U>
  : Atom<WidenValue<TResult>>;

type ScopeResolvedValue<T> =
  T extends ScopeReturn<any> ? T
  : T extends Scope<infer U> ? ScopeReturn<ScopeOf<U>>
  : T extends Method<infer TFn> ? TFn
  : T extends Writable<any> ? T
  : T extends Atom<any> ? T
  : T extends AtomExpr<infer U> ? Writable<WidenValue<U>>
  : T extends DerivedExpr<infer U, any> ? Atom<U>
  : T extends PipeExpr<infer U, any> ? Atom<U>
  : T extends FlowExpr<infer U, any> ? Atom<U>
  : T extends (...args: any[]) => infer TResult ? ScopeResolvedFunctionValue<TResult>
  : T extends readonly any[] ? Writable<WidenValue<T>>
  : T extends Record<string, any> ? ScopeReturnFromConfig<T>
  : Writable<WidenValue<T>>;

type ScopeOfConfig<T extends Record<string, any>> = { [K in keyof T]: ScopeResolvedValue<T[K]>; };

type ScopePublicValue<T> = T extends Atom<infer U> ? WidenValue<U> : T;

type IsReadonlyScopeConfigValue<T> =
  T extends DerivedExpr<any, any> ? true
  : T extends PipeExpr<any, any> ? true
  : T extends FlowExpr<any, any> ? true
  : T extends (...args: any[]) => any ? true
  : T extends AtomExpr<any> ? false
  : T extends Writable<any> ? false
  : T extends Atom<any> ? true
  : false;

type ReadonlyScopeConfigKeys<T extends Record<string, any>> = {
  [K in keyof T]-?: IsReadonlyScopeConfigValue<T[K]> extends true ? K : never;
}[keyof T];

type WritableScopeConfigKeys<T extends Record<string, any>> = Exclude<keyof T, ReadonlyScopeConfigKeys<T>>;

type UnwrapScopeValuesFromConfig<T extends Record<string, any>> = {
  readonly [K in ReadonlyScopeConfigKeys<T>]: ScopePublicValue<ScopeResolvedValue<T[K]>>;
} & {
  -readonly [K in WritableScopeConfigKeys<T>]: ScopePublicValue<ScopeResolvedValue<T[K]>>;
};

export type ScopeAtoms<T> = T extends Record<string, any>
  ? { [K in keyof T]: T[K] extends Scope<infer U> ? ScopeAtoms<U> : AtomOf<ScopeValue<T[K]>> }
  : any;

export type ScopeReturn<T extends Record<string, any>> = Scope<T> & UnwrapScopeValues<T> & {
  at: AtomAccessor<T>;
  subscribeTo<K extends keyof T>(key: K, callback: (value: AtomValueOf<T[K]>) => void): Subscription;
};

export type ScopeReturnFromConfig<T extends Record<string, any>> = Scope<ScopeOfConfig<T>> & UnwrapScopeValuesFromConfig<T> & {
  at: AtomAccessor<ScopeOfConfig<T>>;
  subscribeTo<K extends keyof ScopeOfConfig<T>>(key: K, callback: (value: AtomValueOf<ScopeOfConfig<T>[K]>) => void): Subscription;
};

export interface Scope<T extends Record<string, any> = Record<string, any>> {
  type: "scope";
  atoms: Set<Atom<any> | Scope>;
  cleanups: Set<() => void>;
  mode: "discrete" | "analog";
  parent: Scope | RootScope | null;
  container: Container;
  readonly loading: boolean;
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

function isPlainObject(value: any): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (value instanceof Date || value instanceof RegExp || value instanceof Map || value instanceof Set) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function defineCallableAccessorProperty(
  target: Record<string | symbol, any>,
  key: string | symbol,
  read: (key: string | symbol) => any,
): void {
  if (Object.prototype.hasOwnProperty.call(target, key)) return;

  Object.defineProperty(target, key, {
    get: () => read(key),
    enumerable: true,
    configurable: true,
  });
}

function isReadonlyScopeStateKey(key: string | symbol, item: any): boolean {
  if (key === "loading") return true;
  if (isAtomExpr(item)) return false;
  if (isDynamicExpr(item)) return true;
  if (isDerivedExpr(item) || isPipeExpr(item) || isFlowExpr(item)) return true;
  if (isAtomLike(item)) return typeof (item as any).next !== "function";
  return false;
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
      rawState[key] = dynamicExpr(item);
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

  let atomsAccessor: any;

  const resolveRawItem = (key: string | symbol): any => {
    let current = rawState[key];
    if (isExprMarkerOrDynamic(current)) {
      if (evaluating.has(key)) throw new Error(`Circular dependency loop encountered on: ${String(key)}`);
      evaluating.add(key);
      try {
        current = evaluateExprMarker(current, self, atomsAccessor);
        rawState[key] = current;
      } finally {
        evaluating.delete(key);
      }
    }
    return current;
  };

  const getRawAtom = (key: string | symbol): any => {
    return resolveRawItem(key);
  };

  atomsAccessor = (key: string | symbol) => getRawAtom(key);

  for (const key of Reflect.ownKeys(rawState)) {
    defineCallableAccessorProperty(atomsAccessor, key, getRawAtom);
  }

  for (const key of Reflect.ownKeys(rawState)) {
    Object.defineProperty(self, key, {
      get() {
        const current = resolveRawItem(key);
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

function defineScopeStateProperty(
  scopeRef: Scope,
  key: string | symbol,
  read: (key: string | symbol) => any,
): void {
  const currentItem = scopeRef._rawState[key];
  const readonly = isReadonlyScopeStateKey(key, currentItem);

  const descriptor: PropertyDescriptor = {
    get() {
      const activeItem = read(key);
      const updatedItem = scopeRef._rawState[key];
      if (isReadonlyScopeStateKey(key, updatedItem) !== readonly) {
        defineScopeStateProperty(scopeRef, key, read);
      }
      if (activeItem && typeof activeItem === "object") {
        if (activeItem.type === "atom") {
          return activeItem.value;
        }
        if (activeItem.type === "scope") return activeItem;
      }
      return activeItem;
    },
    enumerable: true,
    configurable: true,
  };

  if (!readonly) {
    descriptor.set = (value: any) => {
      const activeItem = read(key);
      if (activeItem && typeof activeItem === "object" && activeItem.type === "atom") {
        if (typeof activeItem.next !== "function") {
          defineScopeStateProperty(scopeRef, key, read);
          throw new TypeError(`Cannot assign to read-only scope property: ${String(key)}`);
        }
        activeItem.next(value);
        return;
      }
      scopeRef._rawState[key] = value;
      defineScopeStateProperty(scopeRef, key, read);
    };
  }

  Object.defineProperty(scopeRef, key, descriptor);
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

    const getScopeItem = (key: string | symbol): any => {
      let current = newScope._rawState[key];
      if (isExprMarkerOrDynamic(current)) {
        const selfRef = resolvedSelf ?? newScope;
        void selfRef[key];
        current = newScope._rawState[key];
      }
      return current;
    };

    const atAccessor: any = (key: string | symbol) => getScopeItem(key);

    const defineAccessorKey = (key: string | symbol) => {
      defineCallableAccessorProperty(atAccessor, key, getScopeItem);
    };

    Object.defineProperties(newScope, {
      at: {
        value: atAccessor,
        enumerable: false,
        configurable: true,
        writable: false,
      },
      subscribeTo: {
        value: (key: string | symbol, callback: Function) => {
          const node = getScopeItem(key);
          if (!node || typeof node.subscribe !== "function") {
            throw new Error(`Cannot subscribe to non-atom structure at key: ${String(key)}`);
          }
          if (emittedAtomsRegistry.has(node)) {
            callback(node.value, node.previous);
          }
          return node.subscribe(callback);
        },
        enumerable: false,
        configurable: true,
        writable: false,
      },
    });

    defineScopeStateProperty(newScope, "loading", getScopeItem);
    defineAccessorKey("loading");

    const output = factory.call(newScope, newScope);
    const dataState = (output && output.rawState) ? output.rawState : output;
    resolvedSelf = (output && output.self) ? output.self : newScope;

    if (dataState && typeof dataState === "object") {
      if ("loading" in dataState) {
        console.warn("[streamix] scope(): 'loading' key is reserved and was overwritten.");
      }

      newScope._rawState = dataState;

      for (const key of Reflect.ownKeys(dataState)) {
        newScope._exports.add(key);
        defineAccessorKey(key);
        defineScopeStateProperty(newScope, key, getScopeItem);
      }
    }

    newScope._rawState["loading"] = loadingAtom;
    defineAccessorKey("loading");
    defineScopeStateProperty(newScope, "loading", getScopeItem);

    for (const item of Object.values(newScope._rawState)) {
      if (item && typeof item === "object" && (item as any).type === "scope") {
        (item as Scope).parent = newScope as any;
      }
    }

    if (newScope._pendingCount === 0 && loadingAtom.value !== false) {
      loadingAtom.next(false);
    }

    newScope.cleanups.add(() => {
      if (!loadingAtom.disposed) loadingAtom.dispose();
    });

    return newScope as any;
  } catch (err) {
    disposeScope(newScope);
    throw normalizeError(err);
  } finally {
    currentScope = previousScope;
  }
}

export function scope<TConfig extends Record<string, any>>(state: TConfig, options?: { mode?: "discrete" | "analog" }): ScopeReturnFromConfig<TConfig>;
export function scope<TConfig extends Record<string, any>>(factory: (this: ScopeReturnFromConfig<TConfig>) => TConfig, options?: { mode?: "discrete" | "analog" }): ScopeReturnFromConfig<TConfig>;
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
