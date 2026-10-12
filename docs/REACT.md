# Getting started with Streamix and React

Streamix lets React components use atoms and scopes as ordinary JSX values. The
React compiler generates concurrent-safe subscriptions; your components do not
need `useEffect` subscriptions or copied React state.

## 1. Install

Install the Streamix package together with the normal React and Vite tooling:

```sh
npm install @epikodelabs/streamix react react-dom
npm install -D typescript vite @vitejs/plugin-react
```

The compiler, Vite plugin, editor plugin, and Angular-hosted builder are
subpaths of `@epikodelabs/streamix`; importing one makes TypeScript a required
application dependency. Streamix requires React 18 or newer and TypeScript
5.5 or newer — including JSX-only projects.

## 2. Configure Vite

Put Streamix before the React plugin so it sees authored TSX first.

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { sx } from '@epikodelabs/streamix/react/vite';

export default defineConfig({ plugins: [sx(), react()] });
```

The plugin transforms `.ts`, `.tsx`, `.js`, and `.jsx` modules and returns a
source map that Vite composes with the React transform.

## 3. Create your first atom

Declare a local atom directly in a component body. JSX reads its current value;
the compiler owns the subscription and removes it when the component unmounts.

```tsx
import { atom } from '@epikodelabs/streamix';

export function Counter() {
  let count = atom(0);
  return <button onClick={() => count++}>{count}</button>;
}
```

The source is stable for the committed component lifetime. Keep local reactive
declarations before conditional returns and outside loops or nested callbacks:
React hook order must remain static, so unsupported nested declarations fail at
build time instead of becoming a raw atom in JSX.

### A shape the compiler rejects

```tsx
// Wrong: ownership would exist only for one branch.
function Counter({ visible }: { visible: boolean }) {
  if (visible) {
    let count = atom(0);
    return <button>{count}</button>;
  }
  return null;
}
```

Move the source to component scope, or split the conditional branch into its
own component:

```tsx
function Counter({ visible }: { visible: boolean }) {
  let count = atom(0);
  return visible ? <button>{count}</button> : null;
}
```

## 4. Group fields with a scope

Use a scope when several fields belong together. Scope fields are values in
JSX, and direct field assignments are Streamix writes.

```tsx
import { scope } from '@epikodelabs/streamix';

export function Profile() {
  const profile = scope({ name: 'Ada', subscribed: true });
  return <>
    <input value={profile.name}
      onChange={event => profile.name = event.target.value} />
    <input type="checkbox" checked={profile.subscribed}
      onChange={event => profile.subscribed = event.target.checked} />
  </>;
}
```

## 5. Derive values

Use `derived` for values computed from Streamix sources. `$` receives an atom
reference, tracks it as a dependency, and returns its current value.

```tsx
const label = derived($ => `${$(count)} clicks`);
return <output>{label}</output>;
```

`$(count)` is intentionally an atom-reference argument. It is not compiled to
`$(count.value)`.

## 6. Pass a source to a child

Native elements receive value snapshots. Capitalized React components receive
atom and scope references so that the child can subscribe independently.

```tsx
function Editor({ title }: { title: typeof pageTitle }) {
  return <input value={title} onChange={event => title.next(event.target.value)} />;
}

const pageTitle = atom('Draft');

export function Page() {
  return <Editor title={pageTitle} />;
}
```

Use `atomRef(source)` when passing an atom to a custom element or third-party
component whose boundary cannot be proven by the compiler.

```tsx
// Explicit transport across an unproven boundary.
return <third-party-editor source={atomRef(pageTitle)} />;
```

## What React receives

The compiler leaves the Streamix source itself in your component and adds the
React bridge only where JSX needs a value. Derived callbacks and event handlers
still work with raw Streamix sources, while rendering has React-owned
subscriptions.

```tsx
// Authored
let count = atom(0);
return <button onClick={() => count++}>{count}</button>;
```

```tsx
// Conceptual generated shape
const __value = useStreamixSource(count, 'count');
return <button onClick={() => count.next(count.value + 1)}>{__value}</button>;
```

The exact identifiers are compiler internals. The guarantees are that a
subscription starts only after commit, shares safely between consumers, and is
released after its final consumer leaves.

## Components and explicit APIs

Function components, `memo`, `forwardRef`, recognized aliases, capitalized
application wrappers, named classes, and anonymous `export default class`
components can be adopted. Class adoption creates a private function wrapper
that owns subscriptions and passes snapshots to a private inner class.

For code outside compiler-recognized JSX, use the runtime APIs:

```tsx
const [value, setValue] = useWritable(counter);
setValue(previous => previous + 1);

const current = useAtomValue(counter);
write(counter, current + 1);
```

Use `read` and `write` in timers, service callbacks, dynamic paths, and other
non-React code. A wrapper callback that might execute outside React is also an
explicit boundary.

### Supported and explicit cases

| Use case | Use |
| --- | --- |
| JSX value or supported JSX write | Raw atom or scope field |
| Derived dependency | `$(source)` inside `derived` |
| Capitalized React child prop | Pass the atom/scope reference |
| Custom element or third-party prop | `atomRef(source)` |
| Timer, callback, proxy, or dynamic path | `read`, `write`, or a React hook |
| Conditional ownership | A separate component or an explicit hook |

## DevTools

`StreamixDevtools` is an opt-in panel for reactive reads, subscriptions,
writes, unsubscriptions, and committed renders:

```tsx
import { StreamixDevtools } from '@epikodelabs/streamix/react';

<StreamixDevtools />
```

It renders only when the bundler marks the build as development
(`import.meta.env.DEV`); production bundles and bundler-less ESM stay clean.

## Activity, resources, and SSR

Strict Mode effect replay is handled by the runtime. For React Activity or
Offscreen trees whose sources must survive hiding, place a
`StreamixLifetimeProvider` around the hidden tree with a parent-owned
`createStreamixLifetime()` and dispose that lifetime when the feature ends.

Use `createResource()` and preload before render for initial Suspense. Use
`useResource(loader, dependencies)` for post-commit loading, including every
loader input in `dependencies`. For SSR, render `renderAtomSnapshotScript()`
on the server and call `hydrateAtomSnapshotFromDocument()` before hydration.

`useResource` survives Strict Mode's development effect replay. It is not a
replacement for a route loader when the first render itself must suspend: use a
preloaded resource for that case.

## Editor and Angular-hosted builds

Add `@epikodelabs/streamix/react/editor/tsserver` to TypeScript server plugins
for atom-aware diagnostics; the production compiler remains authoritative.

For Angular-hosted builds, configure
`@epikodelabs/streamix/react/builder:application`. It mirrors transformed
source to `.angular/.streamix/<app>/src` and delegates to an Angular target. In
a source checkout, run `npm run build` before starting that builder.

### Troubleshooting

- JSX shows an atom object: confirm `sx()` runs before the React plugin and the
  file is included by the Vite plugin.
- A component-local declaration is rejected: move it above the first possible
  return, out of loops and conditionals, or give it an explicit boundary.
- Architect cannot find the builder: run `npm run build` in this repository or
  install a package release containing `react/builder/package.json`.
- The editor disagrees with a build: restart the TypeScript server, then trust
  the production compiler's diagnostic and emitted output.

## Where to go from here

[Atoms and Scopes](./ATOMS.md) covers the core model the compiler consumes:
derived values, flows, transactions, operators, and the full scope API.
