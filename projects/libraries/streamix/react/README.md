# `@epikodelabs/streamix/react`

React bindings for [streamix](https://github.com/epikodelabs/streamix).
React owns rendering; streamix owns reactive state, async iteration, and
lifecycle.

The adapter intentionally exposes Streamix concepts instead of adding a
React-specific `useAtom` vocabulary:

- `useWritable()` — bind mutable Streamix state as `[value, setValue]`.
- `useIterable()` — read Streamix atoms/readables/flows or any `AsyncIterable`.
- `useScope()` — tie a Streamix scope to a component lifetime.
- `suspense()` / `useSuspense()` — bridge first-emission loading to Suspense.

## Install

```bash
npm install @epikodelabs/streamix react
```

`react` is an optional peer dependency and is only required when this entry
point is imported.

## `useWritable(source)`

Use `useWritable` when the component both reads and writes a Streamix
`Writable`.

```tsx
import { atom } from '@epikodelabs/streamix';
import { useWritable } from '@epikodelabs/streamix/react';

const counter = atom(0);

function Counter() {
  const [count, setCount] = useWritable(counter);

  return (
    <button onClick={() => setCount(count + 1)}>
      {count}
    </button>
  );
}
```

The hook does not mirror the value into React state. Reads are backed by
`useSyncExternalStore`; writes go directly to the Streamix source.

## `useIterable(source, initialValue?)`

Use `useIterable` for observation. Streamix atoms, readables, derived values,
and flows already expose a synchronous value/subscription contract and are also
async iterable, so they use React's external-store path without tearing.

```tsx
import { derived } from '@epikodelabs/streamix';
import { useIterable } from '@epikodelabs/streamix/react';

const doubled = derived(() => counter.value * 2);

function Total() {
  const value = useIterable(doubled);
  return <strong>{value}</strong>;
}
```

`useIterable` also accepts a plain `AsyncIterable<T>`. Because a plain iterable
has no synchronous current value, provide the value React should render before
the first emission:

```tsx
async function* messages() {
  // ...
}

function Messages() {
  const message = useIterable(messages(), 'Waiting…');
  return <span>{message}</span>;
}
```

For component-owned sources, pass a factory. The source is created once. An
owned Streamix atom/flow is disposed on unmount; a plain async iterator is
closed when React unsubscribes.

```tsx
import { flow } from '@epikodelabs/streamix';
import { on } from '@epikodelabs/streamix/dom';
import { useIterable } from '@epikodelabs/streamix/react';

function PointerCapability() {
  const finePointer = useIterable(
    () => flow(() => on('mediaQuery', '(pointer: fine)')),
    false,
  );

  return <span>{finePointer ? 'fine' : 'coarse'}</span>;
}
```

## `useScope(factory)`

Creates a Streamix scope once and ties its disposal to the component lifetime.
Use `useWritable` for writable scope fields and `useIterable` for read-only or
derived fields.

```tsx
import { scope } from '@epikodelabs/streamix';
import { useIterable, useScope, useWritable } from '@epikodelabs/streamix/react';

function Counter() {
  const state = useScope(() => scope({
    count: 0,
    doubled: (self) => self.count * 2,
  }));

  const [count, setCount] = useWritable(state.at.count);
  const doubled = useIterable(state.at.doubled);

  return (
    <button onClick={() => setCount(count + 1)}>
      {count} (doubled: {doubled})
    </button>
  );
}
```

## `suspense(source)` / `useSuspense(source)`

`suspense` adapts an atom into a Suspense resource. `useSuspense` combines the
first-emission suspend with live observation after the value arrives.

```tsx
function Profile({ source }: { source: Atom<Profile> }) {
  const profile = useSuspense(source);
  return <span>{profile.name}</span>;
}
```

## Which hook?

| Source | Hook |
| --- | --- |
| `Writable<T>` that the component edits | `useWritable(source)` |
| Atom / readable / derived / flow | `useIterable(source)` |
| Plain `AsyncIterable<T>` | `useIterable(source, initialValue)` |
| Component-owned atom / flow | `useIterable(() => source, initialValue?)` |
| Component-owned scope | `useScope(() => scope(...))` |

There is intentionally no `useAtom`. React code chooses by capability instead:
**writable** when it needs mutation, **iterable** when it needs observation.

## StrictMode disposal

`useScope` and factory-owned Streamix sources defer disposal by one microtask.
That absorbs React StrictMode's development-only mount → unmount → remount
cycle. A real unmount still disposes the resource immediately after that small
deferral. Plain async iterables use the same deferred-stop idea so StrictMode
does not close an iterator between its synthetic unsubscribe/resubscribe pair.
