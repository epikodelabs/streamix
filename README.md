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


<br>

<p align="center">
  <img src="https://epikodelabs.github.io/streamix/presentation.gif" alt="streamix presentation" width="100%">
</p>

---

## 🧭 About This Repository

This is the **streamix solution repository** — a monorepo that contains the core reactive flows library, optional add-on modules, demo applications, documentation sources, and build tooling.

If you are looking for the library documentation and API reference, see:
- **[Library README](./projects/libraries/streamix/README.md)** — package-level install and usage
- **[Live Documentation](https://epikodelabs.github.io/streamix)** — full docs site

---

## 📁 Solution Structure

```
streamix/
├── projects/
│   ├── libraries/
│   │   └── streamix/           # Core npm package (@epikodelabs/streamix)
│   │       ├── src/            # Flows, atoms, scopes, operators
│   │       ├── aggregates/     # Aggregate operators (average, min/max, etc.)
│   │       ├── dom/            # DOM observation utilities
│   │       ├── networking/     # HTTP client, WebSocket, JSONP
│   │       └── presentation.gif
│   └── apps/
│       ├── app1, app3, app4, app5, app9, app10, app11
│       │                       # Demo & test applications
├── docs/                       # VitePress documentation source
├── scripts/                    # Build, SEO, and docs automation
├── dist/                       # Build output & VitePress site
├── README.md                   # ← You are here
└── package.json                # Workspace scripts & dependencies
```

---

## 🚀 Quick Start for Contributors

### Prerequisites

- Node.js (LTS recommended)
- npm or pnpm

### Install dependencies

```bash
npm install
```

### Build the library

```bash
npm run build
```

### Run tests

```bash
npm test
# or with coverage
npm run jasmine:coverage
```

### Serve a demo app

```bash
ng serve app1
```

### Build documentation

```bash
npm run docs:build
```

The static site is output to `dist/.vitepress/dist/`.

---

## 📦 Packages in This Solution

| Package | Path | Description |
|---------|------|-------------|
| `@epikodelabs/streamix` | `projects/libraries/streamix/src` | Core reactive flows |
| `@epikodelabs/streamix/aggregates` | `projects/libraries/streamix/aggregates` | Aggregate operators |
| `@epikodelabs/streamix/dom` | `projects/libraries/streamix/dom` | DOM observers |
| `@epikodelabs/streamix/networking` | `projects/libraries/streamix/networking` | HTTP / WebSocket |

---

## 🛠️ Scripts Reference

| Script | What it does |
|--------|--------------|
| `npm run build` | Build the Angular/library workspace |
| `npm test` | Run the testify test suite |
| `npm run jasmine` | Run tests headlessly in Chrome |
| `npm run docs:build` | Full docs pipeline (prepare → generate → build) |
| `npm run docs:prepare` | Copy markdown & assets into `dist/` |
| `npm run clean` | Auto-fix ESLint issues |
| `npm run minify` | Minify bundles & regenerate types |

---

## 💬 Community & Feedback

- ⭐ Star the [public docs repo](https://github.com/epikodelabs/epikodelabs.github.io) if streamix helps you.
- Join [GitHub Discussions](https://github.com/orgs/epikodelabs/discussions).
- [Share feedback](https://forms.gle/CDLvoXZqMMyp4VKu9).

---

## 📜 License

GNU AGPL v3 or later

<p align="center">
  <br>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">📦 Install from NPM</a> &nbsp;•&nbsp;
  <a href="https://github.com/epikodelabs/streamix">🧭 View Source</a> &nbsp;•&nbsp;
  <a href="https://epikodelabs.github.io/streamix">📖 Read Docs</a>
</p>
