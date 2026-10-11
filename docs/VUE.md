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

Writable atoms become writable Vue refs, derived values and flows become read-only refs, and every declared scope is wrapped so its lifetime is tied to the component. Atom reads inside `derived` callbacks are transpiled as well — write `count`, not `count.value`. Scope members the template touches are bridged individually, `v-model` included. `useWritable()`, `useIterable()`, and `useScope()` are generated internals: the compiler emits those calls and their imports, so there is nothing to import by hand.

## Compiler-first SFCs

Put the Streamix Vite plugin before Vue's plugin to adopt local Streamix declarations from `<script setup>`:

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { sxVue } from '@epikodelabs/streamix/vue/vite';

export default defineConfig({ plugins: [sxVue(), vue()] });
```

Templates can then read local atoms, derived values, flows, and declared scope members as ordinary Vue bindings. For custom pipelines, `transformVueSfc(source, fileName)` returns transformed SFC text, diagnostics, and a version-3 source map.

## Boundaries, SSR, and editor support

Use `read`, `write`, and `atomRef` in timers, third-party callbacks, and other code outside Vue's tracked render path. For SSR, render `renderAtomSnapshotScript()` on the server and call `hydrateAtomSnapshotFromDocument()` before mounting on the client.

To align Volar diagnostics with compiler shorthand, configure `@epikodelabs/streamix/vue/editor/tsserver` in `vueCompilerOptions.plugins`. The compiler remains authoritative for output and diagnostics.
