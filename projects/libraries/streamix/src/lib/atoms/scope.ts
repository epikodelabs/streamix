import {
  createContainer,
  globalContainer,
  type Container,
  type Factory,
  type RegistrationOptions,
  type Token,
} from "../ioc/container";
import { isAtom, isAtomLike } from "../utils/helpers";
import {
  asReadable,
  atom,
  derived,
  getCurrentFormulaContext,
  NO_INITIAL_VALUE,
  normalizeError,
  onAtomDirtyChange,
  onAtomEmit,
  trackDependencies,
  Writable,
  type Atom,
  type DependencySource,
  type Readable,
} from "./atom";
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
  return value?. [DYNAMIC_EXPR] === true;
}

function dynamicExpr<T, Self = any>(fn: (self: Self, atoms?: any) => Atom<T> | T): DynamicExpr<T, Self> {
  return { [DYNAMIC_EXPR]: true, fn };
}

function isMethod(value: any): value is Method {
  return value?. [METHOD] === true;
}

/**
 * Marks a scope member as an imperative method instead of a derived value.
 */
export function method<TSelf, TArgs extends any[], TResult>(
  fn: (self: TSelf, ...args: TArgs) => TResult
): Method<(self: TSelf, ...args: TArgs) => TResult> {
  return { [METHOD]: true, fn };
}

function isExprMarkerOrDynamic(value: any): value is AtomExpr | DerivedExpr | PipeExpr | FlowExpr | DynamicExpr {
  return isExprMarkerBase(value) || isDynamicExpr(value);
}

function unwrapDynamicValue<T>(value: T | Atom<T>): T {
  return isAtom(value) ? value.value : value as T;
}

type ScopeAtomReader = <T>(atom: Atom<T>) => T;

function isRuntimeAtom(value: unknown): value is Atom<any> {
  return isAtom(value) && typeof (value as Atom<any>).dispose === "function";
}

function createTrackedScope(scopeRef: Scope, reader: ScopeAtomReader): any {
  return new Proxy(scopeRef as any, {
    get(target, prop, receiver) {
      const resolved = target.at?.(prop);
      if (isRuntimeAtom(resolved)) {
        return reader(resolved);
      }

      if (isAtomLike(resolved)) {
        return resolved.value;
      }

      return Reflect.get(target, prop, receiver);
    },
    set(_target, prop, _value, _receiver) {
      throw new TypeError(
        `Cannot assign to "${String(prop)}" inside a derived/formula callback. ` +
        `Formulas must be pure functions of their inputs — use method(...) for imperative writes.`
      );
    },
    apply(_target, _thisArg, argArray) {
      if (argArray.length > 1) {
        return argArray.map((item) => {
          if (isRuntimeAtom(item)) {
            return reader(item);
          }

          if (isAtomLike(item)) {
            return item.value;
          }

          return item;
        });
      }

      const [first] = argArray;
      if (isRuntimeAtom(first)) {
        return reader(first);
      }

      if (isAtomLike(first)) {
        return first.value;
      }

      return first;
    },
  });
}

function evaluateExprMarker(
  marker: AtomExpr | DerivedExpr | PipeExpr | FlowExpr | DynamicExpr,
  scopeRef: Scope,
  atoms?: any,
): Atom<any> {
  if (isAtomExpr(marker)) {
    return atom(marker.initialValue === undefined ? NO_INITIAL_VALUE : marker.initialValue, marker.options);
  }
  if (isDerivedExpr(marker)) {
    return derived((derivedSelf) => marker.fn(createTrackedScope(scopeRef, derivedSelf.read.bind(derivedSelf)), atoms));
  }
  if (isPipeExpr(marker)) return marker.fn(scopeRef as any, atoms);
  if (isFlowExpr(marker)) return marker.fn(scopeRef as any, atoms);
  if (isDynamicExpr(marker)) {
    const initialDependencies = new Set<DependencySource<any>>();
    const initialScope = createTrackedScope(scopeRef, <T>(atomInstance: Atom<T>) => {
      initialDependencies.add(atomInstance as Atom<any>);
      return atomInstance.value;
    });
    const evaluateDynamic = (self: any) => marker.fn(self, atoms);
    const { result: value, dependencies: trackedDependencies } = trackDependencies(() => evaluateDynamic(initialScope));
    for (const dependency of trackedDependencies) {
      initialDependencies.add(dependency);
    }

    if (isAtomLike(value)) {
      return value;
    }

    if (isExprMarkerBase(value)) {
      return evaluateExprMarker(value, scopeRef, atoms);
    }

    let seeded = true;
    return derived((derivedSelf) => {
      const attachInitialDependencies = () => {
        for (const dependency of initialDependencies) {
          derivedSelf.read(dependency);
        }
      };

      if (seeded) {
        seeded = false;
        if (value && typeof (value as Promise<any>).then === "function") {
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
        return unwrapDynamicValue(value as any);
      }

      const inner = evaluateDynamic(createTrackedScope(scopeRef, derivedSelf.read.bind(derivedSelf)));
      if (inner && typeof (inner as Promise<any>).then === "function") {
        return Promise.resolve(inner).then((resolvedValue) => unwrapDynamicValue(resolvedValue));
      }
      return unwrapDynamicValue(inner as any);
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

export type WidenValue<T> = T;

export type ScopeInstance<T> = T extends Record<string, any>
  ? Simplify<{
      [K in keyof T]:
        T[K] extends Scope<infer U> ? ScopeInstance<U>
        : T[K] extends Atom<infer U> ? U
        : T[K] extends Writable<infer U> ? U
        : T[K];
    }>
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
export type AtomValueOf<T> = T extends Atom<infer U> ? U : T extends Readable<infer U> ? U : never;

type AccessorAtomOf<T> =
  T extends Writable<infer U> ? Writable<U>
  : T extends Atom<infer U> ? Atom<U>
  : T extends Readable<infer U> ? Readable<U>
  : never;

/**
 * Accessor surface used by `scope.at`, exposing raw atoms by property or key lookup.
 */
export type AtomAccessor<T> = { [K in keyof T]: AccessorAtomOf<T[K]> } & (<K extends keyof T>(key: K) => AccessorAtomOf<T[K]>);
type DefinedAtomAccessor<Shape extends Record<string, any>> = { [K in keyof Shape]: Atom<Shape[K]> } & (<K extends keyof Shape>(key: K) => Atom<Shape[K]>);

type DefinedValue<Top extends Record<string, any>, T> =
  | T
  | Method<T extends (...args: any[]) => infer TResult ? (self: any, ...args: Parameters<T>) => TResult : never>
  | AtomExpr<T>
  | DerivedExpr<T, Top>
  | PipeExpr<T, Top>
  | FlowExpr<T, Top>
  | ((self: Top, atoms: DefinedAtomAccessor<Top>) => T | Promise<T> | Atom<T>);

type ScopeValue<T> =
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
  : T extends Record<string, any> ? ScopeReturn<ScopeOf<T>>
  : Writable<T>;

type ScopeOf<T extends Record<string, any>> = { [K in keyof T]: ScopeValue<T[K]>; };

type ScopeResolvedFunctionValue<TResult> =
  Awaited<TResult> extends ScopeReturn<any> ? Awaited<TResult>
  : Awaited<TResult> extends Scope<infer U> ? ScopeReturn<ScopeOf<U>>
  : Awaited<TResult> extends Writable<any> ? Awaited<TResult>
  : Awaited<TResult> extends Atom<any> ? Awaited<TResult>
  : Awaited<TResult> extends AtomExpr<infer U> ? Writable<WidenValue<U>>
  : Awaited<TResult> extends DerivedExpr<infer U, any> ? Atom<U>
  : Awaited<TResult> extends PipeExpr<infer U, any> ? Atom<U>
  : Awaited<TResult> extends FlowExpr<infer U, any> ? Atom<U>
  : Atom<WidenValue<Awaited<TResult>>>;

type ScopeResolvedValue<T> =
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
  : T extends Record<string, any> ? ScopeReturnFromDefinition<T>
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
type ScopeSetupReturn<T> = T extends void ? {} : T;
/**
 * Wrapped scope surface exposed as the first `self` parameter in setup callbacks.
 */
export type ScopeSetupSelf<T extends Record<string, any>> = T & Scope;
/**
 * Wrapped scope surface exposed as the first `self` parameter in config-form setup callbacks.
 */
export type ScopeSetupSelfFromConfig<T extends Record<string, any>> = T & Scope;
type ScopeSetupCallback<TSelf, TScope, TResult extends ScopeSetupResult = ScopeSetupResult> =
  (self: TSelf, scope: TScope) => TResult;

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
  loading: Readable<boolean>;
  dirty: Readable<boolean>;
};

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
type IfEquals<X, Y, A = X, B = never> =
  (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2)
    ? A
    : B;
type ReadonlyKeysOf<T extends Record<string, any>> = {
  [K in keyof T]-?: IfEquals<{ [Q in K]: T[K] }, { -readonly [Q in K]: T[K] }, never, K>;
}[keyof T];
type WritableKeysOf<T extends Record<string, any>> = Exclude<keyof T, ReadonlyKeysOf<T>>;
type ScopeRuntimeValueFromPublicValue<T, TReadonly extends boolean> =
  T extends Scope<any> ? T
  : T extends (...args: any[]) => any ? T
  : TReadonly extends true ? Atom<WidenValue<T>> : Writable<WidenValue<T>>;
type ScopeRuntimeFromPublicShape<T extends Record<string, any>> = Simplify<{
  readonly [K in ReadonlyKeysOf<T>]: ScopeRuntimeValueFromPublicValue<T[K], true>;
} & {
  -readonly [K in WritableKeysOf<T>]: ScopeRuntimeValueFromPublicValue<T[K], false>;
}>;

/**
 * Public proxy shape produced from config-form scope definitions.
 */
export type UnwrapScopeValuesFromConfig<T extends Record<string, any>> = Simplify<{
  readonly [K in ReadonlyScopeConfigKeys<T>]: ScopePublicValue<ScopeResolvedValue<T[K]>>;
} & {
  -readonly [K in WritableScopeConfigKeys<T>]: ScopePublicValue<ScopeResolvedValue<T[K]>>;
}>;

/**
 * Maps a scope state shape to the raw atom graph used by expression helpers.
 */
export type ScopeAtoms<T> = T extends Record<string, any>
  ? { [K in keyof T]: T[K] extends Scope<infer U> ? ScopeAtoms<U> : AtomOf<ScopeValue<T[K]>> }
  : any;

type ScopeRuntimeShape<T extends Record<string, any>> = Scope<T>;
type ScopeValueShape<T extends Record<string, any>> = UnwrapScopeValues<T>;
type ScopeConfigValueShape<T extends Record<string, any>> = UnwrapScopeValuesFromConfig<T>;
type ScopeProxy<TRuntime extends Record<string, any>, TValues extends Record<string, any>> =
  ScopeRuntimeShape<TRuntime> &
  TValues &
  ScopeApi<TRuntime>;
type NormalizedScope<T extends Record<string, any>> = ScopeProxy<T, ScopeValueShape<T>>;
type ConfiguredScope<T extends Record<string, any>> = ScopeProxy<ScopeRuntimeFromPublicShape<T>, T>;
type ConfiguredScopeDefinition<T extends Record<string, any>> = ScopeProxy<ScopeOfConfig<T>, ScopeConfigValueShape<T>>;
type ScopeReturnFromDefinition<T extends Record<string, any>> = ConfiguredScopeDefinition<T>;
type ScopeWithSetup<TScope, TSetup extends ScopeSetupResult> = TScope & ScopeSetupReturn<TSetup>;

interface ScopeApi<T extends Record<string, any>> {
  at: AtomAccessor<T & ScopeReservedAtoms>;
  subscribeTo<K extends keyof (T & ScopeReservedAtoms)>(
    key: K,
    callback: (value: AtomValueOf<(T & ScopeReservedAtoms)[K]>) => void
  ): Subscription;
}

/**
 * Runtime proxy type returned from `scope()` when the state shape is already normalized.
 */
export type ScopeReturn<T extends Record<string, any>> = NormalizedScope<T>;

/**
 * Runtime proxy type returned from `scope()` when using config-form shorthand definitions.
 */
export type ScopeReturnFromConfig<T extends Record<string, any>> = ConfiguredScope<T>;

type ScopeAtomValue<T> = T extends Atom<infer U> ? U : never;

/**
 * Runtime scope instance.
 *
 * A scope owns the atoms created from a definition object, exposes their current
 * values as properties, and provides lifecycle cleanup through {@link dispose}.
 */
export interface Scope<T extends Record<string, any> = Record<string, any>> {
  <A extends Atom<any>>(atom: A): ScopeAtomValue<A>;
  <A extends Atom<any>[]>(...atoms: A): { [K in keyof A]: ScopeAtomValue<A[K]> };
  type: "scope";
  atoms: Set<Atom<any> | Scope>;
  cleanups: Set<() => void>;
  mode: "discrete" | "analog";
  parent: Scope | RootScope | null;
  container: Container;
  readonly loading: boolean;
  readonly dirty: boolean;
  snapshot(): UnwrapSnapshotValues<T>;
  dispose(): void;
  _pendingCount: number;
  _dirtyCount: number;
  _exports: Set<string | symbol>;
  _disposed: boolean;
  _rawState: Record<string | symbol, any>;
}

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type DefinedInput<Top extends Record<string, any>, Shape extends Record<string, any> = Top> = {
  [K in keyof Shape]: Shape[K] extends Scope<any>
    ? Shape[K]
    : Shape[K] extends readonly any[]
      ? DefinedValue<Top, Shape[K]>
      : Shape[K] extends Record<string, any>
        ? DefinedInput<Top, Shape[K]> | DefinedValue<Top, Shape[K]>
        : DefinedValue<Top, Shape[K]>;
};

/**
 * Accepted normalized definition shape for `scope<T>(...)`.
 *
 * Values become writable atoms, function values become derived values, nested
 * objects become nested scopes, and `method(...)` marks imperative actions.
 */
export type ScopeConfig<T extends Record<string, any>> = DefinedInput<T> & ThisType<ScopeReturn<ScopeOf<T>>>;

let currentScope: Scope | null = null;
const atomScopeRegistry = new WeakMap<Atom<any>, Scope>();
const emittedAtomsRegistry = new WeakSet<Atom<any>>();

/**
 * Returns the scope currently being constructed or evaluated.
 */
export const getCurrentScope = (): Scope | null => currentScope;
/**
 * Returns the effective notification mode of a scope.
 */
export const getScopeMode = (scope: Scope): "discrete" | "analog" => scope.mode ?? "discrete";
/**
 * Replaces the active scope and returns the previous one.
 */
export const setCurrentScope = (scope: Scope | null): Scope | null => {
  const previous = currentScope;
  currentScope = scope;
  return previous;
};

/* ── IoC Helpers ──────────────────────────────────────────────────────────── */

/**
 * Registers a dependency-injection provider on the current scope container.
 */
export function provide<T>(token: Token<T>, factory: Factory<T>, options?: RegistrationOptions<T>): void {
  const container = currentScope?.container ?? globalContainer;
  container.register(token, factory, options);
}

/**
 * Resolves a dependency from the current scope container, falling back to the global container.
 */
export function inject<T>(token: Token<T>): T {
  return (currentScope?.container ?? globalContainer).resolve(token, currentScope);
}

/**
 * Resolves a dependency if it exists, returning `undefined` when it is not registered.
 */
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
  scopeRef: Scope,
  input: any,
  visited: WeakMap<object, boolean>,
): Record<string | symbol, any> {
  const rawState: Record<string | symbol, any> = {};
  for (const key of Reflect.ownKeys(input)) {
    const item = input[key];
    if (isExprMarkerOrDynamic(item)) {
      rawState[key] = item;
    } else if (isMethod(item)) {
      rawState[key] = (...args: any[]) => item.fn(scopeRef as any, ...args);
    } else if (isAtomLike(item) || isScope(item)) {
      rawState[key] = item;
    } else if (typeof item === "function") {
      rawState[key] = dynamicExpr(item);
    } else if (isPlainObject(item)) {
      if (visited.has(item)) throw new Error(`Circular reference detected at key: ${String(key)}`);
      visited.set(item, true);
      try {
        rawState[key] = createScopeInternal(() => {
          const childScope = getCurrentScope() as Scope;
          return materializeState(childScope, item, visited);
        });
      } finally {
        visited.delete(item);
      }
    } else {
      rawState[key] = atom(item);
    }
  }

  return rawState;
}

function defineScopeStateProperty(
  scopeRef: Scope,
  key: string | symbol,
  read: (key: string | symbol) => any,
): void {
  const descriptor: PropertyDescriptor = {
    get() {
      const activeItem = read(key);
      if (isRuntimeAtom(activeItem)) {
        const formulaContext = getCurrentFormulaContext();
        if (formulaContext) {
          formulaContext.dependencies.add(activeItem as any);
        }
        return activeItem.value;
      }

      if (isAtomLike(activeItem)) {
        return activeItem.value;
      }

      if (activeItem && (typeof activeItem === "object" || typeof activeItem === "function")) {
        if (activeItem.type === "scope") return activeItem;
      }
      return activeItem;
    },
    enumerable: true,
    configurable: true,
  };

  descriptor.set = (value: any) => {
    const activeItem = read(key);
    if (activeItem && (typeof activeItem === "object" || typeof activeItem === "function") && activeItem.type === "atom") {
      if (typeof activeItem.next !== "function") {
        throw new TypeError(`Cannot assign to read-only scope property: ${String(key)}`);
      }
      activeItem.next(value);
      return;
    }
    scopeRef._rawState[key] = value;
  };

  if (isReadonlyScopeStateKey(key, scopeRef._rawState[key])) {
    delete descriptor.set;
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
  const parentContainer = isScope(parent) ? parent.container : globalContainer;
  const evaluating = new Set<string | symbol>();

  const scopeCallable = function (first: any, ...rest: any[]) {
    if (rest.length > 0) {
      return [first, ...rest].map((item) => (isAtom(item) ? item.value : item));
    }
    return isAtom(first) ? first.value : first;
  };

  const newScope = Object.assign(scopeCallable, {
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
      collectScopeValues(newScope as any, out);
      return out as any;
    },
    dispose() {
      disposeScope(newScope as any);
    },
    _pendingCount: 0,
    _dirtyCount: 0,
    _exports: new Set(),
    _disposed: false,
    _rawState: {},
  }) as Scope;

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
        if (evaluating.has(key)) throw new Error(`Circular dependency loop encountered on: ${String(key)}`);
        evaluating.add(key);
        try {
          current = evaluateExprMarker(current, newScope, atAccessor);
          newScope._rawState[key] = current;
          defineScopeStateProperty(newScope, key, getScopeItem);
        } finally {
          evaluating.delete(key);
        }
      }
      return current;
    };

    const getAccessorItem = (key: string | symbol) => {
      const item = getScopeItem(key);
      if ((key === "loading" || key === "dirty") && isAtomLike(item)) {
        return asReadable(item as Atom<any>);
      }
      return item;
    };

    const atAccessor: any = (key: string | symbol) => getAccessorItem(key);

    const defineAccessorKey = (key: string | symbol) => {
      defineCallableAccessorProperty(atAccessor, key, getAccessorItem);
    };

    Object.defineProperties(newScope, {
      at: { value: atAccessor, enumerable: false, configurable: true, writable: false },
      subscribeTo: {
        value: (key: string | symbol, callback: Function) => {
          const node = getScopeItem(key);
          if (!node?.subscribe) {
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
    const dataState = output?.rawState ?? output;

    if (dataState && typeof dataState === "object") {
      for (const key of Reflect.ownKeys(dataState)) {
        if (key === "loading" || key === "dirty") {
          console.warn(`[streamix] scope(): '${String(key)}' key is reserved and was overwritten.`);
          continue;
        }

        newScope._rawState[key] = dataState[key];
        newScope._exports.add(key);
        defineAccessorKey(key);
        defineScopeStateProperty(newScope, key, getScopeItem);
      }
    }

    for (const key of Reflect.ownKeys(newScope._rawState)) {
      if (isExprMarkerOrDynamic(newScope._rawState[key])) {
        void (newScope as any)[key];
      }
    }

    for (const item of Object.values(newScope._rawState)) {
      if (isScope(item as Scope | RootScope | null)) {
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
 */
export function scope<TConfig extends Record<string, any>, TSetup extends ScopeSetupResult>(
  definition: (this: Simplify<ScopeReturnFromConfig<UnwrapScopeValuesFromConfig<TConfig>>>) => TConfig,
  setup: (
    self: ScopeSetupSelfFromConfig<Simplify<UnwrapScopeValuesFromConfig<TConfig>>>,
    scope: ScopeReturnFromConfig<UnwrapScopeValuesFromConfig<TConfig>>
  ) => TSetup,
  options?: ScopeOptions,
): ScopeWithSetup<ScopeReturnFromConfig<UnwrapScopeValuesFromConfig<TConfig>>, TSetup>;

/**
 * Creates a scope from a plain object definition and optional setup extension.
 */
export function scope<TConfig extends Record<string, any>, TSetup extends ScopeSetupResult>(
  definition: TConfig,
  setup: (
    self: ScopeSetupSelfFromConfig<Simplify<UnwrapScopeValuesFromConfig<TConfig>>>,
    scope: ScopeReturnFromConfig<UnwrapScopeValuesFromConfig<TConfig>>
  ) => TSetup,
  options?: ScopeOptions,
): ScopeWithSetup<ScopeReturnFromConfig<UnwrapScopeValuesFromConfig<TConfig>>, TSetup>;

/**
 * Creates a scope from a config factory.
 */
export function scope<TConfig extends Record<string, any>>(
  definition: (this: Simplify<ScopeReturnFromConfig<UnwrapScopeValuesFromConfig<TConfig>>>) => TConfig,
  options?: ScopeOptions
): ScopeReturnFromConfig<UnwrapScopeValuesFromConfig<TConfig>>;

/**
 * Creates a scope from a plain object definition.
 */
export function scope<TConfig extends Record<string, any>>(
  definition: TConfig,
  options?: ScopeOptions
): ScopeReturnFromConfig<UnwrapScopeValuesFromConfig<TConfig>>;

/**
 * Creates a scope with an explicit normalized state shape and setup extension.
 */
export function scope<T extends Record<string, any>, TSetup extends ScopeSetupResult>(
  definition: (this: ScopeReturnFromConfig<Simplify<UnwrapScopeValues<ScopeOf<T>>>>) => ScopeConfig<T>,
  setup: ScopeSetupCallback<
    ScopeSetupSelf<Simplify<UnwrapScopeValues<ScopeOf<T>>>>,
    ScopeReturnFromConfig<Simplify<UnwrapScopeValues<ScopeOf<T>>>>,
    TSetup
  >,
  options?: ScopeOptions
): ScopeWithSetup<ScopeReturnFromConfig<Simplify<UnwrapScopeValues<ScopeOf<T>>>>, TSetup>;

/**
 * Creates a scope with an explicit normalized state shape.
 */
export function scope<T extends Record<string, any>>(
  definition: (this: ScopeReturnFromConfig<Simplify<UnwrapScopeValues<ScopeOf<T>>>>) => ScopeConfig<T>,
  options?: ScopeOptions
): ScopeReturnFromConfig<Simplify<UnwrapScopeValues<ScopeOf<T>>>>;

/**
 * Creates a scope with an explicit normalized state shape from an object definition and setup extension.
 */
export function scope<T extends Record<string, any>, TSetup extends ScopeSetupResult>(
  definition: ScopeConfig<T>,
  setup: ScopeSetupCallback<
    ScopeSetupSelf<Simplify<UnwrapScopeValues<ScopeOf<T>>>>,
    ScopeReturnFromConfig<Simplify<UnwrapScopeValues<ScopeOf<T>>>>,
    TSetup
  >,
  options?: ScopeOptions
): ScopeWithSetup<ScopeReturnFromConfig<Simplify<UnwrapScopeValues<ScopeOf<T>>>>, TSetup>;

/**
 * Creates a scope with an explicit normalized state shape from an object definition.
 */
export function scope<T extends Record<string, any>>(
  definition: ScopeConfig<T>,
  options?: ScopeOptions
): ScopeReturnFromConfig<Simplify<UnwrapScopeValues<ScopeOf<T>>>>;

/**
 * Creates a scope from either a config object or config factory.
 */
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
    function (this: any) {
      const source = isFactory ? definition.call(this) : definition;
      const current = getCurrentScope() as Scope;
      return materializeState(current, source, new WeakMap());
    },
    setup,
    resolvedOptions
  );
}

/* ── Scope Disposal ───────────────────────────────────────────────────────── */

function updateScopeHierarchy(
  startNode: Scope | RootScope | null,
  dynamicDelta: { pending?: number; dirty?: number },
): void {
  const pendingDelta = dynamicDelta.pending ?? 0;
  const dirtyDelta = dynamicDelta.dirty ?? 0;
  if (pendingDelta === 0 && dirtyDelta === 0) return;

  let current: Scope | RootScope | null = startNode;

  while (isScope(current) && !current._disposed) {
    if (pendingDelta !== 0) {
      current._pendingCount = Math.max(0, current._pendingCount + pendingDelta);
      const loadingAtom = current._rawState["loading"] as Writable<boolean> | undefined;

      if (loadingAtom) {
        const isCurrentlyLoading = current._pendingCount > 0;
        if (loadingAtom.value !== isCurrentlyLoading) {
          loadingAtom.next(isCurrentlyLoading);
        }
      }
    }

    if (dirtyDelta !== 0) {
      current._dirtyCount = Math.max(0, current._dirtyCount + dirtyDelta);
      const dirtyAtom = current._rawState["dirty"] as Writable<boolean> | undefined;

      if (dirtyAtom) {
        const isCurrentlyDirty = current._dirtyCount > 0;
        if (dirtyAtom.value !== isCurrentlyDirty) {
          dirtyAtom.next(isCurrentlyDirty);
        }
      }
    }

    current = current.parent;
  }
}

function updatePendingHierarchy(startNode: Scope | RootScope | null, dynamicDelta: number): void {
  updateScopeHierarchy(startNode, { pending: dynamicDelta });
}

function updateDirtyHierarchy(startNode: Scope | RootScope | null, dynamicDelta: number): void {
  updateScopeHierarchy(startNode, { dirty: dynamicDelta });
}

/**
 * Disposes a scope, its owned atoms, and all registered cleanup hooks.
 */
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

  updateScopeHierarchy(sc.parent, { pending: -sc._pendingCount, dirty: -sc._dirtyCount });
  sc._pendingCount = 0;
  sc._dirtyCount = 0;

  if (isScope(sc.parent)) {
    sc.parent.atoms.delete(sc);
  }

  for (const activeItem of sc.atoms) {
    try {
      (activeItem as any).dispose();
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

/**
 * Attaches a newly created atom to the current scope for lifecycle and state tracking.
 */
export function registerWithCurrentScope(atomInstance: Atom<any>): void {
  if (!currentScope) return;

  const targetContext = currentScope;
  targetContext.atoms.add(atomInstance);
  atomScopeRegistry.set(atomInstance, targetContext);

  updateScopeHierarchy(targetContext, { pending: 1, dirty: atomInstance.dirty ? 1 : 0 });

  const disposers = (atomInstance as any)._onDispose;
  if (disposers instanceof Set) {
    const earlyDetachmentHook = () => {
      targetContext.atoms.delete(atomInstance);
      if (!targetContext._disposed) {
        updateScopeHierarchy(targetContext, {
          pending: emittedAtomsRegistry.has(atomInstance) ? 0 : -1,
          dirty: atomInstance.dirty ? -1 : 0,
        });
      }
    };
    disposers.add(earlyDetachmentHook);
    targetContext.cleanups.add(() => disposers.delete(earlyDetachmentHook));
  }

  const stopEmitTracking = onAtomEmit(atomInstance, () => markAtomAsEmitted(atomInstance));
  targetContext.cleanups.add(() => stopEmitTracking());

  const stopDirtyTracking = onAtomDirtyChange(atomInstance, (dirty) => {
    if (targetContext._disposed) return;
    updateDirtyHierarchy(targetContext, dirty ? 1 : -1);
  });
  targetContext.cleanups.add(() => stopDirtyTracking());
}

/**
 * Marks an atom as having produced its first value for scope loading bookkeeping.
 */
export function markAtomAsEmitted(atomInstance: Atom<any>): void {
  if (emittedAtomsRegistry.has(atomInstance)) return;
  emittedAtomsRegistry.add(atomInstance);

  const contextRef = atomScopeRegistry.get(atomInstance);
  if (contextRef) updatePendingHierarchy(contextRef, -1);
}

/**
 * Returns whether an atom has emitted at least once.
 */
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
    let stopEmitTracking: () => void;
    const disposeHandlers = (item as any)._onDispose;

    const settle = () => {
      if (settled) return;
      settled = true;

      stopEmitTracking();
      if (disposeHandlers instanceof Set) {
        disposeHandlers.delete(settle);
      }

      if (!scopeRef._disposed) {
        updatePendingHierarchy(scopeRef, -1);
      }
    };

    stopEmitTracking = onAtomEmit(item, settle);

    if (disposeHandlers instanceof Set) {
      disposeHandlers.add(settle);
      scopeRef.cleanups.add(() => disposeHandlers.delete(settle));
    }
    scopeRef.cleanups.add(() => stopEmitTracking());
  }
}

/* ── Snapshot Generation ─────────────────────────────────────────────────── */

function collectScopeValues(sc: Scope, result: Record<string, any>): void {
  for (const key of sc._exports) {
    const instance = sc._rawState[key];
    if (instance && (typeof instance === "object" || typeof instance === "function")) {
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
