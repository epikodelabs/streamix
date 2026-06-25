# ✨ Streamix Atoms — Simple, powerful state for your apps

At its heart, the library gives you just **four core ideas**: `atom`, `derived`, `flow`, and `scope`. With these, you can handle everything from a simple counter to live data streaming from the network. 🌊

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

### 🔄 derived — a value that updates automatically

No need to manually list dependencies. Just read other atoms inside a function:

```ts
const first = atom("Ada");
const last  = atom("Lovelace");

const fullName = derived(() => `${first.value} ${last.value}`);

first.next("Grace");
console.log(fullName.value); // "Grace Lovelace"
```

It only notifies you when the *result* actually changes, and it handles conditional dependencies like a pro. Cycles throw an error instead of looping forever.

### 🌐 flow — values that come from async sources

Need data from an API, timer, WebSocket, or anything async? `flow` turns it into an atom:

```ts
const ticks = flow(interval(1000));           // every second ⏰
const user  = flow(fetch("/me").then(r => r.json()));
```

It only starts pulling data when someone subscribes, and automatically stops when everyone unsubscribes. Smart!

### 🗂️ scope — the organizer that cleans up after you

A scope automatically tracks all atoms and nested scopes created inside it, and disposes everything together when you call `.dispose()`.

```ts
const app = scope(() => {
  const count = atom(0);
  const label = flow(someLiveSource);

  return { count, label };
});

// Later
app.dispose(); // everything gets cleaned up nicely 🧼
```

Scopes can nest, giving you a clean tree of state.

#### Factory form with `self`

When you use a factory function, the scope pre-creates a `self` proxy and passes it in. This lets derived values reference other scope members during setup without surprises:

```ts
const app = scope((self) => {
  const count = atom(0);
  const doubled = derived(() => self.count * 2);

  return { count, doubled };
});
```

#### Object shorthand

For simpler state, pass a plain object. Primitives are automatically wrapped in atoms, nested plain objects become nested scopes, and atoms or scopes pass through unchanged:

```ts
const app = scope({
  user: {
    name: '',
    email: '',
  },
  theme: 'dark',
});

app.user.name = 'Ada'; // writes through the underlying atom
app.theme = 'light';
```

#### Expression markers

Object shorthand is convenient, but because the shape is known up front it uses a plain `self` object rather than a Proxy. If a derived value needs to read `self`, use an expression marker:

```ts
import { derivedExpr, flowExpr, pipeExpr, scope } from '@epikodelabs/streamix';

const app = scope({
  query: '',
  results: flowExpr((self) => fetchUsers(self.query)),
  count: derivedExpr((self) => self.results.length),
});
```

`derivedExpr`, `pipeExpr`, and `flowExpr` are evaluated lazily and turned into regular atoms inside the scope.

#### Accessing raw atoms

The scope proxy exposes atom *values*. If you ever need the atom itself — for example to pass it to `pipe` or `combineLatest` — use `scope.at.key` or `scope.at('key')`:

```ts
const app = scope(() => {
  const count = atom(0);
  return { count };
});

pipe(app.at.count, map(n => n * 2)).subscribe(console.log);
```

Even better, keep atoms inside the scope factory, set up your streams there, and use `self` to read and write values. Then the outside world only sees values and methods, and the scope owns the lifecycle.

### ✨ Handy extras

- **`loading`** — Know instantly if any data is still loading (perfect for spinners! 🔄). A scope stays loading until every atom in its subtree has emitted at least once. If you want a flow to keep a scope loading during an async delay, don't emit a placeholder value before the delay — wait and emit the real value when it's ready.
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

### ⚡ Discrete vs Analog

By default, updates are immediate (“discrete”). Switch to **analog** mode for high-frequency stuff like mouse movement — it batches rapid updates into one final notification. Smooth! 🖱️

---

**Real-world example:**

```ts
const app = scope(() => {
  const query   = atom("");
  const results = pipe(query, debounce(300), switchMap(search));
  const count   = derived(() => results.value?.length ?? 0);
  const status  = flow(connectionStatus());

  return { query, results, count, status };
});
```

One `scope()` call gives you loading states, snapshots, automatic cleanup, and a beautiful organized tree. Magic! ✨
