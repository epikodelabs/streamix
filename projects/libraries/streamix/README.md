<br>

<p align="center">
  <img src="https://epikodelabs.github.io/streamix/LOGO.png" alt="streamix Logo" width="420">
</p>

<p align="center">
  <strong>Reactive flows built on async generators.</strong><br>
  Small bundle. Pull-based execution. Familiar operator API.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@epikodelabs%2Fstreamix">
    <img src="https://img.shields.io/npm/v/@epikodelabs%2Fstreamix.svg?style=flat-square&color=0ea5e9" alt="NPM Version">
  </a>
  <a href="https://www.npmjs.com/package/@epikodelabs%2Fstreamix">
    <img src="https://img.shields.io/npm/dt/@epikodelabs%2Fstreamix.svg?style=flat-square&color=0ea5e9" alt="Total Downloads">
  </a>
  <a href="https://github.com/epikodelabs/streamix">
    <img src="https://epikodelabs.github.io/streamix/bundle-size.svg?style=flat-square" alt="Bundle Size">
  </a>
  <a href="https://github.com/epikodelabs/streamix/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg?style=flat-square" alt="License">
  </a>
</p>

---

## ✨ What is streamix?

**streamix** is a reactive runtime for TypeScript and JavaScript that unifies reactive state, lifecycle management, asynchronous workflows, and browser-side concurrency under a single async-iterable execution model.

Built on top of async generators, streamix combines:

* ⚛️ **Atoms** for reactive state
* 🌳 **Scopes** for lifecycle management
* 🧵 **Coroutines** for background computation
* 🎭 **Actors** for isolated stateful workers
* 🔄 **Flows** for asynchronous composition

Whether you are building a dashboard, CLI tool, browser application, or computation-heavy workflow, streamix provides a consistent model for managing values, events, state, and concurrency.

### Highlights

* ⚛️ **Atoms & Scopes** - reactive state with automatic dependency tracking and lifecycle management
* 🧵 **Coroutines & Actors** - browser-side concurrency powered by Web Workers
* 🔄 **Pull-based flows** - values are computed only when consumers request them
* 🧩 **Familiar Operators** - `map`, `filter`, `switchMap`, `debounce`, `scan`, and many more
* ⏱️ **Async Iterator First** - designed around `for await...of`
* 🧪 **`query()` for promises** - await the next emitted value with automatic cleanup
* 🌐 **Optional add-ons** - HTTP client, WebSocket helpers, and DOM observation utilities

---

## 📦 Installation

```bash
npm install @epikodelabs/streamix
```

```bash
yarn add @epikodelabs/streamix
```

```bash
pnpm add @epikodelabs/streamix
```

---

## ⚡ Quick Start

### Reactive State with Atoms

```typescript
import { atom, derived } from '@epikodelabs/streamix';

const count = atom(0);

const doubled = derived(() => count.value * 2);

count.set(5);

console.log(doubled.value); // 10
```

For async computed values, capture dependencies before the first `await`:

```typescript
const total = derived(async ($) => {
  const price = $.use(priceAtom);
  const tax = $.use(taxAtom);
  await loadRates();
  return price.value + tax.value;
});
```

If the computation is primarily async or needs cancellation/restart semantics, prefer `flow()`.

### Scope-Based Lifecycle

```typescript
import { scope } from '@epikodelabs/streamix';

const app = scope<{ count: number }>({
  count: 0,
});

app.count = 10;

app.dispose();
```

### Browser-Side Concurrency

```typescript
import { compute } from '@epikodelabs/streamix/coroutines';

const primes = compute(async function* () {
  let n = 2;

  while (true) {
    while (!isPrime(n)) n++;
    yield n++;
  }
});
```

### Flow Processing

```typescript
import { range, map, filter, take, pipe } from '@epikodelabs/streamix';

const potionRecipe = pipe(
  range(1, 20),
  map(i => ({
    name: ['Dragon Scale', 'Phoenix Tear', 'Unicorn Hair', 'Mermaid Kelp'][i % 4],
    power: i * 10,
    rarity: i % 3 === 0 ? 'legendary' : 'common'
  })),
  filter(item => item.rarity === 'legendary'),
  map(item => `✨ ${item.name} (${item.power} power)`),
  take(5)
);

for await (const ingredient of potionRecipe) {
  console.log('Adding to cauldron:', ingredient);
}
```

---

## 🧠 Core Concepts

### ⚛️ Atoms & Scopes

Atoms are the primary reactive primitive in streamix.

* `atom(initial?)` - writable reactive value; omit the initial value when it arrives later
* `derived()` - computed reactive value
* `flow()` - flow-backed reactive value

Async `derived()` callbacks only track atoms read before the first `await`. Use `self.use(...)` / `self.read(...)` up front, or switch to `flow()` for async resources.

Scopes provide lifecycle management and automatic disposal.

```typescript
import { scope } from '@epikodelabs/streamix';

const app = scope<{
  count: number;
  events: string;
  doubled: number;
}>({
  count: 0,
  events: '',
  doubled: (self) => self.count * 2,
});

app.count = 5;
app.events = 'hello';

console.log(app.doubled);

app.dispose();
```

**Async iteration with `iterate()`:**

```typescript
import { atom, iterate } from '@epikodelabs/streamix';

const a = atom(0);

for await (const value of iterate(a)) {
  console.log(value);
}
```

**Writable and initialized atoms:**

| Need | API |
| ---- | --- |
| Value that arrives later | `atom<T>()` |
| Value with an initial state | `atom(initial)` |

---

### 🧵 Coroutines & Actors

Run computations away from the main thread using a worker pool.

```typescript
import { compute } from '@epikodelabs/streamix/coroutines';

const primes = compute(async function* () {
  let n = 2;

  while (true) {
    while (!isPrime(n)) n++;
    yield n++;
  }
});
```

Coroutines support:

* `compute()` - worker-backed async generators
* `compose()` - worker-side pipeline fusion
* `actor()` - long-lived stateful workers

Actors provide isolated state, inbox/outbox messaging, and background coordination.

---

### 🔄 Flows

Flows compose naturally through operators.

```typescript
import { pipe, take } from '@epikodelabs/streamix';

async function* countdown() {
  for (let i = 10; i > 0; i--) {
    yield `T-${i}...`;
    await new Promise(r => setTimeout(r, 500));
  }

  yield '🚀 Launch!';
}

const launchSequence = pipe(countdown(), take(11));

for await (const msg of launchSequence) {
  console.log(msg);
}
```

Flows are pull-based by default, meaning work is performed only when values are consumed.

---

## 📁 Monorepo Structure

```text
projects/libraries/streamix/
|-- src/           # Core runtime (atoms, scopes, operators)
|-- aggregates/    # Aggregate operators
|-- coroutines/    # Coroutines and actors
|-- dom/           # DOM observation utilities
`-- networking/    # HTTP client, WebSocket, JSONP
```

---

## 🚀 What's New?

### v2.0.47 - Atoms Evolution

The atoms API is the primary state primitive:

* **`atom()`** - hot atom without initial value
* **`iterate(atom)`** - convert any atom to async iterable

### Coroutines

The coroutine layer is one of the strongest parts of the library:

* **`compute()`** - reusable worker-pool execution
* **`compose()`** - worker-side pipeline fusion
* **`actor()`** - long-lived stateful workers

If you are evaluating streamix for browser-side concurrency, start with `@epikodelabs/streamix/coroutines`.

---

## 🎬 Live Demos

* [Simple Animation](https://stackblitz.com/edit/stackblitz-starters-pkzdzmuk)
* [Heavy Computation](https://stackblitz.com/edit/stackblitz-starters-73vspfzz)
* [Travel Blog](https://stackblitz.com/edit/stackblitz-starters-873uh85w)

---

## 📚 Documentation

* [Full Documentation](https://epikodelabs.github.io/streamix)
* [Migration Guide: v2 to v3](./MIGRATION.md)
* [Medium: A Generator-Driven, Pull-Based Reactive Core](https://medium.com/p/a1eb9e7ce1d7)
* [Medium: streamix vs redux-saga](https://medium.com/p/0bfc206ad41c)

---

## 💬 Community

* Give the [public docs repo](https://github.com/epikodelabs/epikodelabs.github.io) a ⭐ if streamix helps you.
* Join [GitHub Discussions](https://github.com/orgs/epikodelabs/discussions) for questions and ideas.
* [Share your feedback](https://forms.gle/CDLvoXZqMMyp4VKu9)

---

## 📜 License

GNU AGPL v3 or later
