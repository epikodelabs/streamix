# React Adoption Layer

`@epikodelabs/streamix/react` connects Streamix state to React components.

React still renders the UI. Streamix holds state, derived values, and asynchronous work. The adapter gives components a small set of hooks for reading, writing, and owning those reactive sources.

## Install

```bash
npm install @epikodelabs/streamix react
```

## Read and write an atom

Use `useWritable()` when a component needs to display a value and update it.

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

The component receives the familiar `[value, setValue]` shape. The value still belongs to Streamix, so other components can use the same atom without creating a second copy of the state.

## Read reactive values

Use `useIterable()` when the component only needs to observe a Streamix atom, derived value, or flow.

```tsx
import { derived } from '@epikodelabs/streamix';
import { useIterable } from '@epikodelabs/streamix/react';

const doubled = derived(() => counter.value * 2);

function Total() {
  const value = useIterable(doubled);
  return <strong>{value}</strong>;
}
```

`useIterable()` also works with a regular `AsyncIterable`. Provide an initial value for anything that does not have a value immediately:

```tsx
async function* messages() {
  // Receive messages over time.
}

function Messages() {
  const message = useIterable(messages(), 'Waiting…');
  return <span>{message}</span>;
}
```

## Keep feature state with the component

Use `useScope()` when a component owns a group of related state.

```tsx
import { scope } from '@epikodelabs/streamix';
import {
  useIterable,
  useScope,
  useWritable,
} from '@epikodelabs/streamix/react';

function Counter() {
  const state = useScope(() => scope({
    count: 0,
    doubled: self => self.count * 2,
  }));

  const [count, setCount] = useWritable(state.get('count'));
  const doubled = useIterable(state.get('doubled'));

  return (
    <button onClick={() => setCount(count + 1)}>
      {count} (doubled: {doubled})
    </button>
  );
}
```

The scope is created once for the component and is cleaned up when the component is no longer on screen. This is useful for local state, calculated values, and asynchronous work that belong to the same feature.

## Work with loading states

Use `useSuspense()` when a component should wait for an atom’s first value before rendering.

```tsx
import { useSuspense } from '@epikodelabs/streamix/react';

function Profile({ source }: { source: Atom<Profile> }) {
  const profile = useSuspense(source);
  return <span>{profile.name}</span>;
}
```

Wrap the component in React’s `<Suspense>` boundary to decide what people see while the first value is loading.

## Which hook should I use?

| When the component needs to… | Use |
| --- | --- |
| Read and update an atom | `useWritable(source)` |
| Read an atom, derived value, or flow | `useIterable(source)` |
| Read a plain async iterable | `useIterable(source, initialValue)` |
| Own related Streamix state for its lifetime | `useScope(() => scope(...))` |
| Wait for the first atom value with Suspense | `useSuspense(source)` |

There is no `useAtom` hook because React components usually need one of two things: a value they can **change**, or a value they can **observe**. The hook name makes that choice clear.

## The goal

The React adapter is intentionally small. It does not replace React’s rendering model or ask you to learn a second component model.

Keep shared state and asynchronous work in Streamix. Use React for components. Let the adapter connect the two.
