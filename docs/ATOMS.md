# Atoms & Scopes

Lightweight reactive state for Streamix.

**Atoms** are reactive state nodes.
**Scopes** are tree-shaped containers that own atoms and child scopes, track lifecycle, and expose a unified snapshot of state.

---

## Design

* **Atoms are reactive state nodes** — `atom` for writable values, `flow` for stream-backed values, `derived` for derived values.
* **Scopes form a tree** — each scope owns atoms and nested scopes created within its factory.
* **Loading state** — `scope.loading` is `true` until every tracked atom (recursively) has emitted at least once. It is computed in O(1) from an internal pending-atom counter.
* **Implicit registration** — items are tracked automatically via execution context; no manual wiring required.
* **Public API is explicit** — only values returned from the factory are exposed on the scope object.

---

## Tree model

```
app (loading)
├── header (loading)
│   └── title = flow(titleStream, '')
├── main (loading)
│   ├── count = atom(0)
│   └── label = flow(labelStream, 'hello')
└── footer = flow(footerStream, '')
```

Only returned values define the public shape:

```ts
return { header, main, footer };
```

Internal tracking remains separate from public structure.

---

## API

### `atom(initialValue?)`

Creates a writable reactive state node. With an initial value it behaves like a behavior-aware primitive; without one it starts empty like a Subject.

```ts
const count = atom(0);
const source = atom<number>(); // starts empty (like a Subject)
```

```ts
count.value;    // current value
count.prior;    // previous value
count.next(10); // update value
```

Subscribe to changes:

```ts
const sub = count.subscribe(v => console.log(v));
count.next(10);
sub.unsubscribe();
```

Dispose:

```ts
count.dispose();
```

---

### `flow(stream)`

Creates a reactive state node connected to a stream.

```ts
const source = atom<number>();
const count = flow(source.pipe(startWith(0)));
```

```ts
count.value;         // current value
count.prior;         // previous value
```

Subscribe to changes:

```ts
const sub = count.subscribe(v => console.log(v));
source.next(10);
sub.unsubscribe();
```

Dispose:

```ts
count.dispose();
```

---

### `derived(factory)`

Creates a derived atom with automatic dependency tracking.

```ts
const first = atom('Ada');
const last = atom('Lovelace');
const full = derived(() => `${first.value} ${last.value}`);
```

```ts
full.value; // 'Ada Lovelace'
first.next('Grace');
full.value; // 'Grace Lovelace'
```

Dispose:

```ts
full.dispose();
```

---

### `iterate(atom)`

Creates an async iterable from any atom. Yields the current value immediately, then yields subsequent values whenever the atom emits. Completes when the atom is disposed.

```ts
import { atom, iterate } from '@epikodelabs/streamix';

const a = atom(0);
setTimeout(() => a.next(1), 10);
setTimeout(() => a.next(2), 20);
setTimeout(() => a.dispose(), 30);

for await (const value of iterate(a)) {
  console.log(value); // 0, 1, 2
}
```

---

### `scope(factory)`

Creates a scoped reactive tree. All atoms and nested scopes created inside are automatically tracked.

```ts
const app = scope(() => {
  const count = atom(0);
  const label = flow(labelStream.pipe(startWith('hello')));

  return { count, label };
});
```

Access:

```ts
app.count.value;
app.dispose();
```

---

## Nested scopes

```ts
const root = scope(() => {
  const header = scope(() => {});
  const main = scope(() => {});

  return { header, main };
});
```

```ts
root.dispose(); // disposes full tree
```

---

## Loading flag

`scope.loading` is `true` until all atoms in the tree emit at least once.

```ts
const app = scope(() => {
  const a = flow(streamA.pipe(startWith(0)));
  const b = flow(streamB.pipe(startWith('')));

  return { a, b };
});
```

```ts
app.loading; // true until both emit
```

### Loading at scale

`scope.loading` reads an internal counter, so it stays O(1) regardless of how many atoms or nested scopes are inside the tree. You can poll it freely in render loops or derived computations:

```ts
const dashboard = scope(() => {
  const kpis = Array.from({ length: 1000 }, (_, i) =>
    flow(loadKpi(i), 0)
  );
  return { kpis };
});

// Cheap even with thousands of tracked atoms
if (dashboard.loading) {
  renderSpinner();
}
```

---

## Snapshots

`snapshot()` returns a deep object representing current state.

```ts
app.snapshot();
```

Example:

```ts
{
  header: { title: "" },
  main: { count: 0, label: "hello" }
}
```

### Snapshot exports

Only keys returned from the scope factory are included in snapshots. Atoms and nested scopes created for internal bookkeeping are still tracked for lifecycle and loading, but they do not leak into the snapshot.

```ts
const page = scope(() => {
  const count = atom(0);
  const internal = atom('secret'); // used locally, not returned

  return { count };
});

page.snapshot(); // { count: 0 }
```

---

## How atoms synchronize

Atoms form a push-based reactive graph. Understanding the synchronization rules helps avoid surprises when combining `atom`, `derived`, `flow`, and scopes.

### Three kinds of atom

| Kind | Created with | Value source | Notifies on |
|---|---|---|---|
| Writable | `atom(initialValue?)` | `next(value)` | every `next()` |
| Derived | `derived(factory)` | re-runs factory when dependencies change | value actually changes |
| Stream | `flow(source, initialValue?)` | async iterable / promise / atom | every emitted value |

### Discrete mode (default)

By default, atoms are **discrete**: every `next()` call broadcasts synchronously to subscribers.

```ts
const a = atom(0);
let calls = 0;
a.subscribe(() => calls++);
a.next(0); // same value still notifies
calls; // 1
```

This synchronous broadcast also marks dependent `derived` atoms dirty; they are flushed in the next scheduler microtask so sources are never observed in an inconsistent state.

### Analog mode

A scope can be created with `{ mode: 'analog' }`:

```ts
const analogScope = scope(() => { ... }, { mode: 'analog' });
```

Atoms created inside an analog scope become **analog**: `next()` updates the value but defers the public broadcast to the scheduler's next microtask flush. Multiple synchronous `next()` calls collapse into a single subscriber notification with the latest value. This batches rapid updates so subscribers see only the final value per task.

Use `discrete(initialValue?)` or `atom(..., { discrete: true })` to force a single atom to stay discrete even inside an analog scope.

Derived atoms inside an analog scope also defer subscriber notifications to the scheduler, but their `.value` getter still recomputes on read so values remain live.

Flows created inside an analog scope buffer source emissions and broadcast only the latest value per scheduler flush, just like atoms and derived atoms.

### Global mode default

The global root context supplies the default mode for scopes created outside any other scope. Mutating it lets you opt an entire application into analog mode without repeating `{ mode: 'analog' }` on every `scope()` call:

```ts
import { globalScope, scope, atom } from '@epikodelabs/streamix';

globalScope.mode = 'analog';

const app = scope(() => {
  const count = atom(0);
  return { count };
});

// app is analog
```

A child scope can still override the default with `{ mode: 'discrete' }`.

### Mode inheritance

A scope inherits `mode` from its nearest non-root parent unless it provides its own option:

```ts
const parent = scope(() => {
  const child = scope(() => ({
    a: atom(0)
  }));

  const discreteChild = scope(() => ({
    b: atom(0)
  }), { mode: 'discrete' });

  return { child, discreteChild };
}, { mode: 'analog' });

// child is analog (inherits from parent)
// discreteChild is discrete (opts out)
```

### Derived atoms

`derived` tracks its dependencies automatically:

1. On first read it pushes a formula context.
2. Running `factory()` records every `.value` read.
3. It subscribes to each dependency with a callback that marks itself dirty.
4. `node.depth = max(dep.depth) + 1` so the scheduler always flushes dependencies first.
5. On each re-run it unsubscribes from dependencies that are no longer read.

A derived atom only notifies subscribers when its computed value actually changes (`Object.is` comparison).

### Flow atoms

`flow(source)` starts consuming its source lazily on the first subscription. Each yielded value updates the atom and broadcasts. The source can be:

- another atom
- an async iterable
- a sync iterable
- a promise
- a factory returning any of the above

`pipe(source, ...operators)` builds a flow pipeline by normalizing input into an async iterable, applying operators, and wrapping the result in `flow()`.

### Scope disposal

When a scope is disposed:

1. All cleanup hooks run.
2. Every owned atom and nested scope is disposed recursively.

Scope lifecycle and scheduling are separate concerns: the scope owns the tree and its teardown, while the scheduler owns the microtask flush that drains dirty analog atoms.

`scope()` automatically registers atoms created inside its factory. It also subscribes to them so derived atoms initialize eagerly, flows stay active, and emissions are recorded for `scope.loading`.

---

## What Scopes do NOT do

* No manual registration — tracking is implicit
* No query/navigation API — structure is defined at creation time
* No hidden mutation of public API shape
