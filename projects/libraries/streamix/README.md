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

## 🧠 Core Concepts

### ⚛️ Atoms and Scopes

Atoms are the primary reactive primitive in streamix.

* `atom(initial?)` creates a writable reactive value
* `derived()` creates a computed reactive value
* `flow()` creates a flow-backed reactive value

If a value arrives later, omit the initial value from `atom<T>()`.

Async `derived()` callbacks only track atoms read before the first `await`. Use `self.use(...)` or `self.read(...)` up front, or switch to `flow()` for async resources.

Scopes group related atoms under a disposable lifecycle boundary.

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

**🔁 Async iteration with `iterate()`:**

```typescript
import { atom, iterate } from '@epikodelabs/streamix';

const a = atom(0);

for await (const value of iterate(a)) {
  console.log(value);
}
```

**🧱 Writable and initialized atoms:**

| Need | API |
| ---- | --- |
| Value that arrives later | `atom<T>()` |
| Value with an initial state | `atom(initial)` |

---

### 🧵 Coroutines and Actors

Use `coroutine()` when you want a dedicated reusable worker for a task, and `compute()` when you want pooled throughput across many independent jobs.

```typescript
import { coroutine } from '@epikodelabs/streamix/coroutines';

const hashScore = coroutine((text: string) => text.length * 100);

async function main() {
  const score = await hashScore.run('streamix');
  console.log(score); // 800
  await hashScore.dispose();
}

void main();
```

Coroutines support:

* `coroutine()` for a dedicated reusable worker
* `compute()` for pooled, high-throughput worker execution
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
