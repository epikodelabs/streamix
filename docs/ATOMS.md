# ✨ Streamix Atoms — Simple, powerful state for your apps

At its heart, Streamix gives you **one primitive**: the atom.

- `atom()` creates writable state.
- `derived()` creates computed state.
- `flow()` creates async state.
- `scope()` organizes atoms into trees.

Everything else is a specialized way to produce, transform, or group atoms. Once you understand that, the whole API feels small.

---

### ✍️ atom — a value you can read and write

```ts
const count = atom(0);

console.log(count.value);     // 0
count.next(5);
console.log(count.value);     // 5
```

You can also peek at the previous value with `.prior`.

Subscribing is super easy:

```ts
const sub = count.subscribe(v => {
  console.log("count is now", v);
});

count.next(10);
// → "count is now 10"

sub.unsubscribe(); // clean up when you're done 🧹
```

Atoms can even hold an error while keeping their last good value.

---

### 🔄 derived — a value that updates automatically

No need to manually list dependencies. Just read other atoms inside a function:

```ts
const first = atom("Ada");
const last  = atom("Lovelace");

const fullName = derived(() => `${first.value} ${last.value}`);

first.next("Grace");
console.log(fullName.value); // "Grace Lovelace"
```

Derived values are **computed lazily** and only recompute when one of their dependencies changes. They only notify subscribers when the *result* actually changes, and they handle conditional dependencies like a pro. Cycles throw an error instead of looping forever.

---

### 🌐 flow — values that come from async sources

Need data from an API, timer, WebSocket, or anything async? `flow` turns it into an atom. It accepts promises, async iterables, or factory functions:

```ts
// Promise
const user = flow(fetch("/me").then(r => r.json()));

// Async iterable
const ticks = flow(interval(1000)); // every second ⏰
```

It only starts pulling data when someone subscribes, and automatically stops when everyone unsubscribes. Smart!

---

### 🗂️ scope — structured state with automatic cleanup

A scope groups atoms into a single state tree. It automatically tracks every atom, derived value, flow, and nested scope created inside it, and disposes everything together when you call `.dispose()`.

```ts
const app = scope(() => {
  const count = atom(0);
  const label = flow(someLiveSource);

  return { count, label };
});

// Later
app.dispose(); // everything gets cleaned up nicely 🧼
```

Disposing a scope also disposes all nested scopes, atoms, flows, and subscriptions created inside it.

Scopes can nest, giving you a clean tree of state.

---

### 🔄 Built-in loading state

Every scope knows whether its subtree is still loading. A scope stays loading until every atom inside it has emitted at least once. Perfect for spinners:

```ts
const app = scope({
  user: flow(fetchUser()),
});

if (app.loading) {
  showSpinner();
}
```

If you want a flow to keep a scope loading during an async delay, don't emit a placeholder value before the delay — wait and emit the real value when it's ready.

---

### 🧩 Object shorthand

For most UI state, pass a plain object. Primitives are automatically wrapped in atoms, nested plain objects become nested scopes, and atoms or scopes pass through unchanged:

```ts
const app = scope({
  user: {
    name: '',
    email: '',
  },
  theme: 'dark',
});

app.user.name = 'Ada'; // writes through the underlying atom
app.theme = 'light';   // same
```

---

### 🧬 Expression markers

Object scopes are evaluated before the scope exists, so values that need access to `self` or require deferred creation use expression markers. Each marker receives a `self` proxy that exposes the scope's current values:

```ts
import { atomExpr, derivedExpr, flowExpr, pipeExpr, scope } from '@epikodelabs/streamix';

const app = scope({
  query: '',
  user: atomExpr<string>(),                                       // atom without initial value
  results: pipeExpr((self) => pipe(self.query, debounce(300), switchMap(search))),
  count: derivedExpr((self) => self.results?.length ?? 0),
  ticks: flowExpr(() => interval(1000)),
});
```

`atomExpr`, `derivedExpr`, `pipeExpr`, and `flowExpr` are evaluated lazily and turned into regular atoms inside the scope.

---

### 🏭 Factory scopes

If you need direct atom references — for example to wire up streams with `pipe` or `combineLatest` inside the scope — use the factory form. It receives a `self` proxy for reading and writing values:

```ts
const app = scope((self) => {
  const query = atom('');
  const results = pipe(query, debounce(300), switchMap(searchUsers));
  const count = derived(() => results.value?.length ?? 0);

  return { query, results, count };
});
```

---

### 🔍 Accessing raw atoms

The scope proxy exposes atom *values*. If you ever need the atom itself — for example to pass it to `pipe` or `combineLatest` from outside the scope — use `scope.at.key` or `scope.at('key')`:

```ts
const app = scope({
  count: 0,
});

pipe(app.at.count, map(n => n * 2)).subscribe(console.log);
```

---

### ✨ Handy extras

- **`snapshot()`** — Get a plain object with current values
- **`pipe()`** — Build beautiful transformation chains:

```ts
const results = pipe(
  query,
  debounce(300),
  switchMap(searchTerm => searchUsers(searchTerm))
);
```

- Consume any atom as an async iterable:

```ts
for await (const value of someAtom) {
  console.log(value);
}
```

---

### ⚡ Discrete vs Analog

By default, updates are immediate (“discrete”). Switch to **analog** mode for high-frequency stuff like mouse movement — it batches rapid updates into one final notification. Smooth! 🖱️

---

**Real-world example:**

```ts
const app = scope({
  query: '',

  results: pipeExpr((self) =>
    pipe(self.query, debounce(300), switchMap(search))
  ),

  count: derivedExpr((self) => self.results?.length ?? 0),

  online: flowExpr(() => connectionStatus()),
});
```

One `scope()` call gives you atoms, derived values, async flows, loading states, snapshots, and automatic cleanup. ✨
