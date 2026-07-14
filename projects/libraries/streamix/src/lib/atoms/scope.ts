import {
  createContainer,
  globalContainer,
  type Container,
  type Factory,
  type RegistrationOptions,
  type Token,
} from "../ioc/container";
import { isAtom, isAtomLike } from "../utils/helpers";
import { atom, derived, NO_INITIAL_VALUE, normalizeError, onAtomDirtyChange, Writable, type Atom } from "./atom";
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
import { isPromiseLike } from "./operator";
import { getGlobalScope, isScope, resolveMode, type RootScope } from "./root";
import type { Subscription } from "./subscription";

/* ── Internal expression markers for scope() ──────────────────────────────── */

const DYNAMIC_EXPR = Symbol("streamix.dynamicExpr");
const METHOD = Symbol("streamix.method");

interface DynamicExpr<T = any, Self = any> {
  [DYNAMIC_EXPR]: true;
  fn: (self: Self, atoms?: any) => Atom<T> | T;
}

type MethodCallback<TSelf = any, TArgs extends any[] = any[], TResult = any> = (self: TSelf, ...args: TArgs) => TResult;
type MethodReturn<T> = T extends (self: any, ...args: infer TArgs) => infer TResult ? (...args: TArgs) => TResult : never;

interface Method<T extends MethodCallback = MethodCallback> {
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

export function method<TSelf, TArgs extends any[], TResult>(fn: (self: TSelf, ...args: TArgs) => TResult): Method<(self: TSelf, ...args: TArgs) => TResult> {
  return { [METHOD]: true, fn };
}

function isExprMarkerOrDynamic(value: any): value is AtomExpr | DerivedExpr | PipeExpr | FlowExpr | DynamicExpr {
  return isExprMarkerBase(value) || isDynamicExpr(value);
}

function unwrapDynamicValue<T>(value: T | Atom<T>): T {
  return value && typeof value === "object" && (value as any).type === "atom"
    ? (value as Atom<T>).value
    : value as T;
}


/**
 * A mutable holder for the "read" function a tracked-self Proxy should call.
 * Kept as a ref (rather than baking the function into the Proxy's closure)
 * so a single Proxy instance can be reused across multiple recomputations of
 * a derived atom -- each recomputation just swaps out `current` instead of
 * allocating a brand-new Proxy. See recommendation 7.
 */
type ReaderRef = { current: <T>(atom: Atom<T>) => T };

function createTrackedScopeSelf(
  scopeSelf: any,
  atoms: ((key: string | symbol) => any) | undefined,
  readerRef: ReaderRef,
): any {
  return new Proxy(function (targetAtom: any) {
    if (isAtom(targetAtom)) {
      return readerRef.current(targetAtom);
    }
    return scopeSelf?.(targetAtom);
  }, {
    get(_target, prop, receiver) {
      if (atoms && (typeof prop === "string" || typeof prop === "symbol")) {
        const value = atoms(prop);
        return isAtom(value) ? readerRef.current(value) : value;
      }
      const result = Reflect.get(scopeSelf, prop, receiver);
      return isAtom(result) ? readerRef.current(result) : result;
    },
    set(_target, prop, value) {
      Reflect.set(scopeSelf, prop, value);
      return true;
    },
  });
}

function evaluateExprMarker(
  marker: AtomExpr | DerivedExpr | PipeExpr | FlowExpr | DynamicExpr,
  self: any,
  atoms?: any,
): Atom<any> {
  if (isAtomExpr(marker)) {
    return atom(marker.initialValue === undefined ? NO_INITIAL_VALUE : marker.initialValue, marker.options);
  }
  if (isDerivedExpr(marker)) {
    // One Proxy for the lifetime of this derived atom; only the active reader
    // changes between recomputations (recommendation 7).
    const readerRef: ReaderRef = {
      current: () => {
        throw new Error("streamix: derived reader accessed outside of an active evaluation");
      },
    };
    const trackedSelf = createTrackedScopeSelf(self, atoms, readerRef);
    return derived((derivedSelf) => {
      readerRef.current = derivedSelf.read.bind(derivedSelf);
      return marker.fn(trackedSelf);
    });
  }
  if (isPipeExpr(marker)) return marker.fn(self, atoms);
  if (isFlowExpr(marker)) return marker.fn(self, atoms);
  if (isDynamicExpr(marker)) {
    // Probe fn() exactly once to determine its shape (atom / expr marker /
    // plain value) and to discover which atoms it reads. This same `value`
    // is reused as the first emission below -- fn is never called twice for
    // the same logical evaluation. It's only re-invoked later when a
    // dependency actually changes, which is normal derived recomputation,
    // not double evaluation.
    const initialDependencies = new Set<Atom<any>>();
    const initialReaderRef: ReaderRef = {
      current: <T>(dep: Atom<T>) => {
        initialDependencies.add(dep as Atom<any>);
        return dep.value;
      },
    };
    const initialSelf = createTrackedScopeSelf(self, atoms, initialReaderRef);
    const value = marker.fn(initialSelf, atoms);

    if (isAtomLike(value)) {
      return value;
    }

    if (isExprMarkerBase(value)) {
      return evaluateExprMarker(value, self, atoms);
    }

    let seeded = true;
    // Same reuse trick as the DerivedExpr branch: one Proxy, swapped reader.
    const readerRef: ReaderRef = {
      current: () => {
        throw new Error("streamix: derived reader accessed outside of an active evaluation");
      },
    };
    const trackedSelf = createTrackedScopeSelf(self, atoms, readerRef);

    return derived((derivedSelf) => {
      readerRef.current = derivedSelf.read.bind(derivedSelf);

      const attachInitialDependencies = () => {
        for (const dependency of initialDependencies) {
          derivedSelf.read(dependency);
        }
      };

      if (seeded) {
        seeded = false;

        if (isPromiseLike(value)) {
          return Promise.resolve(value).then(
            (resolvedValue) => {
              attachInitialDependencies();
              return unwrapDynamicValue(resolvedValue);
            },
            (error) => {
              attachInitialDependencies();
              throw error;
            },
          );
        }

        attachInitialDependencies();
        return value;
      }

      const inner = marker.fn(trackedSelf, atoms);
      if (isPromiseLike(inner)) {
        return Promise.resolve(inner).then((resolvedValue) => unwrapDynamicValue(resolvedValue));
      }
      return unwrapDynamicValue(inner);
    });
  }
  throw new Error("Unknown expression marker");
}

/* ── Type System Definitions ────────────────────────────────────────────────── */

type UnwrapSnapshotValues<T> = {
  [K in keyof T]: T[K] extends Scope<infer U>
    ? UnwrapSnapshotValues<U>
    : T[K] extends { value: infer U }
      ? U
      : T[K] extends Record<string, any>
        ? UnwrapSnapshotValues<T[K]>
        : T[K];
};

/**
 * Widens literal primitives and readonly arrays into the mutable public value shape
 * exposed by scope proxies and atoms.
 */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Widens literal primitives and readonly arrays into the mutable public value shape
 * exposed by scope proxies and atoms.
 */
export type WidenValue<T> =
  T extends string ? string
  : T extends number ? number
  : T extends boolean ? boolean
  : T extends bigint ? bigint
  : T extends symbol ? symbol
  : T extends readonly (infer U)[] ? WidenValue<U>[]
  : T;

/**
 * Converts atom-backed scope members into their public value shape.
 */
export type UnwrapScopeValues<T> = {
  [K in keyof T]: T[K] extends Atom<infer U> ? WidenValue<U> : T[K];
};

/**
 * Resolves the atom type associated with a scope field.
 */
export type AtomOf<T> = T extends Writable<infer U> ? Writable<U> : T extends Atom<infer U> ? Atom<U> : never;
/**
 * Extracts the runtime value type from an atom.
 */
export type AtomValueOf<T> = T extends Atom<infer U> ? U : never;

/**
 * Accessor surface used by `scope.at`, exposing raw atoms by property or key lookup.
 */
export type AtomAccessor<T> = { [K in keyof T]: AtomOf<T[K]> } & (<K extends keyof T>(key: K) => AtomOf<T[K]>);
type DefinedAtomAccessor<Shape extends Record<string, any>> = { [K in keyof Shape]: Atom<Shape[K]> } & (<K extends keyof Shape>(key: K) => Atom<Shape[K]>);

type DefinedValue<Top extends Record<string, any>, T> =
  | T
  | Method<T extends (...args: any[]) => infer TResult ? (self: any, ...args: Parameters<T>) => TResult : never>
  | AtomExpr<T>
  | DerivedExpr<T, Top>
  | PipeExpr<T, Top>
  | FlowExpr<T, Top>
  | ((self: Top, atoms: DefinedAtomAccessor<Top>) => T | Promise<T> | Atom<T>);

/**
 * Normalizes shorthand scope member definitions into their owned runtime node shape.
 */
export type ScopeValue<T> =
  | T extends ScopeReturn<any> ? T
  : T extends Atom<any> ? T
  : T extends Scope<infer U> ? ScopeReturn<ScopeOf<U>>
  : T extends Method<infer TFn> ? MethodReturn<TFn>
  : T extends (...args: any[]) => any ? T
  : T extends readonly any[] ? Writable<T>
  : T extends DerivedExpr<infer U, any> ? Atom<U>
  : T extends PipeExpr<infer U, any> ? Atom<U>
  : T extends FlowExpr<infer U, any> ? Atom<U>
  : T extends AtomExpr<infer U> ? Writable<U>
  : T extends Record<string, any> ? ScopeReturn<ScopeOf<T>> : Writable<T>;

type ScopeOf<T extends Record<string, any>> = { [K in keyof T]: ScopeValue<T[K]>; };

/**
 * Resolves the public runtime type of a function-valued scope member.
 */
export type ScopeResolvedFunctionValue<TResult> =
  Awaited<TResult> extends ScopeReturn<any> ? Awaited<TResult>
  : Awaited<TResult> extends Scope<infer U> ? ScopeReturn<ScopeOf<U>>
  : Awaited<TResult> extends Writable<any> ? Awaited<TResult>
  : Awaited<TResult> extends Atom<any> ? Awaited<TResult>
  : Awaited<TResult> extends AtomExpr<infer U> ? Writable<WidenValue<U>>
  : Awaited<TResult> extends DerivedExpr<infer U, any> ? Atom<U>
  : Awaited<TResult> extends PipeExpr<infer U, any> ? Atom<U>
  : Awaited<TResult> extends FlowExpr<infer U, any> ? Atom<U>
  : Atom<WidenValue<Awaited<TResult>>>;

/**
 * Resolves config-form scope member definitions into their public runtime type.
 */
export type ScopeResolvedValue<T> =
  T extends ScopeReturn<any> ? T
  : T extends Scope<infer U> ? ScopeReturn<ScopeOf<U>>
  : T extends Method<infer TFn> ? MethodReturn<TFn>
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

/**
 * Applies {@link ScopeResolvedValue} across a config object.
 */
export type ScopeOfConfig<T extends Record<string, any>> = { [K in keyof T]: ScopeResolvedValue<T[K]>; };

/**
 * Converts an atom-backed member into the value shape exposed on the scope proxy.
 */
export type ScopePublicValue<T> = T extends Atom<infer U> ? WidenValue<U> : T;
/**
 * Return type allowed from the optional `scope(..., setup)` callback.
 */
export type ScopeSetupResult = Record<string | symbol, any> | void;
/**
 * Maps a setup callback return value into the extension surface added to the scope.
 */
export type ScopeSetupReturn<T> = T extends void ? {} : T;
type ScopeSetupReturnFromArg<T> = T extends (...args: any[]) => infer TResult ? ScopeSetupReturn<TResult> : {};
/**
 * Wrapped scope surface exposed as the first `self` parameter in setup callbacks.
 */
export type ScopeSetupSelf<T extends Record<string, any>> = T & Scope;
/**
 * Wrapped scope surface exposed as the first `self` parameter in config-form setup callbacks.
 */
export type ScopeSetupSelfFromConfig<T extends Record<string, any>> = T & Scope;
type ScopeSetupCallback<TSelf, TScope> = (self: TSelf, scope: TScope) => ScopeSetupResult;
/**
 * Options that control how a scope batches and emits updates.
 */
export type ScopeOptions = {
  /**
   * Notification mode for atoms created inside the scope.
   *
   * `discrete` emits synchronously. `analog` batches/coalesces updates until the
   * scheduler flushes them.
   */
  mode?: "discrete" | "analog";
};
/**
 * Built-in atoms that every scope owns in addition to user-defined state.
 */
export type ScopeReservedAtoms = {
  loading: Writable<boolean>;
  dirty: Writable<boolean>;
};

/**
 * Predicate used to determine whether a config-form scope member becomes readonly.
 */
export type IsReadonlyScopeConfigValue<T> =
  T extends DerivedExpr<any, any> ? true
  : T extends PipeExpr<any, any> ? true
  : T extends FlowExpr<any, any> ? true
  : T extends (...args: any[]) => any ? true
  : T extends AtomExpr<any> ? false
  : T extends Writable<any> ? false
  : T extends Atom<any> ? true
  : false;

/**
 * Keys of a config-form scope definition that become readonly on the public proxy.
 */
export type ReadonlyScopeConfigKeys<T extends Record<string, any>> = {
  [K in keyof T]-?: IsReadonlyScopeConfigValue<T[K]> extends true ? K : never;
}[keyof T];

/**
 * Keys of a config-form scope definition that remain writable on the public proxy.
 */
export type WritableScopeConfigKeys<T extends Record<string, any>> = Exclude<keyof T, ReadonlyScopeConfigKeys<T>>;

/**
 * Public proxy shape produced from config-form scope definitions.
 */
export type UnwrapScopeValuesFromConfig<T extends Record<string, any>> = {
  readonly [K in ReadonlyScopeConfigKeys<T>]: ScopePublicValue<ScopeResolvedValue<T[K]>>;
} & {
  -readonly [K in WritableScopeConfigKeys<T>]: ScopePublicValue<ScopeResolvedValue<T[K]>>;
};

/**
 * Maps a scope state shape to the raw atom graph used by expression helpers.
 */
export type ScopeAtoms<T> = T extends Record<string, any>
  ? { [K in keyof T]: T[K] extends Scope<infer U> ? ScopeAtoms<U> : AtomOf<ScopeValue<T[K]>> }
  : any;

/**
 * Runtime proxy type returned from `scope()` when the state shape is already normalized.
 */
export type ScopeReturn<T extends Record<string, any>> = Simplify<Scope<T> & UnwrapScopeValues<T> & {
  at: AtomAccessor<T & ScopeReservedAtoms>;
  subscribeTo<K extends keyof (T & ScopeReservedAtoms)>(key: K, callback: (value: AtomValueOf<(T & ScopeReservedAtoms)[K]>) => void): Subscription;
}>;

/**
 * Runtime proxy type returned from `scope()` when using config-form shorthand definitions.
 */
export type ScopeReturnFromConfig<T extends Record<string, any>> = Simplify<Scope<ScopeOfConfig<T>> & UnwrapScopeValuesFromConfig<T> & {
  at: AtomAccessor<ScopeOfConfig<T> & ScopeReservedAtoms>;
  subscribeTo<K extends keyof (ScopeOfConfig<T> & ScopeReservedAtoms)>(key: K, callback: (value: AtomValueOf<(ScopeOfConfig<T> & ScopeReservedAtoms)[K]>) => void): Subscription;
}>;

/**
 * Runtime scope instance.
 *
 * A scope owns the atoms created from a definition object, exposes their current
 * values as properties, and provides lifecycle cleanup through {@link dispose}.
 */
export interface Scope<T extends Record<string, any> = Record<string, any>> {
  /** Runtime discriminator for scope-like values. */
  type: "scope";
  /** Owned atoms and nested scopes. */
  atoms: Set<Atom<any> | Scope>;
  /** Cleanup callbacks that run when the scope is disposed. */
  cleanups: Set<() => void>;
  /** Current notification mode. */
  mode: "discrete" | "analog";
  /** Parent scope or root scope, if this scope was created inside another scope. */
  parent: Scope | RootScope | null;
  /** Dependency-injection container associated with this scope. */
  container: Container;
  /** True until all owned atoms have emitted at least once. */
  readonly loading: boolean;
  /** True when an owned analog atom has a queued update. */
  readonly dirty: boolean;
  /** Returns a plain object snapshot of the current scope values. */
  snapshot(): UnwrapSnapshotValues<T>;
  /** Disposes owned atoms/scopes and runs registered cleanups. */
  dispose(): void;
  /** @internal */ _pendingCount: number;
  /** @internal */ _dirtyCount: number;
  /** @internal */ _exports: Set<string | symbol>;
  /** @internal */ _disposed: boolean;
  /** @internal */ _rawState: Record<string | symbol, any>;
}

/**
 * Accepted normalized definition shape for `scope<T>(...)`.
 *
 * Values become writable atoms, function values become derived values, nested
 * objects become nested scopes, and `method(...)` marks imperative actions.
 */
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
  if (key === "loading" || key === "dirty") return true;
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
      rawState[key] = (...args: any[]) => item.fn(scopeProxy, ...args);
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

  // An unresolved marker's readonly-ness can only change once it resolves
  // into its real underlying atom/value on first read. Once that's already
  // happened (currentItem isn't a marker), the readonly status is settled
  // for the life of this descriptor, so we never need to re-check it again.
  let settled = !isExprMarkerOrDynamic(currentItem);

  const descriptor: PropertyDescriptor = {
    get() {
      const activeItem = read(key);
      if (!settled) {
        const updatedItem = scopeRef._rawState[key];
        if (!isExprMarkerOrDynamic(updatedItem)) {
          settled = true;
          if (isReadonlyScopeStateKey(key, updatedItem) !== readonly) {
            defineScopeStateProperty(scopeRef, key, read);
            return (scopeRef as any)[key];
          }
        }
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

function defineScopeExtensionProperties(scopeRef: Scope, extensions: Record<string | symbol, any>): void {
  for (const key of Reflect.ownKeys(extensions)) {
    if (key === "loading" || key === "dirty" || key === "at" || key === "subscribeTo") {
      throw new Error(`Cannot define reserved scope property: ${String(key)}`);
    }

    if (scopeRef._exports.has(key)) {
      throw new Error(`Cannot define scope extension over existing state key: ${String(key)}`);
    }

    if (Object.prototype.hasOwnProperty.call(scopeRef, key)) {
      throw new Error(`Cannot define scope extension over existing scope property: ${String(key)}`);
    }

    Object.defineProperty(scopeRef, key, {
      value: extensions[key],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
}

function createScopeInternal<T extends Record<string, any>>(
  factory: (this: any, self: any) => any,
  setup?: (self: any, scope: any) => ScopeSetupResult,
  options?: ScopeOptions,
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
    dirty: false,
    snapshot() {
      const out: Record<string, any> = {};
      collectScopeValues(this as any, out);
      return out as any;
    },
    dispose() {
      disposeScope(this);
    },
    _pendingCount: 0,
    _dirtyCount: 0,
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
    let loadingAtom: Writable<boolean>;
    let dirtyAtom: Writable<boolean>;
    currentScope = null;
    try {
      loadingAtom = atom(true);
      dirtyAtom = atom(false);
    } finally {
      currentScope = newScope;
    }

    newScope._rawState["loading"] = loadingAtom;
    newScope._rawState["dirty"] = dirtyAtom;

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
    defineScopeStateProperty(newScope, "dirty", getScopeItem);
    defineAccessorKey("dirty");

    const output = factory.call(newScope, newScope);
    const dataState = (output && output.rawState) ? output.rawState : output;
    resolvedSelf = (output && output.self) ? output.self : newScope;

    if (dataState && typeof dataState === "object") {
      if ("loading" in dataState) {
        console.warn("[streamix] scope(): 'loading' key is reserved and was overwritten.");
      }
      if ("dirty" in dataState) {
        console.warn("[streamix] scope(): 'dirty' key is reserved and was overwritten.");
      }

      newScope._rawState = dataState;

      for (const key of Reflect.ownKeys(dataState)) {
        if (key === "dirty") continue;
        newScope._exports.add(key);
        defineAccessorKey(key);
        defineScopeStateProperty(newScope, key, getScopeItem);
      }
    }

    newScope._rawState["loading"] = loadingAtom;
    newScope._rawState["dirty"] = dirtyAtom;
    defineAccessorKey("loading");
    defineScopeStateProperty(newScope, "loading", getScopeItem);
    defineAccessorKey("dirty");
    defineScopeStateProperty(newScope, "dirty", getScopeItem);

    for (const item of Object.values(newScope._rawState)) {
      if (item && typeof item === "object" && (item as any).type === "scope") {
        (item as Scope).parent = newScope as any;
      }
    }

    trackReferencedWritableLoading(newScope);

    const extensions = setup?.(newScope as any, newScope as any);
    if (extensions != null) {
      if (typeof extensions !== "object") {
        throw new TypeError("scope() setup callback must return an object or void.");
      }
      defineScopeExtensionProperties(newScope, extensions);
    }

    if (newScope._pendingCount === 0 && loadingAtom.value !== false) {
      loadingAtom.next(false);
    }

    newScope.cleanups.add(() => {
      if (!loadingAtom.disposed) loadingAtom.dispose();
      if (!dirtyAtom.disposed) dirtyAtom.dispose();
    });

    return newScope as any;
  } catch (err) {
    disposeScope(newScope);
    throw normalizeError(err);
  } finally {
    currentScope = previousScope;
  }
}

/**
 * Creates a scope from a config factory and optional setup extension.
 *
 * Config-form scopes infer shorthand members directly: values become atoms,
 * functions become readonly derived values, nested objects become nested scopes,
 * and `method(...)` values become callable actions.
 */
export function scope<TConfig extends Record<string, any>, TSetup extends ScopeSetupResult>(
  definition: (this: Simplify<ScopeReturnFromConfig<TConfig>>) => TConfig,
  setup?: (self: ScopeSetupSelfFromConfig<Simplify<UnwrapScopeValuesFromConfig<TConfig>>>, scope: ScopeReturnFromConfig<TConfig>) => TSetup,
  options?: ScopeOptions,
): ScopeReturnFromConfig<TConfig> & ScopeSetupReturn<TSetup>;
/**
 * Creates a scope from a plain object definition and optional setup extension.
 *
 * Use this form for the best inference:
 *
 * ```ts
 * const counter = scope({ count: 0 }, self => ({
 *   increment: () => {
 *     self.count++;
 *   },
 * }));
 * ```
 */
export function scope<TConfig extends Record<string, any>, TSetup extends ScopeSetupResult>(
  definition: TConfig,
  setup?: (self: ScopeSetupSelfFromConfig<Simplify<UnwrapScopeValuesFromConfig<TConfig>>>, scope: ScopeReturnFromConfig<TConfig>) => TSetup,
  options?: ScopeOptions,
): ScopeReturnFromConfig<TConfig> & ScopeSetupReturn<TSetup>;
/**
 * Creates a scope from a config factory.
 */
export function scope<TConfig extends Record<string, any>>(definition: (this: Simplify<ScopeReturnFromConfig<TConfig>>) => TConfig, options?: ScopeOptions): ScopeReturnFromConfig<TConfig>;
/**
 * Creates a scope from a plain object definition.
 */
export function scope<TConfig extends Record<string, any>>(definition: TConfig, options?: ScopeOptions): ScopeReturnFromConfig<TConfig>;
/**
 * Creates a scope with an explicit normalized state shape.
 *
 * Use when the public state shape is known up front. If setup adds dynamic
 * methods and you also want a declared base interface, prefer:
 *
 * ```ts
 * interface Shape {
 *   count: number;
 * }
 *
 * const definition = { count: 0 } satisfies Shape;
 * const counter = scope(definition, self => ({
 *   increment: () => {
 *     self.count++;
 *   },
 * }));
 * ```
 */
export function scope<T extends Record<string, any>>(
  definition: (this: ScopeReturn<ScopeOf<T>>) => ScopeConfig<T>,
  ...args: [setup: ScopeSetupCallback<ScopeSetupSelf<Simplify<UnwrapScopeValues<ScopeOf<T>>>>, ScopeReturn<ScopeOf<T>>>, options?: ScopeOptions] | [options?: ScopeOptions]
): ScopeReturn<ScopeOf<T>> & ScopeSetupReturnFromArg<typeof args[0]>;
/**
 * Creates a scope with an explicit normalized state shape from an object
 * definition.
 */
export function scope<T extends Record<string, any>>(
  definition: ScopeConfig<T>,
  ...args: [setup: ScopeSetupCallback<ScopeSetupSelf<Simplify<UnwrapScopeValues<ScopeOf<T>>>>, ScopeReturn<ScopeOf<T>>>, options?: ScopeOptions] | [options?: ScopeOptions]
): ScopeReturn<ScopeOf<T>> & ScopeSetupReturnFromArg<typeof args[0]>;
export function scope(
  definition: any,
  setupOrOptions?: ((self: any, scope: any) => ScopeSetupResult) | ScopeOptions,
  options?: ScopeOptions,
): any {
  const isFactory = typeof definition === "function";
  let setup: ((self: any, scope: any) => ScopeSetupResult) | undefined;
  let resolvedOptions: ScopeOptions | undefined;

  if (typeof setupOrOptions === "function") {
    setup = setupOrOptions;
    resolvedOptions = options;
  } else {
    resolvedOptions = setupOrOptions;
  }

  return createScopeInternal(
    function (this: any, scopeRef: any) {
      const source = isFactory ? definition.call(this) : definition;
      return materializeState(source, new WeakMap(), scopeRef);
    },
    setup,
    resolvedOptions
  );
}

/* ── Scope Disposal ───────────────────────────────────────────────────────── */

export function disposeScope(sc: Scope): void {
  if (sc._disposed) return;
  sc._disposed = true;

  for (const hook of sc.cleanups) {
    try {
      hook();
    } catch (err) {
      console.error("[streamix] scope cleanup hook threw during disposal:", err);
    }
  }
  sc.cleanups.clear();

  updatePendingHierarchy(sc.parent, -sc._pendingCount);
  sc._pendingCount = 0;
  updateDirtyHierarchy(sc.parent, -sc._dirtyCount);
  sc._dirtyCount = 0;

  if (isScope(sc.parent)) {
    sc.parent.atoms.delete(sc);
  }

  for (const activeItem of sc.atoms) {
    try {
      if (!(activeItem as any).disposed) (activeItem as any).dispose();
    } catch (err) {
      console.error("[streamix] atom disposal threw during scope disposal:", err);
    }
  }
  sc.atoms.clear();
  sc.container.dispose().catch((err) => {
    console.error("[streamix] container disposal failed during scope disposal:", err);
  });
}

/* ── Registry Linkage Handlers ───────────────────────────────────────────── */

export function registerWithCurrentScope(atomInstance: Atom<any>): void {
  if (!currentScope) return;

  const targetContext = currentScope;
  targetContext.atoms.add(atomInstance);
  atomScopeRegistry.set(atomInstance, targetContext);

  updatePendingHierarchy(targetContext, 1);
  if (atomInstance.dirty) {
    updateDirtyHierarchy(targetContext, 1);
  }

  const disposers = (atomInstance as any)._onDispose;
  if (disposers instanceof Set) {
    const earlyDetachmentHook = () => {
      targetContext.atoms.delete(atomInstance);
      if (!emittedAtomsRegistry.has(atomInstance) && !targetContext._disposed) {
        updatePendingHierarchy(targetContext, -1);
      }
      if (atomInstance.dirty && !targetContext._disposed) {
        updateDirtyHierarchy(targetContext, -1);
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

  const stopDirtyTracking = onAtomDirtyChange(atomInstance, (dirty) => {
    if (targetContext._disposed) return;
    updateDirtyHierarchy(targetContext, dirty ? 1 : -1);
  });
  targetContext.cleanups.add(() => stopDirtyTracking());
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

function trackReferencedWritableLoading(scopeRef: Scope): void {
  const tracked = new Set<Atom<any>>();

  for (const item of Object.values(scopeRef._rawState)) {
    if (!isAtom(item) || typeof (item as Writable<any>).next !== "function") continue;
    if (atomScopeRegistry.get(item) === scopeRef) continue;
    if (tracked.has(item) || hasAtomEmitted(item)) continue;

    tracked.add(item);
    updatePendingHierarchy(scopeRef, 1);

    let settled = false;
    const disposeHandlers = (item as any)._onDispose;
    let unsubscribe: Subscription | undefined;

    const settle = () => {
      if (settled) return;
      settled = true;

      unsubscribe?.();
      if (disposeHandlers instanceof Set) {
        disposeHandlers.delete(settle);
      }

      if (!scopeRef._disposed) {
        updatePendingHierarchy(scopeRef, -1);
      }
    };

    unsubscribe = item.subscribe(() => settle());
    if (disposeHandlers instanceof Set) {
      disposeHandlers.add(settle);
      scopeRef.cleanups.add(() => disposeHandlers.delete(settle));
    }
    scopeRef.cleanups.add(() => unsubscribe?.());
  }
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

function updateDirtyHierarchy(startNode: Scope | RootScope | null, dynamicDelta: number): void {
  if (dynamicDelta === 0) return;
  let current: Scope | RootScope | null = startNode;

  while (isScope(current) && !current._disposed) {
    current._dirtyCount = Math.max(0, current._dirtyCount + dynamicDelta);
    const dirtyAtom = current._rawState["dirty"] as Writable<boolean> | undefined;

    if (dirtyAtom) {
      const isCurrentlyDirty = current._dirtyCount > 0;
      if (dirtyAtom.value !== isCurrentlyDirty) {
        dirtyAtom.next(isCurrentlyDirty);
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
