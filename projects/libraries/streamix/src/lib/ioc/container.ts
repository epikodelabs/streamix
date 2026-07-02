import { isPromiseLike, type MaybePromise } from "../atoms/operator";
import type { Scope } from "../atoms/scope";
import type { Token } from "./token";
export { createToken } from "./token";
export type { Token, TokenValue } from "./token";

/**
 * Service lifetime.
 *
 * - `singleton` — one instance per root container.
 * - `scoped`    — one instance per resolving container.
 * - `transient` — new instance on every resolution.
 */
export type Lifetime = "singleton" | "scoped" | "transient";

/**
 * Context passed to every factory during resolution.
 */
export interface ResolutionContext {
  /** The container that initiated this resolution. */
  readonly container: Container;
  /** The active streamix scope, if any. */
  readonly scope: Scope | null;
  /** Resolves a required dependency. */
  resolve<T>(token: Token<T>): T;
  /** Resolves an optional dependency. */
  resolveOptional<T>(token: Token<T>): T | undefined;
}

/**
 * Factory function used to create a service instance.
 */
export type Factory<T> = (ctx: ResolutionContext) => T;

/**
 * Registration options for a service.
 */
export interface RegistrationOptions<T> {
  lifetime?: Lifetime;
  cleanup?: (value: T) => MaybePromise<void>;
}

interface InternalRegistration {
  token: Token<any>;
  factory: Factory<any>;
  lifetime: Lifetime;
  cleanup?: (value: any) => MaybePromise<void>;
}

interface TrackedInstance {
  token: Token<any>;
  value: any;
  cleanup?: (value: any) => MaybePromise<void>;
}

// Internal container state is stored in WeakMaps so it remains private and
// does not leak onto the public Container object.
const registrationsMap = new WeakMap<Container, Map<Token<any>, InternalRegistration>>();
const singletonCacheMap = new WeakMap<Container, Map<Token<any>, any>>();
const scopedCacheMap = new WeakMap<Container, Map<Token<any>, any>>();
const trackedInstancesMap = new WeakMap<Container, TrackedInstance[]>();
const disposedSet = new WeakSet<Container>();

function getRegistrations(container: Container): Map<Token<any>, InternalRegistration> {
  return registrationsMap.get(container)!;
}

function getSingletonCache(container: Container): Map<Token<any>, any> {
  return singletonCacheMap.get(container)!;
}

function getScopedCache(container: Container): Map<Token<any>, any> {
  return scopedCacheMap.get(container)!;
}

function getTrackedInstances(container: Container): TrackedInstance[] {
  return trackedInstancesMap.get(container)!;
}

function isDisposed(container: Container): boolean {
  return disposedSet.has(container);
}

function markDisposed(container: Container): void {
  disposedSet.add(container);
}

/**
 * Functional IoC container.
 *
 * The container is created by a factory function and exposes a functional API.
 * Internal state (registrations, caches, disposal order) is held in closures and
 * WeakMaps so it cannot be accessed from outside.
 */
export interface Container {
  readonly _tag: "Container";
  readonly parent: Container | null;

  /**
   * Registers a service with the container.
   *
   * Returns the same container for fluent chaining.
   */
  register<T>(
    token: Token<T>,
    factory: Factory<T>,
    options?: RegistrationOptions<T>
  ): Container;

  /**
   * Resolves a required service. Throws if the token is not registered.
   */
  resolve<T>(token: Token<T>, scope?: Scope | null): T;

  /**
   * Resolves an optional service. Returns undefined if not registered.
   */
  resolveOptional<T>(token: Token<T>, scope?: Scope | null): T | undefined;

  /**
   * Checks whether the token is registered in this container or any parent.
   */
  has<T>(token: Token<T>): boolean;

  /**
   * Creates a child container that inherits registrations from this one.
   */
  createChild(): Container;

  /**
   * Disposes the container and runs cleanup for all owned singleton/scoped
   * instances in reverse resolution order.
   */
  dispose(): Promise<void>;
}

class CircularDependencyError extends Error {
  constructor(token: Token<any>, stack: Token<any>[]) {
    const chain = stack.map((t) => (t as any).description ?? "unknown").join(" -> ");
    super(`Circular dependency detected: ${chain} -> ${(token as any).description ?? "unknown"}`);
    this.name = "CircularDependencyError";
  }
}

function getRoot(container: Container): Container {
  let current: Container = container;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}

function findRegistration(
  container: Container,
  token: Token<any>
): InternalRegistration | undefined {
  let current: Container | null = container;
  while (current) {
    const registration = getRegistrations(current).get(token);
    if (registration) return registration;
    current = current.parent;
  }
  return undefined;
}


async function runCleanup(instance: TrackedInstance): Promise<Error | null> {
  if (!instance.cleanup) return null;
  try {
    const result = instance.cleanup(instance.value);
    if (isPromiseLike(result)) {
      await result;
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Creates a new IoC container.
 *
 * @param parent Optional parent container. Registrations are inherited from the parent.
 */
export function createContainer(parent: Container | null = null): Container {
  const container: Container = {
    _tag: "Container",
    parent,

    register<T>(
      token: Token<T>,
      factory: Factory<T>,
      options: RegistrationOptions<T> = {}
    ): Container {
      if (isDisposed(container)) {
        throw new Error("Cannot register services on a disposed container");
      }
      getRegistrations(container).set(token, {
        token,
        factory,
        lifetime: options.lifetime ?? "transient",
        cleanup: options.cleanup,
      });
      return container;
    },

    resolve<T>(token: Token<T>, scope: Scope | null = null): T {
      if (isDisposed(container)) {
        throw new Error("Cannot resolve services from a disposed container");
      }
      return resolveInternal(container, token, scope, new Set<Token<any>>());
    },

    resolveOptional<T>(token: Token<T>, scope: Scope | null = null): T | undefined {
      if (isDisposed(container)) return undefined;
      if (!container.has(token)) return undefined;
      return container.resolve(token, scope);
    },

    has<T>(token: Token<T>): boolean {
      return findRegistration(container, token) !== undefined;
    },

    createChild(): Container {
      return createContainer(container);
    },

    async dispose(): Promise<void> {
      if (isDisposed(container)) return;
      markDisposed(container);

      const errors: Error[] = [];
      const tracked = getTrackedInstances(container);

      // Dispose in reverse resolution order (most recently resolved first).
      for (let i = tracked.length - 1; i >= 0; i--) {
        const err = await runCleanup(tracked[i]);
        if (err) errors.push(err);
      }

      tracked.length = 0;
      getSingletonCache(container).clear();
      getScopedCache(container).clear();
      getRegistrations(container).clear();

      if (errors.length > 0) {
        const message = errors.map((e) => e.message).join("; ");
        throw new Error(`Container disposal completed with errors: ${message}`);
      }
    },
  };

  registrationsMap.set(container, new Map());
  singletonCacheMap.set(container, new Map());
  scopedCacheMap.set(container, new Map());
  trackedInstancesMap.set(container, []);

  return container;
}

function resolveInternal<T>(
  resolvingContainer: Container,
  token: Token<T>,
  scope: Scope | null,
  stack: Set<Token<any>>
): T {
  if (stack.has(token)) {
    throw new CircularDependencyError(token, Array.from(stack) as Token<any>[]);
  }

  const registration = findRegistration(resolvingContainer, token);
  if (!registration) {
    throw new Error(`No registration found for token: ${(token as any).description ?? "unknown"}`);
  }

  const { lifetime, factory, cleanup } = registration;

  // Singleton: cached on root container.
  if (lifetime === "singleton") {
    const root = getRoot(resolvingContainer);
    const rootCache = getSingletonCache(root);
    const rootTracked = getTrackedInstances(root);

    if (!rootCache.has(token)) {
      stack.add(token);
      const value = createValue(factory, root, scope, stack);
      stack.delete(token);
      rootCache.set(token, value);
      rootTracked.push({ token, value, cleanup });
      return value;
    }
    return rootCache.get(token);
  }

  // Scoped: cached on the resolving container.
  if (lifetime === "scoped") {
    const scopedCache = getScopedCache(resolvingContainer);
    const tracked = getTrackedInstances(resolvingContainer);

    if (!scopedCache.has(token)) {
      stack.add(token);
      const value = createValue(factory, resolvingContainer, scope, stack);
      stack.delete(token);
      scopedCache.set(token, value);
      tracked.push({ token, value, cleanup });
      return value;
    }
    return scopedCache.get(token);
  }

  // Transient: new instance every time. Cleanup is not tracked because
  // transient instances have no well-defined lifetime.
  stack.add(token);
  const value = createValue(factory, resolvingContainer, scope, stack);
  stack.delete(token);
  return value;
}

function createValue<T>(
  factory: Factory<T>,
  resolvingContainer: Container,
  scope: Scope | null,
  stack: Set<Token<any>>
): T {
  const ctx: ResolutionContext = {
    container: resolvingContainer,
    scope,
    resolve: <U>(t: Token<U>) => resolveInternal(resolvingContainer, t, scope, stack),
    resolveOptional: <U>(t: Token<U>) => {
      if (!resolvingContainer.has(t)) return undefined;
      return resolveInternal(resolvingContainer, t, scope, stack);
    },
  };
  return factory(ctx);
}

/**
 * Global IoC container singleton.
 *
 * This is a live binding; {@link resetGlobalContainer} can replace it with a
 * fresh instance. This is primarily useful in tests.
 */
export let globalContainer: Container = createContainer();

/**
 * Replaces the global container with a fresh, empty container.
 *
 * This is intended for test isolation. The old container is not disposed;
 * callers should dispose it first if cleanup is required.
 */
export function resetGlobalContainer(): void {
  globalContainer = createContainer();
}

/**
 * Registers multiple registrations onto a container.
 */
export function registerMany(
  container: Container,
  registrations: { token: Token<any>; factory: Factory<any>; options?: RegistrationOptions<any> }[]
): Container {
  for (const { token, factory, options } of registrations) {
    container.register(token, factory, options);
  }
  return container;
}

/**
 * Composes a list of registrations into a module function that can be applied
 * to any container.
 */
export function createModule(
  registrations: { token: Token<any>; factory: Factory<any>; options?: RegistrationOptions<any> }[]
): (container: Container) => Container {
  return (container) => registerMany(container, registrations);
}
