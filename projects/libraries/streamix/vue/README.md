# `@epikodelabs/streamix/vue`

Vue bindings for [Streamix](https://github.com/epikodelabs/streamix).
Vue owns rendering; Streamix owns reactive state, async iteration, and model
lifecycle.

The adapter uses the same capability vocabulary as the React package, but maps
it to idiomatic Vue primitives:

- `useWritable()` — a writable Vue ref backed directly by Streamix.
- `useIterable()` — a read-only Vue ref for Streamix sources or any `AsyncIterable`.
- `useScope()` — tie a Streamix scope to the current Vue effect scope.

There is intentionally no `useAtom`.

## Install

```bash
npm install @epikodelabs/streamix vue
```

`vue` is an optional peer dependency of the main package and is only required
when this entry point is imported.

## `useWritable(source)`

Use `useWritable` when Vue needs both observation and mutation. It returns a
writable computed ref, so it works with normal Composition API code and
`v-model`.

```vue
<script setup lang="ts">
import { atom } from '@epikodelabs/streamix';
import { useWritable } from '@epikodelabs/streamix/vue';

const counter = atom(0);
const count = useWritable(counter);
</script>

<template>
  <button @click="count++">{{ count }}</button>
</template>
```

For form state:

```vue
<script setup lang="ts">
import { atom } from '@epikodelabs/streamix';
import { useWritable } from '@epikodelabs/streamix/vue';

const nameSource = atom('Ada');
const name = useWritable(nameSource);
</script>

<template>
  <input v-model="name">
</template>
```

The ref does not own a second copy of the value. Its getter reads through the
Streamix-backed `useIterable()` bridge and its setter calls `source.next()`.

## `useIterable(source, initialValue?)`

Use `useIterable` for observation. Streamix atoms, readables, derived values,
and flows expose `.value` plus `subscribe()`, so the returned ref reads the
current Streamix value directly and Vue is only invalidated when the source
emits.

```vue
<script setup lang="ts">
import { atom, derived } from '@epikodelabs/streamix';
import { useIterable } from '@epikodelabs/streamix/vue';

const count = atom(2);
const doubledSource = derived(() => count.value * 2);
const doubled = useIterable(doubledSource);
</script>

<template>
  <strong>{{ doubled }}</strong>
</template>
```

`useIterable` also accepts a plain `AsyncIterable<T>`. Because a plain async
iterable has no synchronous current value, pass an initial value:

```vue
<script setup lang="ts">
import { useIterable } from '@epikodelabs/streamix/vue';

async function* messages() {
  // ...
}

const message = useIterable(messages(), 'Waiting…');
</script>

<template>
  <span>{{ message }}</span>
</template>
```

The iterator is closed when the current Vue effect scope stops.

For component-owned Streamix sources, pass a factory. Disposable sources are
then disposed together with the component/effect scope:

```ts
const online = useIterable(
  () => flow(() => connectionStatus()),
  false,
);
```

Externally-owned sources are unsubscribed but are never disposed by the Vue
adapter.

## `useScope(factory)`

A Streamix scope created in Vue setup can share the component's lifetime:

```vue
<script setup lang="ts">
import { scope } from '@epikodelabs/streamix';
import {
  useIterable,
  useScope,
  useWritable,
} from '@epikodelabs/streamix/vue';

const state = useScope(() => scope({
  count: 0,
  doubled: self => self.count * 2,
}));

const count = useWritable(state.refs.count);
const doubled = useIterable(state.refs.doubled);
</script>

<template>
  <button @click="count++">
    {{ count }} (doubled: {{ doubled }})
  </button>
</template>
```

Vue component setup is already one-shot, so `useScope()` does not need the
memoization/deferred-disposal machinery used by the React adapter.

## Which composable?

| Source / intent | Vue binding |
| --- | --- |
| `Writable<T>` edited by the component | `useWritable(source)` |
| Atom / readable / derived / flow | `useIterable(source)` |
| Plain `AsyncIterable<T>` | `useIterable(source, initialValue)` |
| Component-owned source | `useIterable(() => source, initialValue?)` |
| Component-owned Streamix scope | `useScope(() => scope(...))` |

The split is capability-based: **writable** when Vue needs mutation,
**iterable** when Vue only needs observation.

## Why no Vue-specific `useAtom`?

`Atom` is one concrete Streamix type. The integration boundary is broader:
derived values and flow-backed sources are readable too, and plain async
iterables can participate without first becoming Vue state. Naming the bridge
by capability keeps the adapter aligned with Streamix rather than a specific
source implementation.

## Suspense

This scaffold intentionally does not copy React's `useSuspense()` API. React
Suspense is entered by throwing a promise during render; Vue `<Suspense>` waits
for async component setup/dependencies. The loading boundary therefore belongs
to Vue's async setup layer rather than to a fake React-shaped Streamix hook.
