<p align="center">
  <img src="https://epikodelabs.github.io/streamix/LOGO.png" alt="streamix Logo" width="500">
</p>

<div
  align="center"
  style="display:flex; justify-content:center; gap:0.5rem; flex-wrap:wrap;"
>
  <a href="https://www.npmjs.com/package/@epikodelabs%2Fstreamix">
    <img src="https://img.shields.io/npm/v/@epikodelabs%2Fstreamix.svg?style=flat-square" alt="NPM Version">
  </a>
  <a href="https://www.npmjs.com/package/@epikodelabs%2Fstreamix">
    <img src="https://img.shields.io/npm/dt/@epikodelabs%2Fstreamix.svg?style=flat-square" alt="Total Downloads">
  </a>
  <a href="https://github.com/epikodelabs/streamix">
    <img src="https://epikodelabs.github.io/streamix/bundle-size.svg" alt="Bundle Size">
  </a>
</div>

## ⭐ Star the Public Docs Repo

If streamix helps you, please give the public docs/site repo a star so we know this work matters to developers:
https://github.com/epikodelabs/epikodelabs.github.io

💬 Join GitHub Discussions: https://github.com/orgs/epikodelabs/discussions

## 🚀 What's new?

The coroutine layer is one of the strongest parts of the library right now:

- `compute()` runs heavy work through a reusable worker pool for better throughput.
- `compose()` lets you fuse coroutine stages into one worker-side pipeline instead of bouncing values across the main thread.
- `actor()` gives you long-lived stateful workers with inbox/outbox messaging, requests, and background coordination utilities.

If you are evaluating streamix for browser-side concurrency, start here:

- `@epikodelabs/streamix/coroutines`
- `Heavy Computation` already on Stackblitz
- `Actor-based game` coming soon via Discussions

## 📦 Installation

```bash
# npm
npm install @epikodelabs/streamix
```
## 📁 Monorepo Structure

```
projects/libraries/streamix/
├── src/                        # Core library (abstractions, operators/streams)
├── aggregates/                 # Aggregate operators (average, min/max, etc.)
├── coroutines/                 # Coroutines and actors
├── dom/                        # DOM observation utilities (onResize, etc.)
└── networking/                 # HTTP client, WebSocket, JSONP
```

## 👋 Farewell

Thank you for taking the time to explore streamix. Whether you are here to experiment, contribute, or build something production-ready, we appreciate your interest and hope the library serves you well. Happy streaming!
