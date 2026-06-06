# Atoms & Scopes

Lightweight reactive state for Streamix.

**Atoms** are stream-connected state nodes.
**Scopes** are tree-shaped containers that own atoms and child scopes, track lifecycle, and expose a unified snapshot of state.

---

## Design

* **Atoms are stream-connected state nodes** — created from a stream and updated automatically on emissions.
* **Scopes form a tree** — each scope owns atoms and nested scopes created within its factory.
* **Loading state** — `scope.loading` is `true` until every tracked atom (recursively) has emitted at least once.
* **Implicit registration** — items are tracked automatically via execution context; no manual wiring required.
* **Public API is explicit** — only values returned from the factory are exposed on the scope object.

---

## Tree model

```
app (loading)
├── header (loading)
│   └── title = atom(titleStream, '')
├── main (loading)
│   ├── count = atom(counterStream, 0)
│   └── label = atom(labelStream, 'hello')
└── footer = atom(footerStream, '')
```

Only returned values define the public shape:

```ts
return { header, main, footer };
```

Internal tracking remains separate from public structure.

---

## API

### `atom(stream, initialValue)`

Creates a reactive state node connected to a stream.

```ts
const source = createSubject<number>();
const count = atom(source, 0);
```

```ts
count.value;         // current value
count.previousValue; // previous value
```

Subscribe to changes:

```ts
const sub = count.subscribe(v => console.log(v));
source.next(10);
sub.unsubscribe();
```

Update manually:

```ts
count.update(n => n + 1);
```

Dispose:

```ts
count.dispose();
```

---

### `scope(factory)`

Creates a scoped reactive tree. All atoms and nested scopes created inside are automatically tracked.

```ts
const app = scope(() => {
  const count = atom(counterStream, 0);
  const label = atom(labelStream, 'hello');

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
  const a = atom(streamA, 0);
  const b = atom(streamB, '');

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
