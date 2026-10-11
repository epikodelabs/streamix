# React Adoption Layer

`@epikodelabs/streamix/react` is compiler-first: write Streamix sources in TSX or JSX and the compiler lowers JSX reads to React's concurrent-safe external-store contract.

```tsx
import { atom } from '@epikodelabs/streamix';

export function Counter() {
  let count = atom(0);
  return <button onClick={() => count++}>{count}</button>;
}
```

The compiler supports atoms, derived values, flows, scope fields, known aliases and atom maps, supported writes, anonymous default components, class components, and higher-order wrappers. Class components receive an internal function-component subscription boundary; wrapper callbacks are compiled when assigned to a capitalized component binding, with `memo` and `forwardRef` recognized through named-import aliases and `React.` namespace imports when actually imported from React.

## Subscription ownership and cleanup

Every implicit reactive JSX read becomes a retained `const` snapshot from
`useStreamixSource()`. The binding is rendered by a function component (or
passed to the generated class adapter), so React owns the subscription for the
mounted component lifetime. On unmount, React runs the external-store cleanup;
once the final consumer of a shared source has left, Streamix unsubscribes from
that source and releases the shared subscription.

For a class component, the compiler generates a private function wrapper that
owns the hooks and passes its snapshots through `__streamixBindings`. The
renamed inner class renders those snapshots. The private prop is generated
after authored props, so an authored prop cannot replace it.

### What is possible

- Function declarations, arrow/function-expression components, anonymous
  default exports, and capitalized component bindings can receive generated
  snapshot bindings.
- `memo`, `forwardRef`, named aliases of them, and `React.memo` /
  `React.forwardRef` are recognized when imported from React.
- A capitalized component assigned from an application wrapper call can have
  its first callback compiled as a React render function.
- Named class components receive the wrapper described above; it owns the
  external-store hooks while the inner class receives only snapshots.

### What is not implicit

- A wrapper callback invoked outside React is not safe for generated hooks.
  Use an explicit subscription boundary unless it is truly a React component
  render function.
- Dynamic imports, arbitrary proxy fields, unknown dynamic source selection,
  and callback-local dynamic selections remain explicit boundaries.
- React Activity / Offscreen cleanup is not distinguishable from permanent
  unmount. Use a parent-owned `StreamixLifetime` when a source must outlive a
  hidden subtree.

## Prop and runtime boundaries

An atom is read as a value in native JSX, but remains a reference when passed to a capitalized component. Type the receiving prop as `typeof source`. Scopes cross a component boundary the same way: type the prop as `typeof state` and read its fields directly. Use `atomRef()` for custom elements or third-party boundaries. For timers, callbacks, proxies, dynamic paths, and other unproven cases, use explicit `read()`, `write()`, and `useAtomValue()`.

`createResource()` is an explicit abortable Suspense resource: preload it outside render, then call `read()` inside a Suspense boundary. `useResource(loader, dependencies)` deliberately tracks the supplied dependency array, not the identity of `loader` — include every prop or state input affecting it — and `usePreloadedResource` covers initial Suspense. For SSR, render `renderAtomSnapshotScript()` on the server and call `hydrateAtomSnapshotFromDocument()` before `hydrateRoot()`.

## Ownership and React Activity

Local reactive declarations are stable for a committed component instance. Factories must be render-pure because Strict Mode may abandon an initial render.

React Activity / Offscreen can clean up effects merely because a tree is hidden. React does not expose a cleanup signal that distinguishes this from permanent unmount. For Activity trees, own sources outside the hidden subtree with `createStreamixLifetime()` and `StreamixLifetimeProvider`, and dispose that lifetime when the feature or route is permanently removed.

## Vite, builders, and editor

Install `typescript@^5.5` in applications using compiler tooling. The root manifest lists `typescript` as an optional peer for the vanilla runtime; importing the React compiler, Vite plugin, or builder makes it a required consumer dependency — including JSX-only apps.

In Vite, put Streamix before the React plugin; it transforms authored `.ts`, `.tsx`, `.js`, and `.jsx` modules and returns a composable source map.

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sx } from '@epikodelabs/streamix/react/vite';

export default defineConfig({ plugins: [sx(), react()] });
```

The Angular-hosted builder transforms TS/TSX/JS/JSX into `.angular/.streamix/<app>/src`, writes source maps beside the transformed files, and delegates `build` and `serve` to a normal Angular application target:

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

Point the delegated target at the preprocessing output:

```json
{
  "browser": ".angular/.streamix/my-app/src/main.tsx",
  "tsConfig": ".angular/.streamix/my-app/tsconfig.app.json"
}
```

### Builder resolution

Architect resolves `@epikodelabs/streamix/react/builder:application` through
the installed package's `react/builder/package.json`. In a source checkout,
run `npm run build` before starting Angular; the build finalizer writes that
subpackage manifest, exposes it through the package exports map, and links the
local `dist/streamix` package into `node_modules`. In a consuming application,
install a package release that contains the builder, then verify resolution
with:

```sh
node -p "require.resolve('@epikodelabs/streamix/react/builder/package.json')"
```

If this command fails, the installed package is missing the builder manifest;
reinstall the intended release or replace a source-linked dependency with a
built package before running `ng serve`.

For atom-aware diagnostics and navigation, add `@epikodelabs/streamix/react/editor/tsserver` to `compilerOptions.plugins` and restart the TypeScript server. The editor sees an atom as its current value, checks assignments as `.next(...)` writes, and also covers Streamix-authored `.ts` and `.js` helpers. The editor is an aid; the production compiler is authoritative for generated output.

`StreamixDevtools` is an opt-in panel for reactive reads, subscriptions, writes, unsubscriptions, and committed renders. It is enabled only when the bundler marks the build as development (`import.meta.env.DEV`), so production bundles and bundler-less ESM stay disabled.

## Release verification

The repository ships regression specs for React Activity, Strict Mode, compiler output, Vite, and the Angular-hosted builder. They do not replace real dependency versions: before publishing, verify React Compiler, Fast Refresh, Suspense and hydration, composed source maps, and a clean `npm pack` install in TSX and JSX apps, in both development and minified production builds. Implicit adoption is not promised for arbitrary dynamic imports, proxy fields, wrappers that do not render their callback through React, or React Activity without a parent-owned `StreamixLifetime`.
