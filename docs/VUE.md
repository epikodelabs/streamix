# Getting started with Streamix and Vue

Streamix adopts declarations in `<script setup>` and exposes them as ordinary
Vue template values. State remains in Streamix; generated Vue bridges provide
the subscriptions and cleanup.

## 1. Configure Vite

Place Streamix before Vue so the SFC compiler runs first.

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { sxVue } from '@epikodelabs/streamix/vue/vite';

export default defineConfig({ plugins: [sxVue(), vue()] });
```

## 2. Create an atom

Declare Streamix state in `<script setup>`. The template reads the atom as a
value and can use it with `v-model`.

```vue
<script setup lang="ts">
import { atom } from '@epikodelabs/streamix';

const count = atom(0);
</script>

<template>
  <input v-model="count" type="number">
  <button @click="count++">{{ count }}</button>
</template>
```

The compiler emits a `useWritable(count)` bridge. Vue owns the bridge lifetime;
Streamix remains the sole owner of the value and notifications.

## 3. Group editable fields in a scope

Use a scope for related fields. Scope-field reads, assignments, and supported
`v-model` bindings are lowered to Streamix reads and writes.

```vue
<script setup lang="ts">
import { scope } from '@epikodelabs/streamix';

const profile = scope({ name: 'Ada', subscribed: true });
</script>

<template>
  <input v-model="profile.name">
  <label><input v-model="profile.subscribed" type="checkbox"> Subscribe</label>
</template>
```

Do not write `v-model="form.name"` when `form` is an object-valued atom. Vue
would mutate its member without an atom emission, so the compiler rejects it.
Use a scope or replace the whole atom value explicitly in script.

## 4. Derive values

```vue
<script setup lang="ts">
import { atom, derived } from '@epikodelabs/streamix';

const count = atom(2);
const doubled = derived($ => $(count) * 2);
const label = derived($ => `${$(count)} clicks`);
</script>

<template>{{ doubled }} — {{ label }}</template>
```

`$` receives and tracks an atom reference, then returns its current value.
Use `$(count)` in authored examples because it is explicit and works without
framework-specific shorthand. The Vue compiler also supports bare `count` as a
convenience inside recognized `derived` callbacks, lowering it to a value read.
It never rewrites `$(count)` to `$(count.value)`.

## What the compiler adopts

Interpolation, bindings, `v-text`, `v-html`, supported events, and supported
`v-model` reads use generated bridges. Atoms become writable bridges; derived
values and flows become read-only bridges; each scope field the template uses
gets its own bridge.

The generated bridges subscribe inside the component effect scope, unsubscribe
on unmount, and dispose compiler-owned scopes. Do not manually retain a
generated bridge.

## Explicit bridges and boundaries

For code the compiler cannot discover, use the Vue runtime APIs in `setup()` or
an active `effectScope()`:

```ts
const message = useIterable(messages(), 'Waiting');
```

`useIterable`, `useWritable`, and `useScope` throw before allocating anything
outside a Vue effect scope. For intentional manual ownership, use a bridge and
dispose it yourself.

```ts
const bridge = createIterableBridge(messages(), 'Waiting');
// bridge.ref.value
bridge.dispose();
```

Use `read`, `write`, and `atomRef` in timers, third-party callbacks, dynamic
paths, and other code outside Vue's tracked setup/render path.

## SSR, editor, and hosted builds

For SSR, render `renderAtomSnapshotScript()` on the server and call
`hydrateAtomSnapshotFromDocument()` before mounting. Vue controls loading UI
through async setup and `<Suspense>`; Streamix provides values and flows.

Configure `@epikodelabs/streamix/vue/editor/tsserver` in
`vueCompilerOptions.plugins` for Volar-aware shorthand diagnostics. The SFC
compiler remains authoritative.

The Angular-hosted builder transforms `.vue` files into
`.angular/.streamix/<app>/src` before delegating to a Vue-capable Architect
target. Use it when an Angular workspace hosts the Vue application.
