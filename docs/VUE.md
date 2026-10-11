# Vue Adoption Layer

`@epikodelabs/streamix/vue` connects Streamix sources to Vue's Composition API and templates without duplicating state.

Declare Streamix state in `<script setup>` and let the compiler generate the Vue bridges — components never request composables themselves:

```vue
<script setup lang="ts">
import { atom, derived, scope } from '@epikodelabs/streamix';

const count = atom(0);
const doubled = derived(() => count * 2);
const profile = scope({ name: 'Ada' });
</script>

<template>
  <button @click="count++">{{ count }} / {{ doubled }}</button>
  <input v-model="profile.name">
</template>
```

Writable atoms become writable Vue refs, derived values and flows become read-only refs, and every declared scope is wrapped so its lifetime is tied to the component. Bare atom reads inside `derived` callbacks are transpiled — write `count`, not `count.value`. A `DerivedScope` tracker call such as `$(count)` is preserved because it needs the atom reference to register its dependency. Scope members the template touches are bridged individually, `v-model` included. `useWritable()`, `useIterable()`, and `useScope()` are generated internals: the compiler emits those calls and their imports, so there is nothing to import by hand.

## Subscription ownership, cleanup, and boundaries

Generated bridge refs belong to the component's Vue effect scope. They retain
their Streamix source while that scope is active; component unmount or an
explicit `effectScope().stop()` runs the bridge cleanup and unsubscribes.
`useScope()` also disposes the component-local Streamix scope it created. A
template reads the retained Vue ref snapshot rather than subscribing during
each render.

### What is possible

- Local `atom`, `derived`, `flow`, and `scope` declarations in `<script setup>`
  can be bridged automatically.
- Templates read those bridges as normal Vue bindings; writable atoms and
  writable scope fields support supported template writes, including `v-model`
  for scope fields.
- Atom reads inside compiler-recognized `derived` callbacks are lowered to
  current values, so `derived(() => count * 2)` is supported.
- Explicit `useIterable()` supports plain async iterables and closes the
  iterator with the Vue effect scope.

### What is not implicit

- Plain async iterables are not Streamix declarations; use `useIterable()` in
  `setup()` and choose an initial value explicitly.
- Timers, third-party callbacks, and code outside Vue's tracked setup/render
  path must use `read`, `write`, or `atomRef` explicitly.
- SSR hydration is explicit: render `renderAtomSnapshotScript()` on the server
  and call `hydrateAtomSnapshotFromDocument()` before mounting.

`useIterable()`, `useWritable()`, and `useScope()` require an active Vue effect
scope. They throw before creating a subscription or owned scope when called
outside `setup()` or `effectScope().run()`. For deliberate non-Vue ownership,
use `createIterableBridge(source)` and call `bridge.dispose()` when the owner
ends; its returned `bridge.ref` is the read-only Vue ref.

## Compiler-first SFCs

Put the Streamix Vite plugin before Vue's plugin to adopt local Streamix declarations from `<script setup>`:

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { sxVue } from '@epikodelabs/streamix/vue/vite';

export default defineConfig({ plugins: [sxVue(), vue()] });
```

Templates can then read local atoms, derived values, flows, and declared scope members as ordinary Vue bindings. For custom pipelines, `transformVueSfc(source, fileName)` returns transformed SFC text, diagnostics, and a version-3 source map.

## Escape hatch: async iterables

The compiler adopts Streamix declarations; a plain `AsyncIterable` is not one, so bridge it explicitly with an initial value to show before the first result arrives:

```vue
<script setup lang="ts">
import { useIterable } from '@epikodelabs/streamix/vue';

async function* messages() {
  // Receive messages over time.
}

const message = useIterable(messages(), 'Waiting…');
</script>

<template>
  <span>{{ message }}</span>
</template>
```

The iterator is closed with the component's effect scope. Outside a Vue effect
scope, create an explicitly owned bridge instead:

```ts
import { createIterableBridge } from '@epikodelabs/streamix/vue';

const bridge = createIterableBridge(messages(), 'Waiting…');
// Read bridge.ref.value.
bridge.dispose();
```

## Angular-hosted builds

An Angular workspace can host a Vue application. The Streamix builder mirrors the authored source tree to a virtual project, transforms every `.vue` file there, and delegates to a Vue-capable Architect target:

```json
{
  "build": {
    "builder": "@epikodelabs/streamix/vue/builder:application",
    "options": {
      "delegateTarget": "my-vue-app:application",
      "sourceRoot": "projects/apps/my-vue-app/src"
    }
  }
}
```

Point the delegated target at `.angular/.streamix/<app>/src`. A serve target watches the authored tree and keeps the virtual copy in sync.

## Boundaries, SSR, and editor support

Use `read`, `write`, and `atomRef` in timers, third-party callbacks, and other code outside Vue's tracked render path. For SSR, render `renderAtomSnapshotScript()` on the server and call `hydrateAtomSnapshotFromDocument()` before mounting on the client.

To align Volar diagnostics with compiler shorthand, configure `@epikodelabs/streamix/vue/editor/tsserver` in `vueCompilerOptions.plugins`. The compiler remains authoritative for output and diagnostics.

## DevTools and loading

`StreamixDevtools` is an opt-in in-app panel. It shows explicit reads and writes as well as subscriptions, updates, and cleanup from the generated bridge refs. For custom tooling, `useStreamixDevtoolsEvents()` exposes the same bounded event trace as a Vue ref.

Vue owns loading boundaries: async setup and `<Suspense>` decide how loading looks, while Streamix provides the reactive values and async flows.
