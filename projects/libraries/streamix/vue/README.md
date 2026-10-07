# Vue Adoption Layer

`@epikodelabs/streamix/vue` lets Vue components use Streamix state through familiar Vue refs.

Vue still renders the interface. Streamix holds state, derived values, and asynchronous work. The adapter makes those sources feel natural in the Composition API and in templates.

## Install

```bash
npm install @epikodelabs/streamix vue
```

## Read and update state

Use `useWritable()` when a Vue component needs to display and change a Streamix value.

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

The returned value behaves like a writable Vue ref, so it also works with `v-model`.

```vue
<script setup lang="ts">
import { atom } from '@epikodelabs/streamix';
import { useWritable } from '@epikodelabs/streamix/vue';

const name = useWritable(atom('Ada'));
</script>

<template>
  <input v-model="name">
</template>
```

The value is not copied into a second store. Vue reads and writes the same Streamix source.

## Read derived values and flows

Use `useIterable()` when a component only needs to observe a Streamix atom, derived value, or flow.

```vue
<script setup lang="ts">
import { atom, derived } from '@epikodelabs/streamix';
import { useIterable } from '@epikodelabs/streamix/vue';

const count = atom(2);
const doubled = useIterable(
  derived(() => count.value * 2),
);
</script>

<template>
  <strong>{{ doubled }}</strong>
</template>
```

`useIterable()` can also read a regular `AsyncIterable`. Give Vue an initial value to show before the first result arrives.

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

## Keep feature state together

Use `useScope()` when a component owns a group of related Streamix state.

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

const count = useWritable(state.get('count'));
const doubled = useIterable(state.get('doubled'));
</script>

<template>
  <button @click="count++">
    {{ count }} (doubled: {{ doubled }})
  </button>
</template>
```

The scope is tied to the component’s lifetime. When the component goes away, its local Streamix work is cleaned up too.

## Which composable should I use?

| When the component needs to… | Use |
| --- | --- |
| Read and update a Streamix value | `useWritable(source)` |
| Read an atom, derived value, or flow | `useIterable(source)` |
| Read a plain async iterable | `useIterable(source, initialValue)` |
| Own related Streamix state for the component lifetime | `useScope(() => scope(...))` |

There is no `useAtom` composable because the useful question is not “is this an atom?” It is: does the component need to **change** this value, or only **observe** it?

## Loading and Suspense

Vue already has its own approach to loading through async setup and `<Suspense>`. Streamix keeps its role smaller: it provides reactive values and async flows; Vue decides how the loading boundary should look.

## The goal

The Vue adapter does not replace Vue’s reactivity or component model. It gives Streamix state a natural Vue surface.

Keep state and asynchronous work in Streamix. Use Vue for components and templates. Let the adapter connect them.
