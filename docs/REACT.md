# Getting started with Streamix and React

Streamix lets React components use atoms and scopes as ordinary JSX values. The
React compiler generates concurrent-safe subscriptions; your components do not
need `useEffect` subscriptions or copied React state.

## 1. Configure Vite

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

## 2. Create your first atom

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

## 3. Group fields with a scope

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

## 4. Derive values

Use `derived` for values computed from Streamix sources. `$` receives an atom
reference, tracks it as a dependency, and returns its current value.

```tsx
const label = derived($ => `${$(count)} clicks`);
return <output>{label}</output>;
```

`$(count)` is intentionally an atom-reference argument. It is not compiled to
`$(count.value)`.

## 5. Pass a source to a child

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

## Activity, resources, and SSR

Strict Mode effect replay is handled by the runtime. For React Activity or
Offscreen trees whose sources must survive hiding, place a
`StreamixLifetimeProvider` around the hidden tree with a parent-owned
`createStreamixLifetime()` and dispose that lifetime when the feature ends.

Use `createResource()` and preload before render for initial Suspense. Use
`useResource(loader, dependencies)` for post-commit loading, including every
loader input in `dependencies`. For SSR, render `renderAtomSnapshotScript()`
on the server and call `hydrateAtomSnapshotFromDocument()` before hydration.

## Editor and Angular-hosted builds

Add `@epikodelabs/streamix/react/editor/tsserver` to TypeScript server plugins
for atom-aware diagnostics; the production compiler remains authoritative.

For Angular-hosted builds, configure
`@epikodelabs/streamix/react/builder:application`. It mirrors transformed
source to `.angular/.streamix/<app>/src` and delegates to an Angular target. In
a source checkout, run `npm run build` before starting that builder.
