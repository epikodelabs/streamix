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

Async `derived()` callbacks only track atoms read before the first `await`. Capture dependencies up front with `$.use(...)` or `$.read(...)`:

```ts
const total = derived(async $ => {
  void $.price, $.tax;
  await loadRates();
  return $.price + $.tax;
});
```

If the computation is mostly async work or needs cancellation/restart behavior, prefer `flow()`.

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
}, self => ({
  addItem(item) {
    self.items = [...self.items, item];
  },
}));
```

- Primitives/arrays → writable atoms
- Functions → derived values
- Nested objects → nested scopes
- Use the setup callback for imperative actions that need typed `self`
- Use `scope.at.items` when you need the raw atom

**Handy features:**
- `cart.loading` — true until all atoms have emitted at least once
- `cart.snapshot()` — plain JS object of current values
- Built-in dependency injection with `provide` / `inject`
- Automatic cleanup on `dispose()`

### Pitfalls: The Standard `this` Shorthand (Loss of Reactivity)

A common mistake when designing nested scopes is attempting to use standard JavaScript `this` shorthand syntax inside nested methods to calculate derived (computed) properties.

```ts
// ❌ WRONG: Bypasses dependency-tracking context!
const app = scope({
  query: "",
  count(this) {
    return this.query.length;
  },
  user: {
    firstName: "",
    lastName: "",
    fullName(this) {
      return `${this.firstName} ${this.lastName}`.trim();
    },
  },
});
```

**Why this is wrong:**
1. **Bypasses Formula Tracking:** streamix monitors property reads using reactive formula context layers (such as `derived` or `flow`). Standard methods using `this` execute outside this tracking system.
2. **No Dependency Registration:** Since streamix cannot track that `fullName` read `firstName` and `lastName`, updates to those properties will not trigger recalculations.
3. **Actions vs. Computeds:** Plain function properties are materialized as side-effect methods (actions) rather than reactive computations.

**The Correct Approach (Maintaining Reactivity):**
Declare computed properties using formula callbacks with the local `self` parameter:

```ts
// ✅ CORRECT: Registers reactive dependencies!
const app = scope({
  query: "",
  count: (self) => self.query.length,
  user: {
    firstName: "",
    lastName: "",
    fullName: (self) => `${self.firstName} ${self.lastName}`.trim(),
  },
});
```

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
}, self => ({
  submit() {
    /* ... */
  }
}));
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
