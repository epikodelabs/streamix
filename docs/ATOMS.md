# The Complete Guide to `atom`, `derived`, `flow`, and `scope`

This guide documents the actual runtime behavior of `atom`, `derived`, `flow`,
and `scope` — the options, the edge cases, and the mental model you need to use
these primitives well.

---

## 1. The `Atom<T>` contract

Every reactive unit in streamix — whether created by `atom()`, `derived()`, or
`flow()` — implements the same read-only surface:

```ts
interface Atom<T> {
  readonly type: "atom";
  readonly value: T;          // current value (throws if disposed or errored)
  readonly safeValue: T;      // like value, but never throws
  readonly previous: T;       // value before the last change
  readonly disposed: boolean;
  readonly error?: any;
  readonly subscriberCount?: number;
  subscribe(cb?: (current: T, previous: T) => void | Promise<void>): Subscription;
  onError(handler: (error: any) => void): Subscription;
  dispose(): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}
```

`atom()` additionally returns a `Writable<T>`, which adds:

```ts
interface Writable<T> extends Atom<T> {
  next(value: T): void;
  set(value: T): void;                 // alias for next()
  fail(err: any, opts?: { terminate?: boolean }): void;
  recover(): void;
  clearError(): void;
}
```

Key details that aren't obvious from the type alone:

- **`.value` on a plain atom never recomputes anything** — it just returns
  the stored value (throwing only if disposed, or if the atom is in an error
  state). On a *derived* atom, reading `.value` can trigger a synchronous
  recompute if the atom is dirty or hasn't run yet.
- **`.previous` is always available**, even before any `next()` call — it
  starts equal to the initial value.
- **`.safeValue`** swallows errors and returns the last good value instead of
  throwing. This is what `flow()` uses internally when seeding its initial
  value from an atom source, and it's the right choice for UI code that
  can't afford to throw during render.
- Reading `.value` (or `.previous`, or subscribing) **inside a `derived()`
  formula automatically registers a dependency** — there's a global "current
  formula context" stack that every atom checks on read.

---

## 2. `atom(initialValue?, options?)`

```ts
const count = atom(0);
const draft = atom<string>();              // no initial value
const draft2 = atom(NO_INITIAL_VALUE);      // explicit "no value" sentinel
```

### Options (`AtomOptions`)

| Option | Default | Effect |
|---|---|---|
| `discrete` | `false` | Forces synchronous, un-batched broadcasts even inside an `analog` scope (see §6). |
| `maxSubscribers` | `1000` | `subscribe()` throws once this many active subscribers exist. |
| `onError` | — | Called synchronously whenever `.fail()` is invoked. |
| `terminateOnError` | `false` | If true, `.fail()` disposes the atom immediately instead of leaving it in a recoverable error state. |
| `propagateErrors` | `true` | If true, a non-terminating `.fail()` still marks the node dirty so dependents/derived atoms re-evaluate and see the error. |

### Writing values

```ts
count.next(5);   // updates .value, .previous, notifies subscribers
count.set(5);     // identical to next()
```

`next()` always updates `previous`/`current` and notifies internal dependency
trackers immediately (so derived atoms stay correctly dirty-tracked), but the
**public** subscriber broadcast is either immediate (`discrete` mode) or
deferred to a microtask flush (`analog` mode, the default inside a scope).

### Error handling

```ts
count.fail(new Error("bad input"));   // enters error state; .value now throws
count.recover();                       // clears the error, .value works again
count.onError(err => showToast(err.message));
```

If `terminateOnError` is set (or you call `fail(err, { terminate: true })`),
the atom disposes itself — subscriptions are torn down and it can never
recover.

### Subscribing

```ts
const unsubscribe = count.subscribe((current, previous) => {
  console.log(`${previous} → ${current}`);
});
unsubscribe(); // Subscription is itself a callable unsubscribe function
```

Subscriber callbacks can be async. streamix guarantees a given callback is
never re-entered while its previous invocation is still pending — if the
atom emits again mid-callback, the new value is queued and delivered right
after the callback settles (in `analog` mode, only the *latest* pending value
survives; intermediate values are conflated).

### Async iteration

Every atom is an async iterable:

```ts
for await (const value of count) {
  console.log(value);
}
```

---

## 3. `derived(fn, options?)`

`derived()` builds a read-only `Atom<T>` whose value is computed from other
atoms. The dependencies are discovered automatically — you don't declare
them.

```ts
const firstName = atom("Ada");
const lastName = atom("Lovelace");

const fullName = derived($ => `${$(firstName)} ${$(lastName)}`);
```

### The `$` scope argument

`fn` receives a `DerivedScope`, conventionally named `$`. It is **callable**
and also has methods:

```ts
$(atom)                 // read + track a single atom
$(atomA, atomB)          // read + track many, returns a tuple of values
$.read(atom)              // same as $(atom)
$.use(atomA, atomB)       // register atoms as dependencies without necessarily using the value yet
```

Any property on `$` that happens to be an `Atom` (useful when you pass a
class instance as the compute function, see below) is automatically
proxy-wrapped so reading `.value` off it also tracks the dependency.

### Three ways to write the compute function

**1. Plain sync function** — the common case shown above.

**2. Async function** — `derived()` detects `async` functions and treats the
atom as an *async formula*. Every dependency change triggers a fresh
recompute (there's no "cancel in-flight" partial-dependency diffing for
async formulas — the whole thing reruns).

```ts
const userProfile = derived(async $ => {
  const id = $(userId);
  return fetchUser(id);
});
```

**3. Generator function** — you can `yield` either a promise or another atom;
`derived()` drives the generator, resolving/reading each yielded value and
feeding it back in:

```ts
const combined = derived(function* ($) {
  const a = yield atomA;        // yielding an atom reads + tracks it
  const b = yield fetch("/b");  // yielding a promise awaits it
  return a + b;
});
```

Under the hood all three forms are normalized into the same
`ComputableInstance` shape (`compute`, optional `onInit`, optional
`onDispose`), so a derived atom can also be defined as a class with a
`compute(self)` method if you need instance state, an `onInit` hook, or an
`onDispose` cleanup hook.

### Circular dependencies

If a derived formula reads an atom whose evaluation is already on the call
stack (directly or transitively), `derived()` throws
`"Circular dependency detected in derived()"` rather than looping forever.

### Errors in derived atoms

If the compute function throws (or its promise rejects), the derived atom
enters an error state (`.error` is set, `.value` throws). `.safeValue`
returns the last successfully computed value instead. Same
`terminateOnError` / `propagateErrors` options apply as with `atom()`.

---

## 4. `flow(source, options?)`

`flow()` wraps an `AsyncIterable`, `Iterable`, or a factory
`(signal?) => AsyncIterable | Iterable` into an `Atom`. It's the primitive
for hooking up streams, websockets, or generator-based data sources.

```ts
const ticks = flow(async function* (signal) {
  while (!signal?.aborted) {
    yield Date.now();
    await sleep(1000);
  }
});
```

- If `source` is itself an `Atom`, the flow seeds its initial value from that
  atom's `safeValue` so consumers see a value immediately.
- The `AbortSignal` passed into a factory source is honored *cooperatively* —
  it's your source's job to check it (e.g. forward it to `fetch`). To
  guarantee the flow's internal loop unblocks even for sources that ignore
  the signal (raw websockets, timer-based generators), `flow()` races every
  `iterator.next()` call against the abort signal internally.
- Disposing a flow calls `iterator.return()` if present, so generator-based
  sources get a chance to clean up (closing sockets, clearing timers, etc.).
- Same `AtomOptions` (`discrete`, `maxSubscribers`, `onError`,
  `terminateOnError`, `propagateErrors`) apply.

---

## 5. `scope(state, options?)`

A `scope` is a disposal boundary: every atom (and nested scope) created while
it's active gets registered to it, and disposing the scope tears down
everything inside it in one call. It also doubles as a lightweight,
type-safe reactive object.

### Object form

```ts
interface AppShape {
  query: string;
  results: string[];
  resultCount: number;
}

const app = scope<AppShape>({
  query: "",
  results: [],
  resultCount: (self) => self.results.length,   // functions become derived
});

app.query = "hello";        // routes to app.at.query.next("hello")
console.log(app.resultCount); // reads the derived value
```

Transformation rules applied to every key in the input object:

| Input value | Becomes |
|---|---|
| Primitive / array | `Writable<T>` via `atom(value)` |
| Function `(self, atoms?) => value` | A `derived()` atom (dynamic expression) |
| Plain nested object | A **nested scope**, recursively transformed the same way |
| An existing `Atom` or `Scope` | Passed through unchanged |
| `method(fn)` | Bound to `self` but left as a plain function — **not** wrapped in a derived atom (use this for imperative actions, not computed values) |

### Factory form

Use this when you need setup-time side effects (like registering IoC
providers) before returning the shape:

```ts
const app = scope<AppShape>(() => {
  provide(ConfigToken, () => ({ apiUrl: "/api" }));
  return {
    apiUrl: () => inject(ConfigToken).apiUrl,
  };
});
```

### Reading and writing

The object returned by `scope()` is a `Proxy`:

- **Reading** an exported key returns the *unwrapped value* (`app.query`
  returns `"hello"`, not the atom), and, if you're inside a `derived()`
  formula, it also registers the dependency.
- **Writing** an exported key forwards to the underlying atom's `.next()`.
  Writing to a derived/read-only key is a no-op (the assignment is silently
  rejected).
- **`scope.at.key`** (or `scope.at('key')`) gives you the raw `Atom`/`Writable`
  itself, for when you need `.subscribe()`, `.dispose()`, `.previous`, etc.
- **`scope.subscribeTo(key, callback)`** subscribes to a specific exported
  atom, immediately firing the callback with the current value if that atom
  has already emitted.

```ts
app.at.query.subscribe((cur, prev) => console.log(cur, prev));
const unsub = app.subscribeTo("resultCount", (n) => console.log("count:", n));
```

### `loading`

Every scope exposes a reactive `loading: boolean`, `true` until *every* atom
and nested scope registered in its subtree has emitted at least one value.
It's automatically kept in sync as atoms register, emit, and dispose, and it
propagates to parent scopes too. `loading` is a reserved key — if your
factory returns one, it's silently overwritten and a console warning is
logged.

### `snapshot()` and `dispose()`

```ts
app.snapshot(); // deep plain-object copy of every exported atom's current value
app.dispose();  // disposes every atom and nested scope owned by this scope
```

`snapshot()` recurses into nested scopes automatically. `dispose()` runs
registered cleanup hooks, disposes owned atoms/scopes, and tears down the
scope's IoC container.

### Nesting and parenting

Plain nested objects become real child `Scope`s, and their `.parent` is set
to point at the (proxied) parent scope, so identity checks like
`child.parent === parent` hold. Disposing a parent scope recursively disposes
every nested scope.

---

## 6. Analog vs. discrete mode

This is the most important performance/behavior knob in the system.

- **`discrete`** (default outside any scope): every `next()` broadcasts to
  subscribers **synchronously**, and every dependent derived atom
  recomputes immediately.
- **`analog`** (default *inside* a `scope()`, unless you pass
  `{ mode: "discrete" }` or set `discrete: true` on an individual atom):
  public broadcasts are **batched** — they're queued onto a scheduler and
  flushed on the next microtask, in dependency-depth order (shallowest
  dependencies first, via a min-heap). If several updates happen before the
  microtask flushes, subscriber callbacks that are still busy get only the
  *last* pending value instead of one call per intermediate update.

Internal dependency tracking (which derived atoms are dirty) always happens
**immediately**, regardless of mode — only the *public* subscriber
notification is deferred in analog mode. This is why `derived()` values
always reflect the latest state as soon as you read `.value`, even if you
haven't awaited a microtask yet.

You can force an individual atom to bypass batching even inside an analog
scope with `{ discrete: true }`.

---

## 7. Dependency injection: `provide` / `inject`

Every scope owns an IoC container (inheriting from its parent's, falling
back to a global container outside any scope):

```ts
const ConfigToken = createToken<{ apiUrl: string }>("config");

scope(() => {
  provide(ConfigToken, () => ({ apiUrl: "/api" }));
  const config = inject(ConfigToken);            // throws if missing
  const maybe = injectOptional(ConfigToken);      // undefined if missing
  return { apiUrl: config.apiUrl };
});
```

---

## 8. Testing

```ts
const env = createTestEnvironment();

env.run(() => {
  const count = atom(0, { discrete: false });
  count.next(1);
  // subscriber hasn't fired yet — analog mode batches to microtask
});

env.flush();   // synchronously drain the test scheduler
env.reset();   // restore the original global scheduler
```

`createTestScheduler()` gives you a standalone `Scheduler` instance if you
need to swap it manually with `setScheduler()`.

---

## 9. Practical gotchas

- **`.value` throws when disposed or errored; `.safeValue` never does.**
  Use `safeValue` in render paths where a throw would break the UI.
- **`Object.is` gates change notification** — `atom.next(sameReference)`
  on an object/array won't emit unless you provide a new reference,
  mirroring React's mental model.
- **Reading `.value` outside a formula context is just a plain read** — it
  does not implicitly subscribe you to anything. Tracking only happens
  inside `derived()` (or `$()`/`scope`'s proxy getters).
- **`method()` vs. a plain function in `scope()` input**: a bare function
  becomes a `derived()` computed value; wrap it in `method(fn)` if you want
  an imperative action (e.g. `resetForm()`) bound to `self` without being
  treated as reactive state.
- **Assigning to a derived/flow key in a scope is a silent no-op** — there's
  no runtime error, so double-check you're not trying to write through a
  computed property.