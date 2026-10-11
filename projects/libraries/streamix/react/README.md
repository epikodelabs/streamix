# React Adoption Layer

`@epikodelabs/streamix/react` is a compiler-first integration for React.
Write Streamix atoms and scopes directly in TSX or JSX; the compiler lowers JSX reads
to React's concurrent-safe external-store contract.

```tsx
import { atom, scope } from "@epikodelabs/streamix";

export function Profile() {
  let name = atom("Ada");
  const state = scope({ saved: true });

  return (
    <section>
      <input value={name} onChange={event => name = event.target.value} />
      <p>{state.saved ? "Saved" : "Editing"}: {name}</p>
    </section>
  );
}
```

No subscription hook belongs in ordinary application component code.

## What the compiler supports

- JSX reads of `atom(...)`, `derived(...)`, `flow(...)`, and scope fields.
- Stable component-local atom, derived, flow, and scope ownership.
- Direct, compound, prefix/postfix, and fully-known destructured atom writes.
- Static aliases, destructuring, literal atom maps, and conditional selection.
- Atom-reference transport to capitalized React components.
- Concurrent-safe reads through `useSyncExternalStore`; subscriptions begin only
  after a render commits.

```tsx
let primary = atom("Primary");
const secondary = atom("Secondary");
const choices = { primary, secondary };

function Choice({ alternate }: { alternate: boolean }) {
  const { primary: selected } = choices;
  return <button onClick={() => primary++}>
    {choices[alternate ? "secondary" : "primary"]}: {selected}
  </button>;
}
```

Scope fields are granular:

```tsx
const state = scope({ title: "Ready", enabled: true });

return <input
  checked={state.enabled}
  onChange={event => state.enabled = event.target.checked}
  value={state.title}
/>;
```

## Prop boundaries

Atoms are values in JSX and native DOM props, but references when passed to a
capitalized React component:

```tsx
const title = atom("Ready");

function Editor({ source }: { source: typeof title }) {
  return <input value={source} />;
}

<Editor source={title} />;
```

For custom elements or third-party components, mark a reference explicitly:

```tsx
import { atomRef } from "@epikodelabs/streamix/react";

<x-editor source={atomRef(title)} />;
```

Scopes can cross a component boundary the same way. Type the destructured prop
as `typeof state`, then read its fields directly:

```tsx
function Summary({ model }: { model: typeof state }) {
  return <output>{model.title}</output>;
}

<Summary model={state} />;
```

## Strict Mode, Activity, and ownership

Local reactive declarations are stable for a committed component instance.
For an ordinary mounted component with no explicit lifetime, they dispose on
effect cleanup (after a Strict Mode-safe microtask grace period). **React
Activity / Offscreen can run that cleanup merely because a tree is hidden.**
React has no effect-cleanup signal that distinguishes hide from permanent
unmount, so that automatic strategy is not Activity-safe.

For Activity or any tree that may preserve hook state while hidden, explicitly
own the reactive instances *outside* the hidden subtree:

```tsx
import { createStreamixLifetime, StreamixLifetimeProvider } from "@epikodelabs/streamix/react";

const lifetime = createStreamixLifetime(); // owned by your feature / route host
root.render(
  <StreamixLifetimeProvider lifetime={lifetime}>
    <Activity mode="visible"><Screen /></Activity>
  </StreamixLifetimeProvider>
);
// When the feature is permanently removed, not when Activity is hidden:
root.unmount();
lifetime.dispose();
```

This lifetime also owns `useResource` resources and cancels them when disposed.
Resource replacements resulting from dependency changes still cancel the old
resource. The tradeoff is deliberate: child instances remain retained after a
child unmount until their parent lifetime is disposed. Choose an appropriately
short-lived feature/route boundary, never a global lifetime for transient lists.

React development Strict Mode may abandon an initial render, so factory
initialization must be render-pure. The compiler rejects obvious render work
in a local initializer: unknown calls, `new`, `await`, and writes. Only
*committed* instances are registered in an explicit lifetime.

Start work from an effect, event handler, route loader, or explicit resource
preload. A hook cannot retroactively give an abandoned render a committed
identity.

## Builder setup

### Native Vite React

Use the Vite plugin before the React JSX plugin. It transforms authored
`.ts`, `.tsx`, `.js`, and `.jsx` modules, reports source-located compiler
diagnostics, and returns a source map Vite can compose with its usual pipeline.
Preserved tokens map to their exact authored occurrence; synthetic hook
bindings are intentionally unmapped. The generated code is a rewritten AST,
not a formatting-preserving text edit.

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sx } from "@epikodelabs/streamix/react/vite";

export default defineConfig({
  plugins: [sx(), react()],
});
```

### Angular-hosted React

Use the Streamix React builder for `build` and `serve`, delegating to a normal
Angular application target:

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

Point the delegated target at preprocessing output:

```json
{
  "browser": ".angular/.streamix/my-app/src/main.tsx",
  "tsConfig": ".angular/.streamix/my-app/tsconfig.app.json"
}
```

The builder transforms TS/TSX/JS/JSX into `.angular/.streamix/<app>/src`,
writes source maps beside transformed files, then delegates to the normal
application build. Test files and declarations remain unchanged.
`app7` is the working example.

## Editor type checking

Add the TypeScript-server plugin to a React project's `tsconfig.json`. VS Code
uses this through its built-in TypeScript extension; it is not a separate VS
Code UI extension.

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "@epikodelabs/streamix/react/editor/tsserver" }
    ]
  }
}
```

Restart the TypeScript server after installing or changing this setting. For
supported JSX expressions, the editor sees an atom as its current value (for
example `atom(1)` is a `number` in `{count.toFixed()}`), while assignments are
checked as `.next(...)` writes. Diagnostics and navigation spans map back to
the authored source. The editor also supports Streamix-authored `.ts` and
`.js` helpers. The production compiler remains authoritative for emitted
JavaScript; editor adoption of arbitrary imported symbols remains more
limited than compiler adoption through a TypeScript Program.

## Explicit runtime boundaries

Dynamic paths, re-exports, proxy/getter-backed objects, unknown third-party
props, and callbacks needing the current value remain explicit:

```tsx
import { read, write } from "@epikodelabs/streamix/react";

setTimeout(() => console.log(read(status)), 1000);
write(status, "Saved");
```

`createResource(loader)` supplies explicit abortable Suspense resources:
preload outside render, then call `read()` inside a Suspense boundary. For SSR,
use `renderAtomSnapshotScript()` on the server and
`hydrateAtomSnapshotFromDocument()` before `hydrateRoot()`.

## Tooling

`StreamixDevtools` is an opt-in panel for reactive reads, subscriptions,
writes, unsubscriptions, and committed renders. Source maps preserve positions of unchanged tokens across repeated JSX
expressions; synthesized hook machinery does not pretend to originate in
application source.

For the complete semantics and limitations, see the
[React documentation](../../../../docs/REACT.md).

## Release verification still required

The repository contains regression specs for React Activity, Strict Mode,
compiler output, Vite, and the Angular-hosted builder. Verify these against
the project's actual React, TypeScript, Vite, and builder dependencies before
release. The isolated TypeScript/compiler harness does not replace real React
Compiler, Fast Refresh, Suspense, hydration, or esbuild map-composition tests.
