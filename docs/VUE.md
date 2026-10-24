# Getting started with Streamix and Vue

Streamix adopts declarations in `<script setup>` and exposes them as ordinary
Vue template values. State remains in Streamix; generated Vue bridges provide
the subscriptions and cleanup.

## 1. Install

```sh
npm install @epikodelabs/streamix vue
npm install -D typescript vite @vitejs/plugin-vue
```

The compiler, Vite plugin, Volar integration, and Angular-hosted builder are
subpaths of the same Streamix package. Streamix requires Vue 3.4 or newer and
TypeScript 5.5 or newer.

## 2. Configure Vite

Place Streamix before Vue so the SFC compiler runs first.

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { sxVue } from '@epikodelabs/streamix/vue/vite';

export default defineConfig({ plugins: [sxVue(), vue()] });
```

## 3. Create an atom

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

## 4. Group editable fields in a scope

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

### A rejected binding and its replacement

```vue
<!-- Wrong: form is atom({ name: '' }), not a scope. -->
<input v-model="form.name">
```

For an editable form, model the members as a scope:

```vue
<script setup lang="ts">
const form = scope({ name: '' });
</script>

<template><input v-model="form.name"></template>
```

If the object must remain one atom, replace it from script instead:

```ts
form.next({ ...form.value, name: 'Grace' });
```

## 5. Derive values

```vue
<script setup lang="ts">
import { atom, derived } from '@epikodelabs/streamix';

const count = atom(2);
const doubled = derived(() => count * 2);
const label = derived(() => `${count} clicks`);
</script>

<template>{{ doubled }} — {{ label }}</template>
```

The Vue compiler turns direct atom references inside `derived` callbacks into
tracked value reads, such as `count.value`.

## What the compiler adopts

Interpolation, bindings, `v-text`, `v-html`, supported events, and supported
`v-model` reads use generated bridges. Atoms become writable bridges; derived
values and flows become read-only bridges; each scope field the template uses
gets its own bridge.

The generated bridges subscribe inside the component effect scope, unsubscribe
on unmount, and dispose compiler-owned scopes. Do not manually retain a
generated bridge.

### Generated bridge model

The compiler keeps authored sources intact and adds Vue-facing bridge names:

```ts
// Authored
const count = atom(0);

// Conceptual generated bridge
const __sx_count = useWritable(count);
```

The template reads `__sx_count` internally, while authored script continues to
use the raw `count` atom. Generated names are implementation details; do not
import or reference them directly.

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
// Wrong: no active Vue effect scope, so this throws instead of leaking.
const value = useIterable(messages(), 'Waiting');
```

```ts
const bridge = createIterableBridge(messages(), 'Waiting');
// bridge.ref.value
bridge.dispose();
```

Use `read`, `write`, and `atomRef` in timers, third-party callbacks, dynamic
paths, and other code outside Vue's tracked setup/render path.

### Supported and explicit cases

| Use case | Use |
| --- | --- |
| Template value, event, or supported `v-model` | Raw atom or scope field |
| Derived dependency | `source` inside `derived` |
| Editable object members | A `scope` or explicit whole-object atom update |
| Plain `AsyncIterable` | `useIterable` in setup |
| Outside a Vue effect scope | `createIterableBridge` and `dispose()` |
| Timer, callback, or dynamic path | `read`, `write`, or `atomRef` |

## DevTools

`StreamixDevtools` is an opt-in panel showing reads, subscriptions, writes,
unsubscriptions, and cleanup from the generated bridges:

```vue
<script setup lang="ts">
import { StreamixDevtools } from '@epikodelabs/streamix/vue';
</script>

<template>
  <StreamixDevtools />
</template>
```

It renders only in development builds (`import.meta.env.DEV`); production
bundles stay clean.

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

### Troubleshooting

- A template shows an atom object: ensure `sxVue()` runs before `vue()` and the
  file is a compiled `.vue` SFC.
- `useIterable` throws: call it in `setup()` / `effectScope().run()`, or use a
  manually owned `createIterableBridge`.
- `v-model="form.name"` is rejected: make `name` a scope field or replace the
  complete atom value from script.
- Editor diagnostics differ from a build: restart Volar and trust the SFC
  compiler's output and diagnostics.

## Where to go from here

[Atoms and Scopes](./ATOMS.md) covers the core model the compiler adopts:
derived values, flows, transactions, operators, and the full scope API.
