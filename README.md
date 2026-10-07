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

## 🧭 About This Repository

This is the **streamix solution repository** — the monorepo where the library is built. It holds the core reactive flows package, its optional add-ons, six demo applications, the documentation sources, and the tooling that ties them together.

A taste of what lives here:

```ts
import { interval, map, pipe, take } from '@epikodelabs/streamix';

const ticks = pipe(interval(1000), map(n => `tick ${n}`), take(5));
for await (const t of ticks) console.log(t);
```

**Just want to use streamix?** You don't need this repo — the library installs from npm:

```bash
npm install @epikodelabs/streamix
```

Start with the **[library README](./projects/libraries/streamix/README.md)** for install and core concepts, or the **[live documentation](https://epikodelabs.github.io/streamix)** for guides and the full API reference.

**Want to contribute, explore the demos, or build from source?** Read on.

---

## 📁 Solution Structure

```
streamix/
├── projects/
│   ├── libraries/
│   │   └── streamix/               # The published package (@epikodelabs/streamix)
│   │       ├── src/                # Atoms, scopes, flows, operators
│   │       ├── aggregates/         # Aggregate operators (average, min/max, …)
│   │       ├── dom/                # DOM observation utilities
│   │       ├── networking/         # HTTP client, WebSocket, JSONP
│   │       ├── angular/            # Angular runtime, compiler, and builder
│   │       │   ├── src/            #   runtime bindings and structural blocks
│   │       │   ├── compiler/       #   template compiler and component installer
│   │       │   ├── builder/        #   Architect builder that runs the compiler
│   │       │   └── benchmarks/     #   browser runner for the compiled path
│   │       ├── react/              # React bindings
│   │       └── vue/                # Vue bindings
│   └── apps/
│       ├── app1/                   # Stream monitor — live operator demos
│       ├── app2/                   # Reactive wizard — scopes + custom renderer
│       ├── app3/                   # Brownian motion — animationFrame + Angular
│       ├── app4/                   # Travel blog — scroll-driven DOM animations
│       ├── app5/                   # HTTP client — networking demos
│       └── app6/                   # Rainbow clicker — compiled Angular templates
├── docs/                           # VitePress documentation source
├── scripts/                        # Build, docs, and packaging automation
├── dist/                           # Build output (library, apps, API docs)
├── README.md                       # ← You are here
└── package.json                    # Workspace scripts & dependencies
```

---

## 🚀 Quick Start for Contributors

You'll need Node.js (LTS recommended) and npm.

```bash
# Install dependencies
npm install

# Build the library
npm run build

# Run the test suite (or `npm run jasmine:coverage` for coverage)
npm test

# Serve a demo app
ng serve app1

# Build the documentation site
npm run docs:build
```

The static site lands in `dist/.vitepress/dist/`.

---

## 📦 Packages in This Solution

| Package | Path | Description |
|---------|------|-------------|
| `@epikodelabs/streamix` | `projects/libraries/streamix/src` | Core reactive flows |
| `@epikodelabs/streamix/aggregates` | `projects/libraries/streamix/aggregates` | Aggregate operators |
| `@epikodelabs/streamix/dom` | `projects/libraries/streamix/dom` | DOM observers |
| `@epikodelabs/streamix/networking` | `projects/libraries/streamix/networking` | HTTP / WebSocket |
| `@epikodelabs/streamix/angular` | `projects/libraries/streamix/angular` | Angular runtime — compiled direct-DOM bindings |
| `@epikodelabs/streamix/angular/compiler` | `projects/libraries/streamix/angular/compiler` | Template compiler and component installer |
| `@epikodelabs/streamix/angular/builder` | `projects/libraries/streamix/angular/builder` | Architect builder that runs the compiler during a build |
| `@epikodelabs/streamix/react` | `projects/libraries/streamix/react` | React bindings |
| `@epikodelabs/streamix/vue` | `projects/libraries/streamix/vue` | Vue bindings |

---

## 🌍 Ecosystem

Some former companion modules now live as separate packages, compatible with streamix v3:

| Package | Purpose |
|---------|---------|
| `@epikodelabs/coroutines` | Workers, structured task ownership, channels, actors |
| `@epikodelabs/waypoint` | Server-authorized routing for Angular |
| `@epikodelabs/forms` | Reactive form engine for TypeScript |

---

## 🛠️ Scripts Reference

| Script | What it does |
|--------|--------------|
| `npm run build` | Build the Angular/library workspace |
| `npm run typecheck` | Type-check the workspace with `tsc --noEmit` |
| `npm run lint` | Lint with ESLint (`lint:fix` to auto-fix) |
| `npm test` | Run the testify test suite |
| `npm run test:node` | Run the server-rendering (SSR) suite in Node |
| `npm run jasmine` | Run tests headlessly in Chrome |
| `npm run pack:check` | Dry-run `npm pack` against the built package |
| `npm run docs:build` | Full docs pipeline (prepare → generate → build) |
| `npm run docs:prepare` | Copy markdown & assets into `dist/` |
| `npm run clean` | Auto-fix ESLint issues |
| `npm run minify` | Minify built bundles (also drops the intermediate `.d.ts` and `lib` trees) |

---

## 💬 Community & Feedback

We'd love to hear what you build.

- ⭐ Star the [public docs repo](https://github.com/epikodelabs/epikodelabs.github.io) if streamix helps you.
- Join [GitHub Discussions](https://github.com/orgs/epikodelabs/discussions).
- [Share feedback](https://forms.gle/CDLvoXZqMMyp4VKu9).

---

## 📜 License

MIT

<p align="center">
  <br>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">📦 Install from NPM</a> &nbsp;•&nbsp;
  <a href="https://github.com/epikodelabs/streamix">🧭 View Source</a> &nbsp;•&nbsp;
  <a href="https://epikodelabs.github.io/streamix">📖 Read Docs</a>
</p>
