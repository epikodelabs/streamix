<br>

<p align="center">
  <img src="https://epikodelabs.github.io/streamix/LOGO.png" alt="streamix Logo" width="420">
</p>

<p align="center">
  <strong>Reactive streams built on async generators.</strong><br>
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

## 🎉 Project Status: Milestone Reached

streamix v2 has reached a stable and complete milestone. This release represents the final planned version of the project.

While no further development or active maintenance is currently planned, we are proud of what streamix has become and grateful to everyone who used, contributed to, or supported it along the way.

Thank you for being part of the journey.

---

## ✨ What is streamix?

**streamix** is a reactive runtime for TypeScript and JavaScript that unifies reactive state, lifecycle management, asynchronous workflows, and browser-side concurrency under a single async-iterable execution model.

Built on top of async generators, streamix combines:

* ⚛️ **Atoms** for reactive state
* 🌳 **Scopes** for lifecycle management
* 🧵 **Coroutines** for background computation
* 🎭 **Actors** for isolated stateful workers
* 🔄 **Streams** for asynchronous composition

Whether you are building a dashboard, CLI tool, browser application, or computation-heavy workflow, streamix provides a consistent model for managing values, events, state, and concurrency.

### Highlights

* 🧵 **Coroutines & Actors** — browser-side concurrency powered by Web Workers
* 🔄 **Pull-based Streams** — values are computed only when consumers request them
* 🧩 **Familiar Operators** — `map`, `filter`, `switchMap`, `debounce`, `scan`, and many more
* ⏱️ **Async Iterator First** — designed around `for await...of`
* 🧪 **`query()` for promises** — await the next emitted value with automatic cleanup
* 🌐 **Optional add-ons** — HTTP client, WebSocket helpers, and DOM observation utilities

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

### Stream Processing

```typescript
import { range, map, filter, take } from '@epikodelabs/streamix';

const potionRecipe = range(1, 20).pipe(
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

---

## 🧠 Core Concepts

### ⚛️ Atoms & Scopes

Atoms are the primary reactive primitive in streamix.

* `atom()` — writable reactive value
* `asyncAtom()` — hot reactive value without initial state
* `derived()` — computed reactive value
* `flow()` — stream-backed reactive value

Scopes provide lifecycle management and automatic disposal.

```typescript
import { atom, asyncAtom, derived, scope } from '@epikodelabs/streamix';

const count = atom(0);
const events = asyncAtom<string>();

const doubled = derived(() => count.value * 2);

const app = scope(() => ({
  count,
  events,
  doubled
}));

count.set(5);
events.set('hello');

console.log(app.doubled.value);

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

**Migration from Subjects to Atoms:**

| Subject                          | Atom Equivalent           |
| -------------------------------- | ------------------------- |
| `createSubject()`                | `asyncAtom()`             |
| `createBehaviorSubject(initial)` | `atom(initial)`           |
| `createReplaySubject(capacity)`  | `asyncAtom({ capacity })` |

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

* `compute()` — worker-backed async generators
* `compose()` — worker-side pipeline fusion
* `actor()` — long-lived stateful workers

Actors provide isolated state, inbox/outbox messaging, and background coordination.

---

### 🔄 Streams

Streams are async generators that compose naturally through operators.

```typescript
import { createStream } from '@epikodelabs/streamix';

async function* countdown() {
  for (let i = 10; i > 0; i--) {
    yield `T-${i}...`;
    await new Promise(r => setTimeout(r, 500));
  }

  yield '🚀 Launch!';
}

const launchStream = createStream('countdown', countdown);

for await (const msg of launchStream) {
  console.log(msg);
}
```

Streams are pull-based by default, meaning work is performed only when values are consumed.

---

### Legacy Subjects

Subjects remain available for backward compatibility.

```typescript
import { createSubject } from '@epikodelabs/streamix';

const chat = createSubject<string>();
```

New applications should generally prefer Atoms.

---

## 📁 Monorepo Structure

```text
projects/libraries/streamix/
├── src/           # Core runtime (atoms, streams, scopes, operators)
├── aggregates/    # Aggregate operators
├── coroutines/    # Coroutines and actors
├── dom/           # DOM observation utilities
└── networking/    # HTTP client, WebSocket, JSONP
```

---

## 🚀 What's New?

### v2.0.47 — Atoms Evolution

The atoms API is now a complete replacement for imperative Subjects:

* **`asyncAtom()`** — hot atom without initial value
* **`asyncAtom({ capacity: n })`** — replay last `n` values
* **`iterate(atom)`** — convert any atom to async iterable

Subjects remain available for compatibility but are now considered legacy.

### Coroutines

The coroutine layer is one of the strongest parts of the library:

* **`compute()`** — reusable worker-pool execution
* **`compose()`** — worker-side pipeline fusion
* **`actor()`** — long-lived stateful workers

If you are evaluating streamix for browser-side concurrency, start with `@epikodelabs/streamix/coroutines`.

---

## 🎬 Live Demos

* [Simple Animation](https://stackblitz.com/edit/stackblitz-starters-pkzdzmuk)
* [Heavy Computation](https://stackblitz.com/edit/stackblitz-starters-73vspfzz)
* [Travel Blog](https://stackblitz.com/edit/stackblitz-starters-873uh85w)

---

## 📚 Documentation

* [Full Documentation](https://epikodelabs.github.io/streamix)
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
