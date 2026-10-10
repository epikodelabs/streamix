# React Adoption Layer

`@epikodelabs/streamix/react` is a compiler-first integration for React.
Write Streamix atoms and scopes directly in TSX; the compiler lowers JSX reads
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

## Strict Mode and ownership

Local reactive declarations are stable for a committed component instance and
dispose after unmount. React development Strict Mode can abandon an initial
render, so local initialization must be render-pure. The compiler rejects
obvious render work in a local initializer: unknown calls, `new`, `await`, and
writes.

Start work from an effect, event handler, route loader, or explicit resource
preload. A hook cannot retroactively give an abandoned render a committed
identity.

## Builder setup

### Native Vite React

Use the Vite plugin before the React JSX plugin. It transforms authored TSX,
reports source-located compiler diagnostics, and returns a map Vite can compose
with its normal React build pipeline.

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

The builder transforms TSX into `.angular/.streamix/<app>/src`, writes source
maps beside transformed files, then delegates to the normal application build.
`app7` is the working example.

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
writes, unsubscriptions, and committed renders. Compiler-added bindings map
back to their originating JSX expression through generated source maps.

For the complete semantics and limitations, see
[React compiler semantics](../../../../docs/REACT-COMPILER-SEMANTICS.md) and
[React documentation](../../../../docs/REACT.md).
