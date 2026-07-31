# ⚛️ Streamix and React

React apps can use streamix today. It is a TypeScript ESM library, so it can be
imported from components, hooks, services, or event handlers.

The caveat: streamix does not disappear into React's model. It brings its own
atoms, scopes, cleanup, async pipelines, DOM sources, networking, and
coroutines. React already has conventions for many of those jobs.

So the honest answer is:

> streamix is React-compatible, but it is not React-native.

It can be useful in React, especially for async orchestration, but it should be
treated as a separate runtime with a clear boundary.

## ✅ Where It Fits

streamix fits best when React owns the UI and streamix owns workflow logic:

- event flows that are easier to express as pipelines
- sequential async workflows
- browser APIs that produce ongoing values
- Web Worker or coroutine-style workloads
- component-local orchestration with explicit cleanup
- services that feed React at a controlled boundary

A typical integration is manual but valid:

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
| DOM events | JSX handlers and refs | `listen` and DOM sources |
| Data fetching | loaders, TanStack Query, SWR, Suspense patterns | pipelines and networking |
| Workers | browser workers and framework tooling | coroutines and actors |

This does not make streamix incompatible. It means you need to decide which
runtime owns each part of the problem.

## 📊 Current Fit

| Area | Fit | Notes |
| --- | --- | --- |
| Package use | Good | React apps can import streamix normally. |
| TypeScript | Good | APIs are typed and work in TS projects. |
| Tree shaking | Good | ESM package with `sideEffects: false`. |
| Component usage | Partial | Works through effects, refs, and manual subscriptions. |
| Hook support | Missing | No official `useAtom`, `useFlow`, or `useScope`. |
| External-store bridge | Missing | No official `useSyncExternalStore` adapter. |
| Concurrent rendering | Unclear | No policy for snapshots, tearing, or render-phase reads. |
| Suspense | Missing | No official Suspense resource adapter. |
| SSR | Unclear | DOM, networking, and workers need explicit boundaries. |

## 🧩 What A React Adapter Would Need

A React-specific entry point could make the boundary easier to repeat:

```ts
@epikodelabs/streamix/react
```

Useful APIs:

- `useScope(options?)` - create and dispose a streamix scope with a component
- `useAtom(atom)` - read an atom through `useSyncExternalStore`
- `useFlow(flow, initialValue?)` - expose the latest flow value to React
- `useSubscription(source, callback, deps?)` - bind a subscription to effect cleanup
- `useAsyncIterable(source, options?)` - consume async iterables with cancellation
- `createSuspenseResource(source)` - adapt async work to Suspense

These helpers would not make streamix part of React's core model. They would make
the boundary safer.

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
