# Presentation

A visual introduction to streamix — the reactive flows library built on async generators.

<p align="center">
  <img src="https://epikodelabs.github.io/streamix/presentation.gif" alt="streamix presentation" width="100%">
</p>

---

## What you are seeing

streamix pipelines are **pull-based**. The consumer asks for the next value, and only then is it produced. This gives you natural backpressure, bounded memory, and a `for await...of`-first API.

---

## The core idea

Most reactive libraries push values eagerly. streamix does the opposite:

| Push-based | Pull-based |
|------------|------------|
| Producer runs on its own schedule | Producer waits for the consumer |
| Needs buffers and backpressure strategies | Backpressure is built in |
| Harder to reason about memory | Memory use is predictable |

---

## What's covered

- **[Introduction](/)** — core concepts, operators, factories, and custom operators
- **[Atoms](/ATOMS)** — reactive state primitives
- **[Coroutines](/COROUTINES)** — Web Worker task runners and pipelines
- **[Actors](/ACTORS)** — long-lived stateful workers with messaging
- **[Generators](/GENERATORS)** — iterator protocol and async iteration
- **[Angular](/ANGULAR)** and **[React](/REACT)** integrations

---

## Get started

```bash
npm install @epikodelabs/streamix
```

Visit the [Introduction](/) for the full tour and API links.
