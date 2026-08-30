<br>

<p align="center">
  <img src="https://raw.githubusercontent.com/epikodelabs/epikodelabs.github.io/refs/heads/main/streamix/LOGO.png" alt="streamix Logo" width="420">
</p>

<p align="center">
  <strong>Reactive flows built on async iterators.</strong><br>
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
    <img src="https://raw.githubusercontent.com/epikodelabs/epikodelabs.github.io/161dea3e83f7bb6c27dcee0e33d615ba91cc5c5b/streamix/bundle-size.svg" alt="Bundle Size">
  </a>
  <a href="https://github.com/epikodelabs/streamix/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg?style=flat-square" alt="License">
  </a>
</p>

---

## ✨ What is streamix?

**streamix** is a lightweight reactive runtime for TypeScript and JavaScript, built around async iterators and pull-based execution.

Most reactive libraries push values at you whether you asked for them or not. streamix turns that around: values are computed when you request them, state reads are synchronous, and every subscription has a clear lifecycle. The result feels closer to ordinary `async/await` than to a stream framework — while keeping the composability of one.

That makes it a good fit for dashboards, interactive applications, and concurrency-heavy browser work: places where you want reactive state, explicit lifecycles, and a mental model you can hold in your head.

### Highlights

* ⚛️ **Atoms and scopes** — reactive state with dependency tracking and real disposal boundaries
* 🔄 **Pull-based flows** — work happens only when downstream consumers ask for values
* 🔁 **Transactions** — group several writes into a single reactive update
* 🧩 **Familiar operators** — `map`, `filter`, `switchMap`, `debounce`, `scan`, and 40+ more
* ⏱️ **Async-iterator first** — everything plays naturally with `for await...of`
* 📦 **Small footprint** — one package, tree-shakeable, `sideEffects: false`

---

## 📦 Installation

```bash
npm install @epikodelabs/streamix
# or
yarn add @epikodelabs/streamix
# or
pnpm add @epikodelabs/streamix
```

---

## 🧠 Core Concepts

### ⚛️ Atoms: state that reads like a variable

An atom is a reactive value. Read it synchronously, write to it, subscribe to it, or consume it as an async iterable — whichever fits the code you're writing.

* `atom(initial)` creates a writable value you can read right away
* `atom<T>()` creates one whose value arrives later
* `derived()` creates a computed value that recalculates when its dependencies change
* `flow()` wraps async work — with cancellation and cleanup built in

`derived()` is synchronous by design. If a computation needs `await`, cancellation, or restart behavior, that's a job for `flow()`.

### 🧭 Scopes: state with a lifecycle

A scope groups related atoms behind plain properties and disposes of everything when you're done. Reading and writing feel like ordinary object access — the reactivity is underneath.

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

console.log(app.doubled); // 10

app.dispose();
```

### 🔄 Flows: sequences through familiar operators

Flows model sequences of values over time — events, timers, requests, generators. Compose them with the operator API you already know:

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

Because flows are pull-based, nothing runs until you iterate — an infinite generator piped through `take(5)` computes exactly five values.

### 🔁 Subscribing and iterating

Atoms are async iterables. Use `iterate()` to consume one as a stream of updates:

```typescript
import { atom, iterate } from '@epikodelabs/streamix';

const a = atom(0);

for await (const value of iterate(a)) {
  console.log(value);
}
```

When several writes should land as one update, wrap them in `transaction()` — subscribers and derived values see a single consistent change.

---

## 📚 Entry Points

Everything ships from one package. A few focused add-ons live alongside the core:

| Entry point | What you get |
| ----------- | ------------ |
| `@epikodelabs/streamix` | Atoms, scopes, flows, operators |
| `@epikodelabs/streamix/aggregates` | `average`, `min`/`max`, `sum`, and friends |
| `@epikodelabs/streamix/dom` | DOM observers — `on('animationFrame')`, `mediaQuery`, `intersection`, … |
| `@epikodelabs/streamix/networking` | HTTP client, WebSocket, JSONP |

---

## 🌍 Ecosystem

Some capabilities live in sibling packages, all compatible with streamix v3:

| Package | Purpose |
|---------|---------|
| `@epikodelabs/coroutines` | Workers, structured task ownership, channels, actors |
| `@epikodelabs/waypoint` | Server-authorized routing for Angular |
| `@epikodelabs/forms` | Reactive form engine for TypeScript |

---

## 📖 Documentation

* [Full documentation](https://epikodelabs.github.io/streamix)
* [Migration guide: v2 → v3](https://epikodelabs.github.io/streamix/MIGRATION)
* [A Generator-Driven, Pull-Based Reactive Core](https://medium.com/p/a1eb9e7ce1d7) — design deep-dive
* [streamix vs redux-saga](https://medium.com/p/0bfc206ad41c) — comparison

---

## 💬 Community

We'd love to hear what you build.

* Give the [public docs repo](https://github.com/epikodelabs/epikodelabs.github.io) a star if streamix helps you
* Join [GitHub Discussions](https://github.com/orgs/epikodelabs/discussions) for questions and ideas
* [Share your feedback](https://forms.gle/CDLvoXZqMMyp4VKu9)

---

## 📜 License

GNU AGPL v3 or later
