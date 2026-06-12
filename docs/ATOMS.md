# Atoms & Scopes

Lightweight reactive state for Streamix.

**Atoms** are reactive state nodes.
**Scopes** are tree-shaped containers that own atoms and child scopes, track lifecycle, and expose a unified snapshot of state.

---

## Design

* **Atoms are reactive state nodes** — `atom` for writable values, `flow` for stream-backed values, `derived` for derived values.
* **Scopes form a tree** — each scope owns atoms and nested scopes created within its factory.
* **Loading state** — `scope.loading` is `true` until every tracked atom (recursively) has emitted at least once.
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

### `atom(initialValue)`

Creates a writable reactive state node.

```ts
const count = atom(0);
```

```ts
count.value;   // current value
count.prior;   // previous value
count.set(10); // update value
```

Subscribe to changes:

```ts
const sub = count.subscribe(v => console.log(v));
count.set(10);
sub.unsubscribe();
```

Dispose:

```ts
count.dispose();
```

---

### `atom(initialValue?)`

Creates a hot, writable atom. If no initial value is provided, it starts in an empty state, similar to a Subject.

```ts
const count = atom<number>();           // Starts with no initial value (like a Subject)
const withInitial = atom(0);            // Starts with an initial value
```

```ts
count.set(10);
count.value;   // 10
count.prior;   // undefined (no initial value)
```

Subscribe to changes:

```ts
const sub = count.subscribe(v => console.log(v));
count.set(10);
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
const source = createSubject<number>();
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
first.set('Grace');
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
setTimeout(() => a.set(1), 10);
setTimeout(() => a.set(2), 20);
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

---

## What Scopes do NOT do

* No manual registration — tracking is implicit
* No query/navigation API — structure is defined at creation time
* No batching — updates are synchronous and stream-driven
* No hidden mutation of public API shape
