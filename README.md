<p align="center">
  <img src="presentation.gif" alt="streamix presentation" width="100%">
</p>

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

## ✨ What is streamix?

**streamix** is a reactive streams library for TypeScript and JavaScript built on top of async generators. It gives you a familiar, RxJS-like operator API while keeping the runtime small and the execution model pull-based—values are computed only when the consumer asks for them.

Whether you are building a dashboard, a CLI tool, or a browser app with heavy background work, streamix normalizes async operations into an iterator-first workflow that is predictable, testable, and memory-friendly.

### Highlights

- 🔄 **Pull-based execution** — values are computed on demand, not pushed
- ⏱️ **Async iterator first** — designed for `for await...of`
- 🧩 **Familiar operators** — `map`, `filter`, `switchMap`, `debounce`, `scan`, and many more
- 🧪 **`query()` for promises** — await the first emitted value and auto-unsubscribe
- 🧵 **Coroutines & actors** — offload heavy work to Web Workers with `compute()`, `compose()`, and `actor()`
- 🌐 **Optional add-ons** — HTTP client, WebSocket helpers, and DOM observation utilities

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

### Stream from a range

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

### React to DOM events

```typescript
import { fromEvent, debounce, filter, switchMap, map, startWith } from '@epikodelabs/streamix';

const jokeStream = fromEvent(searchInput, 'input').pipe(
  map(e => (e.target as HTMLInputElement).value.trim()),
  debounce(400),
  filter(term => term.length > 1),
  switchMap(term =>
    fromPromise(
      fetch(`https://icanhazdadjoke.com/search?term=${encodeURIComponent(term)}`, {
        headers: { Accept: 'application/json' }
      })
        .then(r => r.json())
        .then(data => data.results.slice(0, 5))
        .catch(() => [{ joke: 'No jokes found... that\'s not funny 😢' }])
    )
  ),
  startWith([])
);

for await (const jokes of jokeStream) {
  renderJokes(jokes);
}
```

### Query a single value

```typescript
import { interval, take } from '@epikodelabs/streamix';

const firstTick = await interval(1000).pipe(take(1)).query();
console.log(firstTick); // → 0
```

---

## 🧠 Core Concepts

### Streams

Streams are async generators you can iterate with `for await...of`:

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

### Subjects

Manually control emissions when you need an imperative source:

```typescript
import { createSubject } from '@epikodelabs/streamix';

const chat = createSubject<string>();

for await (const msg of chat) {
  console.log('New message:', msg);
}

chat.next('Hey! 👋');
chat.next('Anyone here?');
chat.complete();
```

### Coroutines

Run heavy work off the main thread with a worker pool:

```typescript
import { compute } from '@epikodelabs/streamix/coroutines';

const primes = compute(async function* () {
  let n = 2;
  while (true) {
    while (!isPrime(n)) n++;
    yield n++;
  }
});

for await (const p of primes.pipe(take(10))) {
  console.log('Prime:', p);
}
```

---

## 📁 Monorepo Structure

```
projects/libraries/streamix/
├── src/           # Core library (streams, operators, subjects)
├── aggregates/    # Aggregate operators (average, min/max, etc.)
├── coroutines/    # Web Worker coroutines and actors
├── dom/           # DOM observation utilities (onResize, etc.)
└── networking/    # HTTP client, WebSocket, JSONP
```

---

## 🚀 What's New?

The coroutine layer is one of the strongest parts of the library right now:

- **`compute()`** — runs heavy work through a reusable worker pool.
- **`compose()`** — fuses coroutine stages into a single worker-side pipeline.
- **`actor()`** — long-lived stateful workers with inbox/outbox messaging and background coordination.

If you are evaluating streamix for browser-side concurrency, start with `@epikodelabs/streamix/coroutines`.

---

## 🎬 Live Demos

- [Simple Animation](https://stackblitz.com/edit/stackblitz-starters-pkzdzmuk)
- [Heavy Computation](https://stackblitz.com/edit/stackblitz-starters-73vspfzz)
- [Travel Blog](https://stackblitz.com/edit/stackblitz-starters-873uh85w)

---

## 📚 Documentation

- [Full Documentation](https://epikodelabs.github.io/streamix)
- [Medium: A Generator-Driven, Pull-Based Reactive Core](https://medium.com/p/a1eb9e7ce1d7)
- [Medium: streamix vs redux-saga](https://medium.com/p/0bfc206ad41c)

---

## 💬 Community

- Give the [public docs repo](https://github.com/epikodelabs/epikodelabs.github.io) a ⭐ if streamix helps you.
- Join [GitHub Discussions](https://github.com/orgs/epikodelabs/discussions) for questions and ideas.
- [Share your feedback](https://forms.gle/CDLvoXZqMMyp4VKu9)

---

## 📜 License

GNU AGPL v3 or later

<p align="center">
  <br>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">📦 Install from NPM</a> &nbsp;•&nbsp;
  <a href="https://github.com/epikodelabs/streamix">🧭 View Source</a> &nbsp;•&nbsp;
  <a href="https://epikodelabs.github.io/streamix">📖 Read Docs</a>
</p>
