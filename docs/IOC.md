# 🧩 IoC Container — Dependency injection the streamix way

streamix ships with a small, functional IoC container. It is designed for apps that need to share services, manage lifetimes, and clean up resources together with reactive scopes.

It is **not** a full framework container. There are no decorators, no class metadata, and no runtime reflection. Just tokens, factory functions, and containers.

## Why?

- Wire up services once and resolve them anywhere.
- Keep a singleton `Logger` but a scoped `Database` per feature module.
- Dispose a whole feature scope and have its services cleaned up automatically.
- Test services in isolation by swapping the container.

## Tokens

A token is a typed key. It is just a symbol with a phantom type.

```ts
import { createToken } from '@epikodelabs/streamix';

interface Logger {
  log(message: string): void;
}

const Logger = createToken<Logger>('logger');
```

Tokens are unique. Two tokens with the same name are still different keys.

## Containers

Create a container and register services:

```ts
import { createContainer } from '@epikodelabs/streamix';

const container = createContainer()
  .register(Logger, () => ({ log: (msg) => console.log(msg) }));

const logger = container.resolve(Logger);
logger.log('hello');
```

`register()` returns the same container, so chaining is natural.

## Factory context

Factories receive a context object with `resolve` and `resolveOptional`:

```ts
const Database = createToken<{ query(): string[] }>('database');

const container = createContainer()
  .register(Logger, () => ({ log: (msg) => console.log(msg) }))
  .register(Database, (ctx) => ({
    query: () => {
      ctx.resolve(Logger).log('querying...');
      return ['a', 'b', 'c'];
    },
  }));
```

## Lifetimes

Every registration has a lifetime.

| Lifetime | Behavior |
|---|---|
| `singleton` | One instance per root container. |
| `scoped` | One instance per resolving container. |
| `transient` | New instance on every `resolve()`. |

Default is `transient`.

```ts
const Id = createToken<number>('id');

const container = createContainer()
  .register(Id, () => Math.random(), { lifetime: 'singleton' });

console.log(container.resolve(Id) === container.resolve(Id)); // true
```

Use `scoped` when you want one instance per feature scope, and `transient` for lightweight stateless helpers.

## Resource cleanup

Pass a `cleanup` callback and it runs when the container is disposed, in reverse resolution order.

```ts
const Db = createToken<{ close(): Promise<void> }>('db');

const container = createContainer().register(
  Db,
  () => ({ close: async () => { /* ... */ } }),
  {
    lifetime: 'singleton',
    cleanup: (db) => db.close(),
  }
);

const db = container.resolve(Db);
await container.dispose(); // close() is awaited
```

If a cleanup throws, disposal still runs every cleanup and reports the collected errors at the end.

## Hierarchical containers

Containers can have parents. A child sees parent registrations but can override them.

```ts
const parent = createContainer().register(Logger, () => consoleLogger);
const child = parent.createChild().register(Logger, () => testLogger);

parent.resolve(Logger); // consoleLogger
child.resolve(Logger);  // testLogger
```

Singletons are cached on the root container, so a singleton resolved through a child still lives on the root.

## Circular dependencies

Circular dependencies are detected and throw a clear error:

```ts
const A = createToken<string>('a');
const B = createToken<string>('b');

createContainer()
  .register(A, (ctx) => ctx.resolve(B))
  .register(B, (ctx) => ctx.resolve(A))
  .resolve(A); // CircularDependencyError
```

## Composition

Build reusable modules:

```ts
import { createModule, registerMany } from '@epikodelabs/streamix';

const infraModule = createModule([
  { token: Logger, factory: () => consoleLogger, options: { lifetime: 'singleton' } },
  { token: Database, factory: (ctx) => new Database(ctx.resolve(Logger)), options: { lifetime: 'scoped' } },
]);

const app = createContainer();
infraModule(app);
```

## Integration with scopes

Every streamix `scope()` gets its own container that inherits from the parent scope's container. This lets you register services naturally inside a scope and have them cleaned up when the scope disposes.

Object form works for state that only reads services:

```ts
import { scope, inject, createToken } from '@epikodelabs/streamix';

const Config = createToken<{ apiUrl: string }>('config');

const feature = scope({
  apiUrl: () => inject(Config).apiUrl,
});

feature.dispose(); // scope container and its services are cleaned up
```

Use the factory form when you also need to register services at setup time with `provide()`:

```ts
import { scope, provide, inject, createToken } from '@epikodelabs/streamix';

const Config = createToken<{ apiUrl: string }>('config');

const feature = scope(() => {
  provide(Config, () => ({ apiUrl: '/api/v1' }), { lifetime: 'singleton' });

  return {
    apiUrl: () => inject(Config).apiUrl,
  };
});

feature.dispose(); // scope container and its services are cleaned up
```

`provide()` and `inject()` use the current scope's container when called inside a scope, and fall back to the global container outside of one.

## Global container

For app-wide services there is a global singleton container:

```ts
import { globalContainer, provide, inject } from '@epikodelabs/streamix';

provide(Logger, () => consoleLogger);

const logger = inject(Logger);
```

`provide()` and `inject()` outside of any scope use this global container.

In tests you can reset it:

```ts
import { resetGlobalContainer } from '@epikodelabs/streamix';

beforeEach(() => {
  resetGlobalContainer();
});
```

## When not to use it

- For simple prop drilling, plain function arguments are still best.
- For React/Angular component trees, prefer framework DI where it fits better.
- The container is synchronous; do not use it for async service location.

## Summary

| API | Purpose |
|---|---|
| `createToken<T>(name)` | Create a typed injection key. |
| `createContainer(parent?)` | Create a container. |
| `container.register(token, factory, options?)` | Register a service. |
| `container.resolve(token)` | Resolve a required service. |
| `container.resolveOptional(token)` | Resolve an optional service. |
| `container.has(token)` | Check registration. |
| `container.createChild()` | Create a child container. |
| `container.dispose()` | Run cleanup. |
| `provide(...)` / `inject(...)` | Scope-aware shortcuts. |
| `globalContainer` / `resetGlobalContainer()` | Global singleton. |
| `registerMany(...)` / `createModule(...)` | Compose registrations. |
