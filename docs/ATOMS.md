# Atoms and Scopes

Atoms and scopes form the reactive state layer in streamix. They build on flows and give you simple primitives for live values, computed values, async workflows, and clean lifecycle management.

### Mental Model

- **Atom**: A reactive value you can read synchronously, subscribe to, consume as an async iterable, or pipe through operators.
- **Scope**: A reactive object that owns a tree of atoms. It turns properties into atoms, functions into derived values, and cleans everything up when disposed.

```ts
const app = scope({
  firstName: "Ada",
  lastName: "Lovelace",
  fullName: self => `${self.firstName} ${self.lastName}`,
});

console.log(app.fullName); // "Ada Lovelace"
app.firstName = "Grace";
console.log(app.fullName); // "Grace Lovelace"
app.dispose();
```

### Core Atom API

Every atom (from `atom`, `derived`, `flow`, or `pipe`) shares this interface:

```ts
interface Atom<T> {
  readonly value: T;        // current value (throws on error/disposed)
  readonly safeValue: T;    // last good value (never throws)
  readonly previous: T;
  readonly disposed: boolean;
  readonly error?: any;
  subscribe(callback): Subscription;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}
```

Writable atoms add `.next(value)`, `.set(value)`, `.fail(error)`, etc.

### Writable Atoms

```ts
const count = atom(0);
count.next(42);
console.log(count.value); // 42
```

Use `discrete: true` when every update (even duplicates) should notify subscribers — great for events.

### Derived Atoms

Computed values that automatically update:

```ts
const fullName = derived($ => 
  `${$(firstName)} ${$(lastName)}`
);
```

The `$` helper tracks dependencies. You can also use async functions — the atom keeps the last good value while pending.

### Flow Atoms

For async/generators, iterables, or factories:

```ts
const ticks = flow(async function* (signal) {
  while (!signal?.aborted) {
    yield Date.now();
    await sleep(1000);
  }
});
```

Flows respect disposal via `AbortSignal` and integrate cleanly with the atom API.

### Scopes in Depth

Scopes turn plain objects into reactive trees:

```ts
const cart = scope({
  items: [],
  subtotal: self => self.items.reduce((sum, i) => sum + i.price, 0),
});
```

- Primitives/arrays → writable atoms
- Functions → derived values
- Nested objects → nested scopes
- Use `method(fn)` for imperative actions
- Use `scope.at.items` when you need the raw atom

**Handy features:**
- `cart.loading` — true until all atoms have emitted at least once
- `cart.snapshot()` — plain JS object of current values
- Built-in dependency injection with `provide` / `inject`
- Automatic cleanup on `dispose()`

### Modes

- **Discrete**: Immediate synchronous notifications (default for events/tests)
- **Analog**: Batched + coalesced updates (ideal for UI)

```ts
const ui = scope({ ... }, { mode: "analog" });
```

### Common Patterns

**Form state:**
```ts
const form = scope({
  email: "",
  password: "",
  valid: self => self.email.includes("@") && self.password.length >= 8,
  submit: method(function() { /* ... */ })
});
```

**Async data:**
Use `flow()` + `userId` atom for loading states that integrate with the scope’s `loading` flag.

### Best Practices

- Write to sources, not derived values
- Use `scope.at.xxx` when you need `.subscribe()`, `.next()`, or raw atom features
- Always dispose scopes when done
- Prefer `safeValue` in UI code
- Use analog mode for UI, discrete for events

Atoms give you a unified, composable way to handle state — synchronous when you need the current value, reactive when things change, and automatically cleaned up by scopes. Simple, predictable, and powerful.
