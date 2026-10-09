# Archived React Runtime Adapter

> The custom React hooks documented below have been removed. React integration
> is now compiler-first; see [`docs/REACT.md`](../../../../docs/REACT.md) and
> `@epikodelabs/streamix/react/compiler` instead.

`@epikodelabs/streamix/react` connects Streamix state to React components.

React still renders the UI. Streamix holds state, derived values, and asynchronous work. The adapter gives components a small set of hooks for reading, writing, and owning those reactive sources.

## JSX adoption contract

React components use atoms directly. The compiler resolves reactive expressions
before they reach React; application code does not import subscription helpers.

```tsx
function Profile() {
  let title = atom('Ready');
  const state = scope({ enabled: true, message: 'Connected' });

  return (
    <section>
      <input value={title} onChange={event => title = event.target.value} />
      <input type="checkbox" checked={state.enabled}
        onChange={event => state.enabled = event.target.checked} />
      <p>{title}: {state.message}</p>
    </section>
  );
}
```

### What the compiler does

- A standalone `atom(...)` or `flow(...)` used in a JSX prop or child becomes
  a React subscription.
- A `derived(...)` atom is handled the same way, so a derived value can be
  rendered directly as `{total}`.
- A value-first scope field such as `state.message` is resolved reactively by
  the compiler.
- `atom = value` becomes `atom.next(value)`. Declare an atom with `let` when
  using assignment syntax.
- `scope.field = value` retains the normal scope write semantics.
- Component code receives ordinary values; React never receives an atom object.

All generated subscription code is an implementation detail. It is not part of
application source or the public authoring API.

### Enable the compiler builder

Use the Streamix React builder as the `build` and `serve` target, with a normal
Angular application target as its delegate. The builder copies the application
to `.angular/streamix-react/`, transforms every `.tsx` file, and delegates the
generated entry to the normal esbuild application builder.

```json
{
  "build": {
    "builder": "@epikodelabs/streamix/react/builder:application",
    "options": {
      "delegateTarget": "my-app:application",
      "sourceRoot": "projects/apps/my-app/src"
    }
  }
}
```

Configure the delegated `application` target to use the generated entry and
generated TypeScript project:

```json
{
  "browser": ".angular/streamix-react/projects/apps/my-app/src/main.tsx",
  "tsConfig": ".angular/streamix-react/projects/apps/my-app/tsconfig.app.json"
}
```

`app7` is the complete working example, including standalone atoms, scoped
properties, writes, boolean/select props, and a `flow()` source.

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
