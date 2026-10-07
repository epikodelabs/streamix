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
    <img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License">
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

## 📏 The Rules

Fourteen unofficial guidelines shape everything below — the full write-up lives in
[Chronicles #19 · New Library, New Rules](https://github.com/epikodelabs/streamix/discussions/36).

1. If it has a value, make it an atom.
2. If it can be calculated, don't store it — use `derived`.
3. If it takes time, let it flow.
4. Don't chase values — `for await` the next one.
5. When nobody is listening, go home.
6. If it belongs together, scope it together.
7. Don't recompute everything on every rapid change.
8. Cancellation should be trivial — abandoning the iterator stops production.
9. Abstractions should disappear with familiarity.
10. Less machinery. Fewer surprises. Nothing to prove.
11. A subscriber receives the current value right away — the atom already knows something.
12. A scope keeps its atoms awake — you still close the door.
13. A pipe produces an atom too.
14. Atoms multicast: one sequence, many listeners.

**Start with a scope, not a bare atom.** A lone atom is the exception — one
detached value with no owner. The moment a few pieces belong together, a scope
is the better home: it groups them behind plain properties, keeps their atoms
awake, derives what can be derived, owns the cleanup, and disposes in one call.
If you find yourself holding several loose atoms and wiring their lifecycles by
hand, that is a scope.

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

**Every atom emits its current value on subscription when it has one. Flows included.**

An atom is the right tool for a value — but a *bare* atom is a value with no
owner: you wire its lifecycle, its cleanup, and its relationships yourself.
Prefer a [scope](#-scopes-state-with-a-lifecycle) and reach for a lone atom only
when one value genuinely stands alone.

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

// Scope properties stay value-first. Reach for the atom behind one only when
// you need the reactive object itself.
app.get('count').set(6);
app.subscribeTo('count', value => console.log(value));

console.log(app.count); // 6

app.dispose();
```

`app.get('count')` returns the backing atom and `app.set('count', value)`
writes through it; `subscribeTo(key, callback)` observes a member.

A scope keeps the atoms it owns **awake**: it watches them from the moment they
are created, so a `flow`-backed member starts producing as soon as the scope
exists — you read `app.events` and it is current, without wiring a subscription
— and `dispose()` stops it. Nested scopes inherit the same guarantee, and atoms
handed to the scope from outside are watched through the same path.

**This is why scopes are the default.** They are the unit that owns state: the
atoms stay awake, derived members track them, the cleanup runs once, and the
whole thing reads as one object. A collection of bare atoms has to be given all
of that by hand.

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
| `@epikodelabs/streamix/angular` | Angular runtime, compiler, and Architect builder for compiled direct-DOM templates |

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

MIT