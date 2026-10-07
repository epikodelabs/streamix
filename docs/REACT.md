# ⚛️ Streamix and React

React apps can use streamix today. It is a TypeScript ESM library, so it can be
imported from components, hooks, services, or event handlers.

The caveat: streamix does not disappear into React's model. It brings its own
atoms, scopes, cleanup, async pipelines, DOM sources, and networking. React
already has conventions for many of those jobs. The official adapter —
`@epikodelabs/streamix/react` — connects the two without pretending they are
one runtime.

So the honest answer is:

> streamix is React-compatible, but it is not React-native.

It can be useful in React, especially for async orchestration, but it should be
treated as a separate runtime with a clear boundary.

## ✅ Where It Fits

streamix fits best when React owns the UI and streamix owns workflow logic:

- event flows that are easier to express as pipelines
- sequential async workflows
- browser APIs that produce ongoing values
- component-local orchestration with explicit cleanup
- services that feed React at a controlled boundary

The adapter covers the common handoff directly:

```tsx
import { useWritable } from '@epikodelabs/streamix/react';

const [value, setValue] = useWritable(source);
```

A manual subscription is still valid, and is what the hooks do underneath:

```tsx
useEffect(() => {
  const unsubscribe = flow.subscribe(value => {
    setValue(value);
  });

  return () => unsubscribe();
}, [flow]);
```

## ⚠️ Where It Does Not Blend In

streamix overlaps with React and its ecosystem:

| Concern | React ecosystem | streamix |
| --- | --- | --- |
| Local UI state | `useState`, `useReducer`, external stores | atoms and derived atoms |
| Subscriptions | `useSyncExternalStore` | atom subscriptions and async iterables |
| Lifecycle | `useEffect` cleanup | scopes and cleanup sets |
| DOM events | JSX handlers and refs | `addListener` and DOM event sources |
| Data fetching | loaders, TanStack Query, SWR, Suspense patterns | pipelines and networking |
This does not make streamix incompatible. It means you need to decide which
runtime owns each part of the problem.

## 📊 Current Fit

| Area | Fit | Notes |
| --- | --- | --- |
| Package use | Good | React apps can import streamix normally. |
| TypeScript | Good | APIs are typed and work in TS projects. |
| Tree shaking | Good | ESM package with `sideEffects: false`. |
| Component usage | Good | The adapter's hooks cover reads, writes, and ownership. |
| Hook support | Good | `useWritable`, `useIterable`, `useScope`, `useSuspense`. |
| External-store bridge | Good | `useIterable` reads through `useSyncExternalStore`. |
| Concurrent rendering | Covered | Snapshots come from the external-store bridge, not render-phase reads. |
| Suspense | Good | `useSuspense(atom)` and `suspense(atom)` for resources. |
| SSR | Unclear | DOM, networking, and workers need explicit boundaries. |

## 🧩 The React Adapter

`@epikodelabs/streamix/react` is the official entry point, and it stays small:

- `useWritable(source)` - `[value, setValue]` for a writable atom
- `useIterable(source)` - observe an atom, derived value, or flow (an initial
  value is required for plain async iterables)
- `useScope(() => scope(...))` - own a scope for the component's lifetime
- `useSuspense(source)` - wait for an atom's first value inside `<Suspense>`
- `suspense(source)` - adapt an atom into a Suspense resource for loaders

There is deliberately no `useAtom`: a component usually needs either a value it
can change or a value it can observe, and the hook names make that choice
explicit. The full surface lives in the
[React adoption layer README](https://github.com/epikodelabs/streamix/blob/main/projects/libraries/streamix/react/README.md).

The hooks do not make streamix part of React's core model. They make the
boundary safe to repeat.

## 🛠️ Practical Guidance

Use React first for React-shaped problems:

- local UI state
- rendering subscriptions
- JSX event handlers
- route and framework data loading
- server rendering boundaries
- existing data-cache workflows

Use streamix when the problem is better described as workflow orchestration:

- "listen to this source, transform it, cancel stale work"
- "run these async steps in order"
- "coordinate background work"
- "consume browser events as a flow"
- "keep this orchestration outside the component tree"

The clean architecture is not "replace React patterns with streamix." It is
"let React render, let streamix orchestrate, and keep the handoff small."

## 🎯 Final Assessment

streamix can work well in React, but it should not be presented as seamless
React ecosystem integration.

> streamix is React-compatible today. It can live inside React apps as a
> companion runtime for async orchestration, but because it implements overlapping
> primitives itself, the integration boundary should be explicit.
