# Vue Adoption Layer

`@epikodelabs/streamix/vue` connects Streamix sources to Vue's Composition API and templates without duplicating state.

```vue
<script setup lang="ts">
import { atom, derived } from '@epikodelabs/streamix';
import { useIterable, useWritable } from '@epikodelabs/streamix/vue';

const countSource = atom(0);
const count = useWritable(countSource);
const doubled = useIterable(derived(() => countSource.value * 2));
</script>

<template>
  <button @click="count++">{{ count }} / {{ doubled }}</button>
</template>
```

Use `useWritable()` for sources a component reads and updates, `useIterable()` for read-only sources or async iterables, and `useScope(() => scope(...))` for component-owned related state.

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

See the package [README](../projects/libraries/streamix/vue/README.md) for the Angular-hosted builder setup, DevTools, and detailed lifecycle guidance.
