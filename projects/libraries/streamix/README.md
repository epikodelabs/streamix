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

**streamix** is a lightweight reactive runtime for TypeScript and JavaScript built around async generators and pull-based execution.

It is a strong fit for dashboards, interactive applications, and concurrency-heavy browser workloads where you want reactive state, explicit lifecycles, and a more direct mental model than traditional push-only stream systems.

### Highlights

* ⚛️ **Atoms and Scopes** for reactive state, dependency tracking, and disposal boundaries
* 🧵 **Coroutines and Actors** for browser-side concurrency built on Web Workers
* 🔄 **Pull-based flows** where work happens when downstream consumers ask for values
* 🧩 **Familiar operators** such as `map`, `filter`, `switchMap`, `debounce`, and `scan`
* ⏱️ **Async-iterator first design** that works naturally with `for await...of`
* 🌐 **Optional add-ons** for HTTP, WebSocket, and DOM-focused helpers

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
const total = derived(async (self) => {
  const [priceAtom, taxAtom] = self.use(price, tax);
  await loadRates();
  return priceAtom.value + taxAtom.value;
});
```

If the computation is primarily async or needs cancellation and restart semantics, prefer `flow()`.

### Scope-Based Lifecycle

```typescript
import { method, scope } from '@epikodelabs/streamix';

const app = scope<{
  count: number;
  doubled: number;
  increment: () => void;
}>({
  count: 0,
  doubled: (self) => self.count * 2,
  increment: method((self) => {
    self.count += 1;
  }),
});

app.increment();

console.log(app.count);   // 1
console.log(app.doubled); // 2

app.dispose();
```

Scopes are where individual atoms become a coherent state model. They let you group writable state, derived values, imperative methods, and cleanup under one lifecycle boundary, then dispose the whole graph when the feature or component goes away.

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
    rarity: i % 3 === 0 ? 'legendary' : 'common',
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

### ⚛️ Atoms and Scopes

Atoms are the primary reactive primitive in streamix.

* `atom(initial?)` creates a writable reactive value
* `derived()` creates a computed reactive value
* `flow()` creates a flow-backed reactive value

If a value arrives later, omit the initial value from `atom<T>()`.

Async `derived()` callbacks only track atoms read before the first `await`. Use `self.use(...)` or `self.read(...)` up front, or switch to `flow()` for async resources.

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

### 🧵 Coroutines and Actors

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

* `compute()` for worker-backed async generators
* `compose()` for worker-side pipeline fusion
* `actor()` for long-lived stateful workers

Actors provide isolated state, inbox and outbox messaging, and background coordination.

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

Flows are pull-based by default, which means work is performed only when values are consumed.

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

## 📚 Documentation

* [Full Documentation](https://epikodelabs.github.io/streamix)
* [Migration Guide: v2 to v3](./MIGRATION)
* [Medium: A Generator-Driven, Pull-Based Reactive Core](https://medium.com/p/a1eb9e7ce1d7)
* [Medium: streamix vs redux-saga](https://medium.com/p/0bfc206ad41c)

---

## 💬 Community

* Give the [public docs repo](https://github.com/epikodelabs/epikodelabs.github.io) a star if streamix helps you
* Join [GitHub Discussions](https://github.com/orgs/epikodelabs/discussions) for questions and ideas
* [Share your feedback](https://forms.gle/CDLvoXZqMMyp4VKu9)

---

## 📜 License

GNU AGPL v3 or later
