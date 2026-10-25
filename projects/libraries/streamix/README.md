<p align="center">
  <img src="https://raw.githubusercontent.com/epikodelabs/epikodelabs.github.io/refs/heads/main/streamix/LOGO.png" alt="Streamix" width="420">
</p>

<h3 align="center">Reactive programming without the ceremony.</h3>
<p align="center">
  Atoms for values. Derived state for logic. Flows for time.<br>
  One runtime to keep everything in sync — without turning your app into a plumbing project.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@epikodelabs%2Fstreamix"><img src="https://img.shields.io/npm/v/@epikodelabs%2Fstreamix.svg?style=flat-square&color=0ea5e9" alt="npm version"></a>
  <a href="https://codecov.io/gh/epikodelabs/streamix"><img src="https://codecov.io/gh/epikodelabs/streamix/graph/badge.svg?style=flat-square" alt="coverage"></a>
  <a href="https://discord.gg/XSC9qFn2R"><img src="https://img.shields.io/badge/Discord-Join%20us-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center">
  <a href="https://epikodelabs.github.io/streamix">Documentation</a> ·
  <a href="https://epikodelabs.github.io/streamix/MIGRATION">Migrate from v2</a> ·
  <a href="https://github.com/orgs/epikodelabs/discussions">Discussions</a> ·
  <a href="https://github.com/epikodelabs/streamix/issues">Issues</a>
</p>

> **Project status:** Core development of the current generation is complete. Angular, React, and Vue integrations support atoms and scopes; broader integration testing and real-world feedback are ongoing. Found an edge case? [We'd love a reproduction.](https://github.com/epikodelabs/streamix/issues)

## Why Streamix?

Reactive code should describe **what changes**, not spend half its life explaining **who subscribes to whom**.

Streamix is a lightweight reactive runtime for JavaScript and TypeScript. It combines synchronous state, dependency-tracked calculations, and async-iterator-based flows with explicit ownership and cleanup.

- **Values are atoms.** Read and update state synchronously.
- **Calculations are derived.** Track dependencies instead of manually syncing copies.
- **Time is a flow.** Compose events, timers, and async work with familiar operators.
- **Related things belong in scopes.** Own state, subscriptions, and disposal together.
- **Multiple writes can be one transaction.** Avoid showing observers half-finished updates.
- **Async iteration is native.** Use `for await...of` instead of learning another universe.

**Less orchestration. More consumption.** The runtime handles the wiring; you write the logic.

## Get started

```bash
npm install @epikodelabs/streamix
```

Also available via `pnpm add @epikodelabs/streamix` or `yarn add @epikodelabs/streamix`.

### 1. Start with a scope

A scope looks like an ordinary object, but its members are reactive and share a lifecycle.

```ts
import { scope } from '@epikodelabs/streamix';

const counter = scope<{
  count: number;
  doubled: number;
}>({
  count: 0,
  doubled: self => self.count * 2,
});

counter.count = 5;
console.log(counter.doubled); // 10

counter.subscribeTo('count', value => console.log('Count:', value));
counter.count = 6; // Count: 6

counter.dispose(); // One exit. No subscription archaeology.
```

You work with plain properties. When you need the reactive primitive itself, use `counter.get('count')`; to write through the scope API, use `counter.set('count', 7)`.

Scopes keep their owned atoms active, including flow-backed members, and dispose of their resources together. **Prefer a scope for related state**; a standalone atom is perfect when one value genuinely stands alone.

### 2. Use atoms for standalone values

```ts
import { atom, iterate } from '@epikodelabs/streamix';

const temperature = atom(21);
temperature.set(22);

for await (const value of iterate(temperature)) {
  console.log('Temperature:', value);
}
```

`atom(initial)` has a value immediately; `atom<T>()` can start without one. Subscribers receive the current value when available, then subsequent updates. Use `derived()` for synchronous computations whose dependencies should be tracked automatically.

**Rule of thumb:** If it can be calculated, don't store a second copy of it.

### 3. Let asynchronous work flow

```ts
import { pipe, take } from '@epikodelabs/streamix';

async function* countdown() {
  for (let seconds = 3; seconds > 0; seconds--) {
    yield `T-${seconds}`;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  yield '🚀 Launch!';
}

for await (const message of pipe(countdown(), take(4))) {
  console.log(message);
}
```

Flows compose sequences with operators such as `map`, `filter`, `switchMap`, `debounce`, and `scan` — plus 40+ others. Pull-based iteration means a consumer requests the next value rather than receiving an uncontrolled stream of work.

For computations that need `await`, cancellation, or restart semantics, use a flow rather than an asynchronous `derived()` function. For related writes that must appear together, use `transaction()`.

## Four rules worth remembering

> **1.** If it has a value, make it an atom.  
> **2.** If it can be calculated, don't store it.  
> **3.** If it takes time, let it flow.  
> **4.** Don't chase values — ask for the next one.

There are [14 unofficial rules](https://github.com/epikodelabs/streamix/discussions/36), but don't worry: there's no exam. The remaining principles cover ownership, cancellation, multicasting, and keeping the machinery out of your way.

## Under the hood (without the engine diagram)

| Concept | Responsibility |
| --- | --- |
| **Atom** | Hold and publish a reactive value. |
| **Derived** | Calculate a value from tracked dependencies. |
| **Flow** | Represent values and asynchronous work over time. |
| **Scope** | Group reactive members and own their lifecycle. |
| **Transaction** | Make a set of writes observable as one consistent update. |
| **Operators** | Transform and coordinate sequences. |

Streamix is **async-iterator first** and tree-shakeable. The package marks its optional introspection entry point as side-effectful so bundlers preserve diagnostics activation when it is included. It supports familiar reactive operators without requiring a framework to own your state.

## Use it where you build

Streamix is framework-independent at its core. Angular, React, and Vue integrations bring atoms and scopes into application code; integration testing continues, so check the documentation and report compatibility issues.

The runtime, diagnostics, and framework tooling are separate entry points within the same `@epikodelabs/streamix` npm package. Install the package once and import the parts you need.

| Runtime and tooling entry point | Includes |
| --- | --- |
| `@epikodelabs/streamix` | Atoms, derived state, scopes, flows, operators |
| `@epikodelabs/streamix/aggregates` | Aggregates including `average`, `min`, `max`, and `sum` |
| `@epikodelabs/streamix/dom` | DOM observers, animation frames, media queries, intersections |
| `@epikodelabs/streamix/networking` | HTTP, WebSocket, JSONP |
| `@epikodelabs/streamix/introspection` | Optional runtime diagnostics, execution inspection, and the browser inspector panel |
| `@epikodelabs/streamix/compiler` | Shared introspection transforms and activation injection used by framework toolchains |

Each framework has its own runtime adapter, compiler, builder, and editor integration. React and Vue also provide Vite plugins.

| Framework | Runtime adapter | Compiler | Architect builder | Vite plugin | Editor tooling |
| --- | --- | --- | --- | --- | --- |
| [Angular](angular/README.md) | `/angular` | `/angular/compiler` | `/angular/builder` | — | `/angular/editor` |
| [React](react/README.md) | `/react` | `/react/compiler` | `/react/builder` | `/react/vite` | `/react/editor` |
| [Vue](vue/README.md) | `/vue` | `/vue/compiler` | `/vue/builder` | `/vue/vite` | `/vue/editor` |

All paths in the framework table are relative to `@epikodelabs/streamix`; for example, `@epikodelabs/streamix/react/vite`. The runtime adapters connect Streamix state to each framework's rendering model, while the compiler and build tooling transform application code. Editor tooling supplies framework-specific authoring support.

### Project structure

```text
projects/libraries/streamix/
├── src/                  # Framework-independent reactive runtime
│   └── lib/
│       ├── atoms/        # Reactive state and derived values
│       ├── factories/    # Flow factories
│       ├── operators/    # Flow transformations and coordination
│       ├── primitives/   # Shared reactive primitives
│       ├── runtime/      # Execution, scheduling, and lifecycle machinery
│       └── utils/        # Runtime utilities
├── aggregates/           # Aggregate operators
├── dom/                  # DOM and browser observation utilities
├── networking/           # HTTP, WebSocket, and JSONP
├── introspection/        # Optional diagnostics and inspector panel
├── compiler/             # Shared diagnostics instrumentation
├── angular/              # Angular runtime adapter
│   ├── compiler/         # Template compiler
│   ├── builder/          # Angular Architect integration
│   ├── editor/           # Editor integration
│   └── benchmarks/       # Angular benchmark applications
├── react/                # React runtime adapter
│   ├── compiler/         # JSX/TSX compiler
│   ├── builder/          # Angular Architect integration for React apps
│   ├── vite/             # Vite plugin
│   └── editor/           # Editor integration
└── vue/                  # Vue runtime adapter
    ├── compiler/         # Vue SFC compiler
    ├── builder/          # Angular Architect integration for Vue apps
    ├── vite/             # Vite plugin
    └── editor/           # Editor integration
```

Diagnostics are opt-in: development toolchains can inject introspection activation and mount the inspector, while application code continues to import reactive primitives from the core entry point. See the framework guides for build configuration.

## The extended family

Streamix also works alongside other Epikode Labs packages:

| Package | What it's for |
| --- | --- |
| `@epikodelabs/coroutines` | Workers, structured tasks, channels, and actors |
| `@epikodelabs/waypoint` | Server-authorized routing for Angular |
| `@epikodelabs/forms` | Framework-independent reactive forms |

No need to adopt the whole family. Start with the piece that solves your problem.

## Learn more

- [Full documentation](https://epikodelabs.github.io/streamix)
- [Migration guide: v2 → v3](https://epikodelabs.github.io/streamix/MIGRATION)
- [A Generator-Driven, Pull-Based Reactive Core](https://medium.com/p/a1eb9e7ce1d7) — architecture deep dive
- [Streamix vs. redux-saga](https://medium.com/p/0bfc206ad41c) — comparison
- [Chronicles #19: New Library, New Rules](https://github.com/epikodelabs/streamix/discussions/36) — the philosophy

## Come build with us

Have a question, an operator idea, a bug report, or a spectacularly strange use case? We're interested.

- [Join Discord](https://discord.gg/XSC9qFn2R) for help and project showcases.
- [Start a discussion](https://github.com/orgs/epikodelabs/discussions) to exchange ideas.
- [Open an issue](https://github.com/epikodelabs/streamix/issues) with a reproducible problem.
- [Share feedback](https://forms.gle/CDLvoXZqMMyp4VKu9) or [star the documentation repository](https://github.com/epikodelabs/epikodelabs.github.io).

**Build reactive applications. Not subscription management systems.**

## License

MIT
