# Streamix

Composable operator pipelines for async generators with the gentle pull-based semantics you already rely on. See the [generators doc](https://epikodelabs.github.io/streamix/GENERATORS) for details.

[![npm version](https://img.shields.io/npm/v/@epikodelabs/streamix.svg?style=flat-square)](https://www.npmjs.com/package/@epikodelabs/streamix) [![Bundle size](https://img.shields.io/bundlephobia/minzip/@epikodelabs/streamix?style=flat-square)](https://bundlephobia.com/package/@epikodelabs/streamix)

```bash
npm install @epikodelabs/streamix
```

## Package highlights

- A curated set of operators (`map`, `filter`, `merge`, `debounce`, and 40+ more) that work with sync or async callbacks uniformly.
- `from`/`createStream` helpers let you wrap arrays, iterables, events, or WebSockets and stay in control of backpressure.
- `.pipe()` chains stay pull-first, and `subscribe()` gives you a familiar callback surface without giving up flow control.
- Multicast sources (via `createStream`) share work across subscribers while still honoring natural consumer pacing.
- Tiny bundle (~9 KB gzipped) and zero dependencies keep your app lean.

Use Streamix when you want reactive-style composition while preserving async generator laziness, natural backpressure, and the ability to pause the source from the consumer side. Pair this short overview with the full `streamix_readme6.md` for guides, examples, and deeper motivation.

## Streamix vs Concurrents

| Feature | Streamix | RxJS | redux-saga |
| --- | --- | --- | --- |
| Bundle size | Small, generator-based core | Larger, broad operator set | Lightweight middleware |
| Learning curve | Moderate, smaller API surface | Steeper, larger surface area | Familiar for Redux users |
| Execution model | Pull-based | Push-based | Pull-style generator effects |
| Async/await | Native | Limited | Native via generator/yield |
| Backpressure | Consumer-driven | Requires patterns | Managed implicitly per saga |

## Live demos

- [Simple Animation](https://stackblitz.com/edit/stackblitz-starters-pkzdzmuk)
- [Heavy Computation](https://stackblitz.com/edit/stackblitz-starters-73vspfzz)
- [Travel Blog](https://stackblitz.com/edit/stackblitz-starters-873uh85w)

## Documentation and resources

- [API Documentation](https://epikodelabs.github.io/streamix)
- [View on GitHub](https://github.com/epikodelabs/streamix)
- [Give Feedback](https://forms.gle/CDLvoXZqMMyp4VKu9)
