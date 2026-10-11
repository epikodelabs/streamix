# React Adoption Layer

`@epikodelabs/streamix/react` is compiler-first: write Streamix sources in TSX or JSX and the compiler lowers JSX reads to React's concurrent-safe external-store contract.

```tsx
import { atom } from '@epikodelabs/streamix';

export function Counter() {
  let count = atom(0);
  return <button onClick={() => count++}>{count}</button>;
}
```

The compiler supports atoms, derived values, flows, scope fields, known aliases and atom maps, supported writes, anonymous default components, and imported `memo` / `forwardRef` wrappers. Class components and unknown higher-order wrappers are rejected when they contain implicit reactive JSX.

## Prop and runtime boundaries

An atom is read as a value in native JSX, but remains a reference when passed to a capitalized component. Type the receiving prop as `typeof source`. Use `atomRef()` for custom elements or third-party boundaries. For timers, callbacks, proxies, dynamic paths, and other unproven cases, use explicit `read()`, `write()`, and `useAtomValue()`.

`createResource()` is an explicit abortable Suspense resource: preload it outside render, then call `read()` inside a Suspense boundary. For SSR, render `renderAtomSnapshotScript()` on the server and call `hydrateAtomSnapshotFromDocument()` before `hydrateRoot()`.

## Ownership and React Activity

Local reactive declarations are stable for a committed component instance. Factories must be render-pure because Strict Mode may abandon an initial render.

React Activity / Offscreen can clean up effects merely because a tree is hidden. React does not expose a cleanup signal that distinguishes this from permanent unmount. For Activity trees, own sources outside the hidden subtree with `createStreamixLifetime()` and `StreamixLifetimeProvider`, and dispose that lifetime when the feature or route is permanently removed.

## Vite, builders, and editor

Install `typescript@^5.5` in applications using compiler tooling. In Vite, put Streamix before the React plugin; it transforms authored `.ts`, `.tsx`, `.js`, and `.jsx` modules and returns a composable source map.

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sx } from '@epikodelabs/streamix/react/vite';

export default defineConfig({ plugins: [sx(), react()] });
```

The Angular Architect builder mirrors transformed files into `.angular/.streamix/<app>/src` before delegating to the application target.

For atom-aware diagnostics and navigation, add `@epikodelabs/streamix/react/editor/tsserver` to `compilerOptions.plugins` and restart the TypeScript server. The editor is an aid; the production compiler is authoritative for generated output.

`StreamixDevtools` is an opt-in panel. Production builds should prove `NODE_ENV=production`; see [PRODUCTION.md](https://github.com/epikodelabs/streamix/blob/main/projects/libraries/streamix/react/PRODUCTION.md) for release gates and known limitations.
