import {
  createContainer,
  globalContainer,
  type Container,
  type Factory,
  type RegistrationOptions,
  type Token,
} from "../ioc/container";
import { isAtom, isAtomLike } from "../utils/helpers";
import { atom, derived, flow, getCurrentFormulaContext, NO_INITIAL_VALUE, normalizeError, Writable, type Atom } from "./atom";
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

interface DynamicExpr<T = any, Self = any> {
  [DYNAMIC_EXPR]: true;
  fn: (self: Self, atoms?: any) => Atom<T> | T;
}

function isDynamicExpr(value: any): value is DynamicExpr {
  return value != null && typeof value === "object" && value[DYNAMIC_EXPR] === true;
}

function dynamicExpr<T, Self = any>(fn: (self: Self, atoms?: any) => Atom<T> | T): DynamicExpr<T, Self> {
  return { [DYNAMIC_EXPR]: true, fn };
}

const METHOD = Symbol("streamix.method");

interface Method<T extends (...args: any[]) => any = (...args: any[]) => any> {
  [METHOD]: true;
  fn: T;
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

function createCallableScopeProxy(scopeSelf: any): any {
  const callable = function<T>(atom: Atom<T>): T {
    const ctx = getCurrentFormulaContext();
    if (ctx) ctx.dependencies.add(atom as any);
    return atom.value;
  };

  return new Proxy(callable, {
    get(_target, prop, receiver) {
      return Reflect.get(scopeSelf, prop, receiver);
    },
    set(_target, prop, value, receiver) {
      return Reflect.set(scopeSelf, prop, value, receiver);
    },
  });
}

function evaluateExprMarker(
  marker: AtomExpr | DerivedExpr | PipeExpr | FlowExpr | DynamicExpr,
  self: any,
  atoms?: any,
): Atom<any> {
  const scopeSelf = createCallableScopeProxy(self);

  if (isAtomExpr(marker)) {
    if (marker.initialValue === undefined) {
      return atom(NO_INITIAL_VALUE, marker.options);
    }
    return atom(marker.initialValue, marker.options);
  }
  if (isDerivedExpr(marker)) {
    return derived(() => marker.fn(scopeSelf));
  }
  if (isPipeExpr(marker)) {
    return marker.fn(scopeSelf);
  }
  if (isFlowExpr(marker)) {
    return flow(marker.fn(scopeSelf));
  }
  if (isDynamicExpr(marker)) {
    const value = marker.fn(scopeSelf, atoms);
    if (value && typeof value === "object" && (value as Atom<any>).type === "atom") {
      return value as Atom<any>;
    }
    return derived(() => marker.fn(scopeSelf, atoms));
  }
  throw new Error("Unknown expression marker");
}

// Define a recursive type to unwrap atom values and handle nested scopes
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
  [K in keyof T]: T[K] extends Atom<infer U>
    ? U
    : T[K] extends Scope
      ? T[K]
      : T[K];
};

type AtomOf<T> = T extends Writable<infer U>
  ? Writable<U>
  : T extends Atom<infer U>
    ? Atom<U>
    : never;

type AtomValueOf<T> = T extends Atom<infer U> ? U : never;

type AtomAccessor<T> = {
  [K in keyof T]: AtomOf<T[K]>;
} & (<K extends keyof T>(key: K) => AtomOf<T[K]>);

type DefinedAtomAccessor<Shape extends Record<string, any>> = {
  [K in keyof Shape]: Atom<Shape[K]>;
} & (<K extends keyof Shape>(key: K) => Atom<Shape[K]>);

type DefinedValue<Top extends Record<string, any>, T> =
  | T
  | Method<T extends (...args: any[]) => any ? T : never>
  | AtomExpr<T>
  | DerivedExpr<T, Top>
  | PipeExpr<T, Top>
  | FlowExpr<T, Top>
  | ((self: Top, atoms: DefinedAtomAccessor<Top>) => T | Atom<T>);

/**
 * Transforms a plain-object scope state shape into the shape stored inside a scope.
 *
 * - Atoms and scopes are passed through unchanged.
 * - Functions are passed through unchanged (useful for methods).
 * - Nested plain objects become nested scopes.
 * - Everything else is wrapped in a writable atom.
 */
type ScopeValue<T> =
  T extends ScopeReturn<any>
    ? T
    : T extends Atom<any>
      ? T
      : T extends Scope<infer U>
        ? ScopeReturn<ScopeOf<U>>
        : T extends (...args: any[]) => any
          ? T
          : T extends readonly any[]
            ? Writable<T>
            : T extends DerivedExpr<infer U, any>
              ? Atom<U>
              : T extends PipeExpr<infer U, any>
                ? Atom<U>
                : T extends FlowExpr<infer U, any>
                  ? Atom<U>
                  : T extends AtomExpr<infer U>
                    ? Atom<U>
                    : T extends Record<string, any>
                      ? ScopeReturn<ScopeOf<T>>
                      : Writable<T>;

type ScopeOf<T extends Record<string, any>> = {
  [K in keyof T]: ScopeValue<T[K]>;
};

/** Full return type produced by the {@link scope} factory for a raw shape T. */
type ScopeReturn<T extends Record<string, any>> = Scope<T> &
  UnwrapScopeValues<T> & {
    at: AtomAccessor<T>;
    subscribeTo<K extends keyof T>(
      key: K,
      callback: (value: AtomValueOf<T[K]>) => void,
    ): Subscription;
  };

/**
 * Interface definition for a lifecycle scope execution context.
 *
 * @template T The raw factory return type. The proxy exposes unwrapped atom
 *   values and uses T to infer the shape of `snapshot()`.
 */
export interface Scope<T extends Record<string, any> = Record<string, any>> {
  /** Unique discriminator for the runtime context. */
  type: "scope";
  /** State container for active elements captured by this window. */
  atoms: Set<Atom<any> | Scope>;
  /** Registered callbacks triggered when this context collapses. */
  cleanups: Set<() => void>;
  /** Scope mode: 'discrete' or 'analog' */
  mode: "discrete" | "analog";
  /** Parent scope reference */
  parent: Scope | RootScope | null;
  /** IoC container for this scope. Inherits from the parent scope's container. */
  container: Container;
  /**
   * Whether the scope is still loading.
   * True until every owned atom (and nested scope) has emitted at least one value.
   * Exposed as a plain boolean via the proxy; the underlying atom lives in `_rawState`.
   */
  loading: boolean;
  /** Returns a plain object snapshot of all current atom values. */
  snapshot(): UnwrapSnapshotValues<T>;
  /** Disposes the scope and all of its atoms. */
  dispose(): void;
  /** @internal Number of atoms in this scope's subtree that have not yet emitted. */
  _pendingCount: number;
  /** @internal Factory keys that belong in snapshots. */
  _exports: Set<string | symbol>;
  /** @internal True once the scope has begun disposal. */
  _disposed: boolean;
  /** @internal Original factory results for raw atom access. */
  _rawState: Record<string | symbol, any>;
}

/** A simplified helper type to define contextual scope configurations. */
export type ScopeConfig<T extends Record<string, any>> = 
  & DefinedInput<T> 
  & ThisType<ScopeReturn<ScopeOf<T>>>;

// Active execution context tracking frames
let currentScope: Scope | null = null;

// Tracks which scope each registered atom belongs to.
const atomScopeRegistry = new WeakMap<Atom<any>, Scope>();

// Tracks atoms that have produced at least one value.
const emittedAtomsRegistry = new WeakSet<Atom<any>>();

/* ── Active Window Accessors ──────────────────────────────────────────────── */

export function getCurrentScope(): Scope | null {
  return currentScope;
}

export function getScopeMode(scope: Scope): "discrete" | "analog" {
  return scope.mode ?? "discrete";
}

export function setCurrentScope(scope: Scope | null): Scope | null {
  const previous = currentScope;
  currentScope = scope;
  return previous;
}

/* ── IoC Helpers ──────────────────────────────────────────────────────────── */

/**
 * Registers a service on the current scope's container.
 *
 * Falls back to the global container when called outside of a scope.
 */
export function provide<T>(
  token: Token<T>,
  factory: Factory<T>,
  options?: RegistrationOptions<T>
): void {
  const activeScope = getCurrentScope();
  const container = activeScope?.container ?? globalContainer;
  container.register(token, factory, options);
}

/**
 * Resolves a required service from the current scope's container.
 *
 * Falls back to the global container when called outside of a scope.
 */
export function inject<T>(token: Token<T>): T {
  const activeScope = getCurrentScope();
  const container = activeScope?.container ?? globalContainer;
  return container.resolve(token, activeScope);
}

/**
 * Resolves an optional service from the current scope's container.
 *
 * Falls back to the global container when called outside of a scope.
 */
export function injectOptional<T>(token: Token<T>): T | undefined {
  const activeScope = getCurrentScope();
  const container = activeScope?.container ?? globalContainer;
  return container.resolveOptional(token, activeScope);
}

/* ── Context Lifecycle Management ─────────────────────────────────────────── */

/**
 * Creates an execution boundary to encapsulate, track, and bulk-dispose reactive
 * units. Atoms created inside an analog scope defer public broadcasts to the
 * scheduler instead of notifying subscribers synchronously.
 *
 * The returned object is a Proxy: reading an exported atom returns its current
 * value, and writing to an exported atom forwards the value to atom.next().
 * Use `scope.at('key')` or `scope.at.key` to reach the underlying atom when you
 * need to subscribe, dispose, or call other atom methods directly.
 *
 * As a convenience, `scope` also accepts a plain object. Primitive values are
 * automatically wrapped in atoms and nested plain objects become nested scopes.
 *
 * ```ts
 * const app = scope({
 *   user: { name: '', email: '' },
 *   theme: 'dark'
 * });
 *
 * app.user.name = 'Alex'; // writes through the underlying atom
 * app.theme = 'light';    // same
 * ```
 */
// Keys that belong to the scope's own interface and must bypass the atom-routing
// proxy. Hoisted to module level so the Set is allocated once, not on every
// scope() call.
const INTERNAL_SCOPE_KEYS = new Set([
  "type",
  "atoms",
  "cleanups",
  "mode",
  "parent",
  "container",
  "snapshot",
  "dispose",
  "_pendingCount",
  "_exports",
  "_disposed",
  "_rawState",
  "at",
]);

function isAtomOrScopeLike(value: any): value is Atom<any> | Scope {
  return isAtomLike(value) || isScope(value);
}

function isPlainObject(value: any): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date || value instanceof RegExp || value instanceof Map || value instanceof Set) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Input-shape type for {@link scope}. Each property may be either its final
 * value or a function that receives the typed scope `self` and returns that
 * value. Functions are automatically wrapped in derived atoms.
 */
export type DefinedInput<
  Top extends Record<string, any>,
  Shape extends Record<string, any> = Top,
> = {
  [K in keyof Shape]: Shape[K] extends Scope<any>
    ? Shape[K]
    : Shape[K] extends readonly any[]
      ? DefinedValue<Top, Shape[K]>
      : Shape[K] extends Record<string, any>
        ? DefinedInput<Top, Shape[K]> | DefinedValue<Top, Shape[K]>
        : DefinedValue<Top, Shape[K]>;
};

/**
 * Recursively transforms a `scope()` input object into a regular scope state
 * object by wrapping every function value in a derived-expression marker.
 */
function toDefinedState(state: DefinedInput<any>, visited: WeakSet<object> = new WeakSet()): any {
  const result: any = {};
  for (const key of Reflect.ownKeys(state)) {
    const value = (state as any)[key];
    if (isExprMarkerOrDynamic(value)) {
      result[key] = value;
    } else if (isMethod(value)) {
      result[key] = value;
    } else if (typeof value === "function") {
      result[key] = dynamicExpr(value);
    } else if (isAtomOrScopeLike(value)) {
      result[key] = value;
    } else if (isPlainObject(value)) {
      if (visited.has(value)) {
        throw new Error(`Circular reference detected in scope state at key: ${String(key)}`);
      }
      visited.add(value);
      result[key] = toDefinedState(value, visited);
      visited.delete(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isWritableAtom(value: any): value is Writable {
  return isAtomLike(value) && typeof (value as Writable).next === "function";
}

function transformScopeState<T extends Record<string, any>>(
  state: T,
  visited: WeakMap<object, boolean>,
  scopeProxy: any,
): any {
  const rawState: any = {};
  const evaluating = new Set<string | symbol>();

  // First pass: store raw values, wrap primitives in atoms, bind methods to the
  // scope proxy, and recursively convert nested plain objects into scopes.
  for (const key of Reflect.ownKeys(state)) {
    const value = (state as any)[key];
    if (isExprMarkerOrDynamic(value)) {
      rawState[key] = value;
    } else if (isMethod(value)) {
      rawState[key] = value.fn.bind(scopeProxy);
    } else if (typeof value === "function") {
      rawState[key] = value.bind(scopeProxy);
    } else if (isAtomOrScopeLike(value)) {
      rawState[key] = value;
    } else if (isPlainObject(value)) {
      if (visited.has(value)) {
        throw new Error(`Circular reference detected in scope state at key: ${String(key)}`);
      }
      visited.set(value, true);
      try {
        rawState[key] = createScopeInternal(() => transformScopeState(value, visited, scopeProxy));
      } finally {
        visited.delete(value);
      }
    } else {
      rawState[key] = atom(value);
    }
  }

  // Build a plain `self` object with getters/setters backed by rawState.
  // No Proxy is used for `self`.
  const self: any = {};
  for (const key of Reflect.ownKeys(rawState)) {
    Object.defineProperty(self, key, {
      get() {
        const value = rawState[key];
        if (isExprMarkerOrDynamic(value)) {
          if (evaluating.has(key)) {
            throw new Error(`Circular dependency detected in scope state at key: ${String(key)}`);
          }
          evaluating.add(key);
          try {
            const atom = evaluateExprMarker(value, self, atoms);
            rawState[key] = atom;
            return atom.value;
          } finally {
            evaluating.delete(key);
          }
        }
        if (isAtom(value)) {
          const ctx = getCurrentFormulaContext();
          if (ctx) ctx.dependencies.add(value as any);
          return value.value;
        }
        return value;
      },
      set(newValue: any) {
        const value = rawState[key];
        if (isWritableAtom(value)) {
          value.next(newValue);
        } else {
          rawState[key] = newValue;
        }
      },
      enumerable: true,
      configurable: true,
    });
  }

  // Provide callbacks with a typed accessor to the raw atoms. Accessing a key
  // that is still an expression marker forces its evaluation first, so callers
  // always receive the underlying reactive unit.
  function getRawAtom(key: string | symbol): any {
    let value = rawState[key];
    if (isExprMarkerOrDynamic(value)) {
      void (self as any)[key];
      value = rawState[key];
    }
    return value;
  }
  const atoms: any = new Proxy(getRawAtom, {
    get(_, key) {
      if (typeof key === "symbol" && key in getRawAtom) {
        return (getRawAtom as any)[key];
      }
      return getRawAtom(key);
    },
    has(_, key) {
      return key in rawState;
    },
    ownKeys() {
      return Reflect.ownKeys(rawState);
    },
    getOwnPropertyDescriptor(_, key) {
      return Object.getOwnPropertyDescriptor(rawState, key);
    },
  });

  // Eagerly evaluate expression markers so the returned rawState contains atoms.
  // The self getters handle lazy dependencies and circularity detection.
  for (const key of Reflect.ownKeys(rawState)) {
    if (isExprMarkerOrDynamic(rawState[key])) {
      void (self as any)[key];
    }
  }

  return rawState;
}

/**
 * Internal scope constructor. The factory must return the final `_rawState`
 * shape (atoms, scopes, etc.). Used by the public `scope()` API and by nested
 * scope creation inside `transformScopeState`.
 */
function createScopeInternal<T extends Record<string, any>>(
  factory: (this: any, self: any) => T,
  options?: { mode?: "discrete" | "analog" },
): ScopeReturn<T> {
  const parent = currentScope ?? getGlobalScope();
  const mode = resolveMode(options, parent);

  // Create the base scope structure
  const parentContainer = isScope(parent) ? parent.container : globalContainer;
  const newScope: Scope = {
    type: "scope",
    atoms: new Set(),
    cleanups: new Set(),
    mode,
    parent,
    container: createContainer(parentContainer),
    loading: null as any, // placeholder; replaced by proxy below
    snapshot() {
      const result: Record<string, any> = {};
      collectScopeValues(this as Scope & T, result);
      return result as any;
    },
    dispose() {
      disposeScope(this as Scope & T);
    },
    _pendingCount: 0,
    _exports: new Set(),
    _disposed: false,
    _rawState: {},
  };

  // Register this nested scope with its real (non-root) parent so disposal
  // recurses through the scope tree.
  if (isScope(parent)) {
    parent.atoms.add(newScope);
  }

  // Swap the active execution context. The factory is synchronous, so a single
  // saved previous value is enough; no stack is required.
  const previous = currentScope;
  currentScope = newScope;

  try {
    // Create a reactive atom that mirrors this scope's loading state.
    // Loading starts true and becomes false once every registered atom has
    // emitted at least one value.
    // Create it outside the current scope so it does not count as a pending
    // atom itself; then store it in _rawState so the proxy treats it like any
    // other atom.
    const loadingAtom = (() => {
      const scopeBefore = currentScope;
      currentScope = null;
      try {
        return atom(true);
      } finally {
        currentScope = scopeBefore;
      }
    })();
    (newScope as any)._rawState['loading'] = loadingAtom;

    // Pre-create the proxy so the factory can use `self` for reads, writes,
    // subscriptions, and dependency tracking during setup.
    const atAccessor = (key: string | symbol) => newScope._rawState[key];
    const atProxy = new Proxy(atAccessor, {
      get(_, key) {
        if (typeof key === "string" && key in atAccessor) {
          return Reflect.get(atAccessor, key);
        }
        return newScope._rawState[key];
      },
    });

    const scopeProxy = new Proxy(newScope, {
      get(target, prop, receiver) {
        if (prop === "at") {
          return atProxy;
        }
        if (prop === "subscribeTo") {
          return (key: string | symbol, callback: (current: any, previous?: any) => void) => {
            const atom = target._rawState[key] as Atom<any>;
            if (!atom || typeof atom.subscribe !== "function") {
              throw new Error(`Cannot subscribe to non-atom property: ${String(key)}`);
            }
            if (hasAtomEmitted(atom)) {
              callback(atom.value, atom.previous);
            }
            return atom.subscribe(callback);
          };
        }
        if (INTERNAL_SCOPE_KEYS.has(prop as string)) {
          return Reflect.get(target, prop, receiver);
        }
        const factoryItem = target._rawState[prop];
        if (factoryItem && typeof factoryItem === "object") {
          if ((factoryItem as any).type === "atom") {
            const ctx = getCurrentFormulaContext();
            if (ctx) ctx.dependencies.add(factoryItem as any);
            return (factoryItem as Atom<any>).value;
          }
          // Return child scope proxies directly — they already wrap their own atoms.
          if ((factoryItem as any).type === "scope") {
            return factoryItem;
          }
        }
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver): boolean {
        if (INTERNAL_SCOPE_KEYS.has(prop as string)) {
          return Reflect.set(target, prop, value, receiver);
        }
        const factoryItem = target._rawState[prop];
        if (
          factoryItem &&
          typeof factoryItem === "object" &&
          (factoryItem as any).type === "atom"
        ) {
          const writable = factoryItem as Writable<any>;
          // Only `next` presence determines writability — checking `set` too with
          // || would incorrectly block custom Writable implementations that expose
          // next but not the alias `set`.
          if (typeof writable.next !== "function") {
            // Derived and flow atoms are read-only; assignment is not allowed.
            return false;
          }
          writable.next(value);
          return true;
        }
        target._rawState[prop] = value;
        return Reflect.set(target, prop, value, receiver);
      },
    });

    const result = factory.call(scopeProxy, scopeProxy);

    if (result && typeof result === "object") {
      // Store the original factory result so the proxy can route reads/writes
      // to the underlying atoms while exposing values to callers.
      const exportKeys = Reflect.ownKeys(result);

      // 'loading' is a reserved key managed by the scope itself. Silently
      // overwriting a factory-exported 'loading' would discard user data; warn
      // so the conflict is visible during development.
      if ("loading" in (result as object)) {
        console.warn(
          "[streamix] scope(): factory returned a 'loading' key, " +
          "which is reserved and will be overwritten by the scope's own loading atom. " +
          "Rename your property to avoid the conflict."
        );
      }

      Object.assign(newScope, result);
      (newScope as any)._rawState = result;
      for (const key of exportKeys) {
        newScope._exports.add(key);
      }
    }

    // Treat loading like any other atom: keep it in _rawState so the proxy
    // can expose its value and route at()/subscribeTo() to it.
    (newScope as any)._rawState['loading'] = loadingAtom;

    // Ensure nested scopes point to this proxied parent so identity checks like
    // `parent.child.parent === parent` hold.
    for (const value of Object.values(newScope._rawState)) {
      if (value && typeof value === "object" && (value as any).type === "scope") {
        (value as Scope).parent = scopeProxy as any;
      }
    }

    // Empty scopes or scopes where every atom already emitted synchronously
    // should report loading=false.
    if (newScope._pendingCount === 0 && loadingAtom.value !== false) {
      loadingAtom.next(false);
    }

    // Dispose the loading atom with the scope.
    newScope.cleanups.add(() => {
      if (!loadingAtom.disposed) loadingAtom.dispose();
    });

    return scopeProxy as any;
  } catch (error) {
    disposeScope(newScope);
    throw normalizeError(error);
  } finally {
    currentScope = previous;
  }
}

/**
 * Creates an execution boundary to encapsulate, track, and bulk-dispose reactive
 * units. Atoms created inside an analog scope defer public broadcasts to the
 * scheduler instead of notifying subscribers synchronously.
 *
 * The returned object is a Proxy: reading an exported atom returns its current
 * value, and writing to an exported atom forwards the value to atom.next().
 * Use `scope.at('key')` or `scope.at.key` to reach the underlying atom when you
 * need to subscribe, dispose, or call other atom methods directly.
 *
 * Object form — primitives are wrapped in atoms, nested plain objects become
 * nested scopes, and functions become derived expressions:
 *
 * ```ts
 * const app = scope<AppShape>({
 *   query: '',
 *   count: (self) => self.query.length,
 * });
 * ```
 *
 * Factory form — useful for setup-time side effects like `provide()`:
 *
 * ```ts
 * const app = scope<AppShape>(() => {
 *   provide(Config, () => ({ apiUrl: '/api' }));
 *   return { apiUrl: () => inject(Config).apiUrl };
 * });
 * ```
 */
export function scope<T extends Record<string, any>>(
  state: ScopeConfig<T>,
  options?: { mode?: "discrete" | "analog" },
): ScopeReturn<ScopeOf<T>>;

export function scope<T extends Record<string, any>>(
  factory: (this: ScopeReturn<ScopeOf<T>>) => ScopeConfig<T>,
  options?: { mode?: "discrete" | "analog" },
): ScopeReturn<ScopeOf<T>>;

export function scope(arg: any, options?: any): any {
  if (typeof arg === "function") {
    return createScopeInternal(
      function (this: any, self: any) {
        return transformScopeState(toDefinedState(arg.call(this)), new WeakMap(), self);
      },
      options,
    );
  }
  return createScopeInternal(
    (self: any) => transformScopeState(toDefinedState(arg), new WeakMap(), self),
    options,
  );
}

/* ── Scope Disposal ───────────────────────────────────────────────────────── */

/**
 * Tears down a scope: runs cleanup hooks and disposes all owned atoms and
 * nested scopes recursively.
 */
export function disposeScope(sc: Scope): void {
  if (sc._disposed) return;
  sc._disposed = true;

  for (const cleanup of Array.from(sc.cleanups)) {
    try {
      cleanup();
    } catch {
      /* suppress secondary cleanup errors */
    }
  }
  sc.cleanups.clear();

  // Remove this scope's pending-atom contribution from its ancestors before
  // disposing children, so parent loading states stay consistent.
  decrementPendingBy(sc.parent, sc._pendingCount);
  sc._pendingCount = 0;

  if (isScope(sc.parent)) {
    sc.parent.atoms.delete(sc);
  }

  for (const item of Array.from(sc.atoms)) {
    // Both atoms and scopes have a `dispose` method.
    try {
      if (!(item as any).disposed) {
        (item as any).dispose();
      }
    } catch {
      /* suppress structural errors during sweep */
    }
  }
  sc.atoms.clear();

  // Dispose the scope's IoC container and run cleanup for scoped services.
  sc.container.dispose().catch(() => {});
}

/* ── Registry Linkage Handlers ───────────────────────────────────────────── */

/**
 * Links a newly created atom to the active scope so it is disposed with the scope.
 */
export function registerWithCurrentScope(atom: Atom<any>): void {
  if (!currentScope) return;

  const scopeRef = currentScope;
  scopeRef.atoms.add(atom);
  atomScopeRegistry.set(atom, scopeRef);

  // Every registered atom starts life as pending; loading becomes true when
  // at least one atom in the subtree has not yet emitted.
  incrementPending(scopeRef);

  // Auto-detach from the scope's tracked set if the atom is manually disposed early
  const onDisposeHandlers = (atom as any)._onDispose;
  if (onDisposeHandlers instanceof Set) {
    const trackingCleanup = () => {
      scopeRef.atoms.delete(atom);
      if (!emittedAtomsRegistry.has(atom) && !scopeRef._disposed) {
        decrementPending(scopeRef);
      }
    };
    onDisposeHandlers.add(trackingCleanup);
    scopeRef.cleanups.add(() => onDisposeHandlers.delete(trackingCleanup));
  }

  // Subscribe to the atom so that:
  // - derived atoms initialize eagerly (subscribe() calls ensureInit()),
  // - flow atoms stay active and actually receive values from their source, and
  // - every emission is recorded for scope.loading.
  try {
    const unsubscribe = atom.subscribe(() => markAtomAsEmitted(atom));
    scopeRef.cleanups.add(() => {
      if ((atom as any).disposed) return;
      unsubscribe();
    });
  } catch {
    // ignore initialization errors (e.g. derived that throws on first run)
  }
}

/**
 * Records that an atom has emitted its first value.
 */
export function markAtomAsEmitted(atom: Atom<any>): void {
  if (emittedAtomsRegistry.has(atom)) return;
  emittedAtomsRegistry.add(atom);

  const scope = atomScopeRegistry.get(atom);
  if (scope) decrementPending(scope);
}

/**
 * Returns true if the atom has produced at least one value (either an initial
 * value or a subsequent emission).
 */
export function hasAtomEmitted(atom: Atom<any>): boolean {
  return emittedAtomsRegistry.has(atom);
}

/* ── Loading State ────────────────────────────────────────────────────────── */

function getLoadingAtom(sc: Scope): Writable<boolean> | undefined {
  return sc._rawState['loading'] as Writable<boolean> | undefined;
}

function incrementPending(scope: Scope): void {
  let sc: Scope | RootScope | null = scope;
  while (isScope(sc) && !sc._disposed) {
    sc._pendingCount++;
    const loadingAtom = getLoadingAtom(sc);
    if (loadingAtom) {
      const loading = sc._pendingCount > 0;
      if (loadingAtom.value !== loading) loadingAtom.next(loading);
    }
    sc = sc.parent;
  }
}

function decrementPending(scope: Scope): void {
  let sc: Scope | RootScope | null = scope;
  while (isScope(sc) && !sc._disposed) {
    sc._pendingCount = Math.max(0, sc._pendingCount - 1);
    const loadingAtom = getLoadingAtom(sc);
    if (loadingAtom) {
      const loading = sc._pendingCount > 0;
      if (loadingAtom.value !== loading) loadingAtom.next(loading);
    }
    sc = sc.parent;
  }
}

function decrementPendingBy(scope: Scope | RootScope | null, amount: number): void {
  if (amount <= 0) return;
  let sc: Scope | RootScope | null = scope;
  while (isScope(sc) && !sc._disposed) {
    sc._pendingCount = Math.max(0, sc._pendingCount - amount);
    const loadingAtom = getLoadingAtom(sc);
    if (loadingAtom) {
      const loading = sc._pendingCount > 0;
      if (loadingAtom.value !== loading) loadingAtom.next(loading);
    }
    sc = sc.parent;
  }
}

/* ── Snapshot Helper ─────────────────────────────────────────────────────── */

function collectScopeValues(sc: Scope, result: Record<string, any>): void {
  for (const key of sc._exports) {
    const value = sc._rawState[key];
    if (value && typeof value === "object" && (value as any).type === "atom") {
      try {
        result[key as string] = (value as Atom<any>).value;
      } catch {
        result[key as string] = (value as any).safeValue;
      }
    } else if (
      value &&
      typeof value === "object" &&
      (value as any).type === "scope"
    ) {
      result[key as string] = (value as Scope).snapshot();
    } else {
      result[key as string] = value;
    }
  }
}
