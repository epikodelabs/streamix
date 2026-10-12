# Vue Adoption Layer

`@epikodelabs/streamix/vue` lets Vue components use Streamix state through familiar Vue refs.

Vue still renders the interface. Streamix holds state, derived values, and asynchronous work. The adapter makes those sources feel natural in the Composition API and in templates.

## Install

```bash
npm install @epikodelabs/streamix vue
```

## Declare state, use it in templates

Put the Streamix Vite plugin before Vue's plugin:

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { sxVue } from '@epikodelabs/streamix/vue/vite';

export default defineConfig({
  plugins: [sxVue(), vue()],
});
```

Then declare Streamix state in `<script setup>` and use it as ordinary Vue state in the template. You never request composables yourself — the compiler generates the bridges and their imports:

```vue
<script setup lang="ts">
import { atom, derived, scope } from '@epikodelabs/streamix';

const count = atom(0);
const doubled = derived($ => $(count) * 2);
const profile = scope({ name: 'Ada' });
</script>

<template>
  <button @click="count++">{{ count }} / {{ doubled }}</button>
  <input v-model="profile.name">
</template>
```

Atom reads inside `derived` callbacks are transpiled as well — write `count`, not `count.value`.

The value is not copied into a second store. Vue reads and writes the same Streamix source.

## What the compiler generates

Every local Streamix declaration is adopted automatically:

| Declared in `<script setup>` | Generated bridge |
| --- | --- |
| `atom(...)` the template reads and updates | `useWritable(source)` — a writable ref that works with `v-model` |
| `derived(...)` or `flow(...)` | `useIterable(source)` — a read-only ref |
| `scope({ ... })` | `useScope(() => scope({ ... }))` — the scope is disposed with the component, so its local Streamix work is cleaned up on unmount |
| Scope members the template touches | `useIterable(scope.get('member'))` per member, with writes and `v-model` lowered to `scope.set(...)` |

`useWritable()`, `useIterable()`, and `useScope()` are generated internals: the compiler emits those calls and their imports, and Vue's setup auto-unwrap makes the templates read and write them as ordinary state. Call them by hand only in code the compiler cannot reach — for example, a plain `AsyncIterable` is not a Streamix declaration, so give it an initial value yourself:

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

`useWritable()`, `useIterable()`, and `useScope()` require component `setup()`
or an active Vue `effectScope()`. They throw before creating a subscription or
owned scope otherwise. For manual non-Vue ownership, use
`createIterableBridge(source)`, read `bridge.ref`, and call `bridge.dispose()`
when the owner ends. There is no `useAtom` composable because the useful
question is not "is this an atom?"

## Custom pipelines

Use `@epikodelabs/streamix/vue/compiler` when integrating the transform into a
non-Vite build. It exports `transformVueSfc(source, fileName)` and returns the
transformed source, source-positioned diagnostics, and a version-3 source map.
Vite composes this source map with Vue's output maps. Authored text remains
mapped to its original SFC coordinates; injected bridge declarations are
intentionally unmapped.

### Angular-hosted or custom Architect builds

The optional builder mirrors your authored source tree to
`.angular/.streamix/<app>/src`, transforms every `.vue` file there, and then
delegates to a Vue-capable Architect target. It does not try to replace Vue's
bundler — use the target that already owns your Vue/Vite build.

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

Point that delegated target at `.angular/.streamix/my-vue-app/src`. For a
serve target, the builder watches the authored tree and keeps the virtual copy
in sync.

## Explicit runtime boundaries

For code outside Vue's tracked render path—timers, callbacks, or third-party
components—make the Streamix operation explicit:

```ts
import { atom } from '@epikodelabs/streamix';
import { atomRef, read, write } from '@epikodelabs/streamix/vue';

const status = atom('Saved');

setTimeout(() => console.log(read(status)));
write(status, 'Updated');
sendToThirdPartyComponent(atomRef(status));
```

For server rendering, render `renderAtomSnapshotScript()` beside the Vue app
and call `hydrateAtomSnapshotFromDocument()` before client mounting. This
transfers named Streamix values without creating a second client store.

## Loading and Suspense

Vue already has its own approach to loading through async setup and `<Suspense>`. Streamix keeps its role smaller: it provides reactive values and async flows; Vue decides how the loading boundary should look.

## Tooling

`StreamixDevtools` is an opt-in in-app panel. It shows explicit reads and
writes as well as subscriptions, updates, and cleanup from Vue bridge refs.
For custom tooling, `useStreamixDevtoolsEvents()` exposes the same bounded
event trace as a Vue ref.

### Editor diagnostics

For Vue Language Tools / Volar diagnostics that match the compiler's derived
shorthand, add `@epikodelabs/streamix/vue/editor/tsserver` to
`vueCompilerOptions.plugins`. See its bundled README for the exact tsconfig
snippet. The plugin uses the official Vue Language Tools `compileSFCScript(lang,
script)` hook (language first), and returns the API-compatible plugin version 2.1.

## The goal

The Vue adapter does not replace Vue’s reactivity or component model. It gives Streamix state a natural Vue surface.

Keep state and asynchronous work in Streamix. Use Vue for components and templates. Let the adapter connect them.
