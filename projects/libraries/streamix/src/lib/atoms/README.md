# Atoms & Scopes

Lightweight reactive state for Streamix. **Atoms** are read-only values backed by streams. **Scopes** group atoms and child scopes, snapshot them, and dispose them recursively — all without manual bookkeeping.

## Design

- **Atoms are stream-backed** — you cannot create an atom without a stream. Its value updates automatically as the stream emits.
- **Scopes are smart containers** — anything created inside a scope factory (atoms, nested scopes) is tracked automatically.
- **No infrastructure noise** — no names, no manual `register()`, no `getCurrentScope()`. Return values from the factory are merged onto the scope for direct access.

## API

### `atom(stream, initialValue)`

Creates a reactive atom attached to a stream.

```typescript
import { atom, createSubject } from '@epikodelabs/streamix';

const source = createSubject<number>();
const count = atom(source, 0);

console.log(count.value);         // 0
source.next(5);
console.log(count.value);         // 5
console.log(count.previousValue); // 0
```

Subscribe to changes:

```typescript
const sub = count.subscribe(v => console.log(v));
source.next(10); // logs 10
sub.unsubscribe();
```

Update via transformation:

```typescript
count.update(n => n + 1); // count.value === 11
```

Dispose when done:

```typescript
count.dispose();
count.disposed; // true
```

### `scope(factory)`

Creates a scope. The factory's return value is merged onto the scope so you can access atoms directly. Every atom or nested scope created inside the factory is automatically tracked and disposed recursively.

```typescript
import { atom, createSubject, scope } from '@epikodelabs/streamix';

const counterStream = createSubject<number>();
const labelStream = createSubject<string>();

const app = scope(() => {
  const count = atom(counterStream, 0);
  const label = atom(labelStream, 'hello');
  return { count, label };
});

// Typed access via merged return value
console.log(app.count.value);  // 0
console.log(app.label.value);  // 'hello'

// Dispose everything at once
app.dispose();
```

#### Nested scopes

Child scopes created inside a factory are automatically tracked by their parent.

```typescript
const root = scope(() => {
  const header = scope(() => {});
  const main   = scope(() => {});
  return { header, main };
});

root.dispose(); // disposes root + header + main
```

#### Snapshots

`snapshot()` returns an array with the current value of every tracked atom. For nested scopes it recurses.

```typescript
const app = scope(() => {
  const child = scope(() => {
    const a = atom(createSubject<number>(), 42);
    return { a };
  });
  return { child };
});

console.log(app.snapshot()); // [[42]]
```

## What Scopes Do NOT Do

- **No manual registration** — atoms and scopes are captured automatically inside the factory.
- **No `batch()` or `combineLatest()`** — atoms update synchronously; compose them with standard stream operators if you need coordination.
- **No tree navigation helpers** — the scope interface is intentionally minimal.
