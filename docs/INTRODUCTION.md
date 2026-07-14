<p align="center">
  <img src="https://epikodelabs.github.io/streamix/LOGO.png" alt="Streamix" width="380">
</p>

<p align="center">
  <strong>Pull-based reactive streams built on async generators.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">
    <img src="https://img.shields.io/npm/v/@epikodelabs%2Fstreamix.svg?style=flat-square&color=0ea5e9">
  </a>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">
    <img src="https://img.shields.io/npm/dt/@epikodelabs%2Fstreamix.svg?style=flat-square&color=0ea5e9">
  </a>
  <a href="https://epikodelabs.github.io/streamix/bundle-size.svg">
    <img src="https://epikodelabs.github.io/streamix/bundle-size.svg?style=flat-square">
  </a>
  <a href="https://github.com/epikodelabs/streamix/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg?style=flat-square">
  </a>
</p>

<br>

## What is streamix?

**streamix** is essentially a lightweight, modern alternative to RxJS that feels much closer to native JavaScript. It’s a great fit if you're building highly concurrent apps, web-based dashboards, or complex UI tools where you want reactive state but hate the debugging nightmares of push-based subscriber chains.

The core package focuses on:

- Pull-based streams for lazy asynchronous composition
- Subjects for hot multicast event sources
- Familiar operators such as `map`, `filter`, `switchMap`, `debounce`, and `scan`
- Async iterator first consumption with `for await...of`
- `query()` for awaiting the next stream value with automatic cleanup
- Optional companion packages for coroutines, DOM observers, networking, and aggregate operators

## Installation

```bash
npm install @epikodelabs/streamix
```

```bash
yarn add @epikodelabs/streamix
```

```bash
pnpm add @epikodelabs/streamix
```

## Quick start

```ts
import { range, map, filter, take } from '@epikodelabs/streamix';

const values = range(1, 20).pipe(
  filter(n => n % 2 === 0),
  map(n => n * 10),
  take(5)
);

for await (const value of values) {
  console.log(value); // 20, 40, 60, 80, 100
}
```

## Streams

A stream is an async iterable sequence. You can iterate it directly, subscribe to it, or pass it through an operator pipeline.

```ts
import { createStream, debounce, filter, map } from '@epikodelabs/streamix';

async function* searchTerms() {
  yield 'str';
  yield 'stream';
  yield 'streamix';
}

const normalized = createStream('searchTerms', searchTerms).pipe(
  debounce(100),
  map(term => term.trim().toLowerCase()),
  filter(term => term.length >= 3)
);

for await (const term of normalized) {
  console.log(term);
}
```

Streams are pull-based by default. Work is performed only when values are consumed, which gives predictable cancellation and natural backpressure.

## Subjects

Subjects are hot streams. They are useful when the producer is imperative or event-driven and multiple consumers need to observe the same emissions.

```ts
import {
  createSubject,
  createBehaviorSubject,
  createReplaySubject,
} from '@epikodelabs/streamix';

const events = createSubject<{ type: string }>();

events.subscribe(event => {
  console.log('event:', event.type);
});

events.next({ type: 'ready' });
```

Use the subject variants according to subscriber needs:

| Factory | Use case |
|---------|----------|
| `createSubject<T>()` | Live event stream with no retained value |
| `createBehaviorSubject<T>(initial)` | Live stream with a current value for new subscribers |
| `createReplaySubject<T>(capacity)` | Live stream that replays recent emissions to late subscribers |

Subjects also support async iteration:

```ts
for await (const event of events) {
  console.log(event);
}
```

## Operators

Operators transform streams while preserving async-iterable semantics.

```ts
import { from, map, filter, scan, take } from '@epikodelabs/streamix';

const totals = from([1, 2, 3, 4, 5]).pipe(
  filter(n => n % 2 === 1),
  scan((sum, n) => sum + n, 0),
  take(3)
);
```

Common operators include `map`, `filter`, `scan`, `tap`, `debounce`, `throttle`, `switchMap`, `mergeMap`, `concatMap`, `exhaustMap`, `take`, `skip`, `buffer`, `retry`, `catchError`, `share`, `shareReplay`, `combineLatest`, `zip`, and `forkJoin`.

## Stream factories

The package includes stream factories for common sources:

| Factory | Description |
|---------|-------------|
| `of(...values)` | Fixed sequence |
| `from(source)` | Arrays, iterables, async iterables, promises |
| `range(start, count)` | Sequential integers |
| `interval(ms)` | Repeating counter |
| `timer(delay, period?)` | Delayed, optionally repeating counter |
| `defer(factory)` | Fresh stream per subscriber |
| `merge(...sources)` | Interleaved concurrent emissions |
| `concat(...sources)` | Sources run sequentially |
| `combineLatest(...sources)` | Latest value from each source |
| `zip(...sources)` | Pair emissions by index |
| `race(...sources)` | First source to emit wins |
| `forkJoin(...sources)` | Emit once when all sources complete |

## Querying a stream

`query()` awaits the next emitted value and then cleans up the subscription.

```ts
import { interval, take } from '@epikodelabs/streamix';

const firstTick = await interval(1000).pipe(take(1)).query();
```

## Coroutines and actors

Use `@epikodelabs/streamix/coroutines` for worker-backed execution.

```ts
import { compute } from '@epikodelabs/streamix/coroutines';

const primes = compute(async function* () {
  let n = 2;

  while (true) {
    while (!isPrime(n)) n++;
    yield n++;
  }
});
```

The coroutines package provides:

- `compute()` for worker-backed async generators
- `compose()` for worker-side pipeline fusion
- `actor()` for long-lived stateful workers

## Companion packages

| Package | Description |
|---------|-------------|
| `@epikodelabs/streamix` | Core streams, subjects, operators, factories |
| `@epikodelabs/streamix/aggregates` | Aggregate operators such as average, min, max, sum |
| `@epikodelabs/streamix/coroutines` | Web Worker utilities, coroutines, actors |
| `@epikodelabs/streamix/dom` | DOM observation utilities |
| `@epikodelabs/streamix/networking` | HTTP client, WebSocket, JSONP |

## Monorepo structure

```text
projects/libraries/streamix/
├── src/           # Core runtime: streams, subjects, operators, factories
├── aggregates/    # Aggregate operators
├── coroutines/    # Coroutines and actors
├── dom/           # DOM observation utilities
└── networking/    # HTTP client, WebSocket, JSONP
```

## Documentation

- [Full Documentation](https://epikodelabs.github.io/streamix)
- [Medium: A Generator-Driven, Pull-Based Reactive Core](https://medium.com/p/a1eb9e7ce1d7)
- [Medium: streamix vs redux-saga](https://medium.com/p/0bfc206ad41c)

## Community

- Join [GitHub Discussions](https://github.com/orgs/epikodelabs/discussions) for questions and ideas.
- [Share your feedback](https://forms.gle/CDLvoXZqMMyp4VKu9)

## License

GNU AGPL v3 or later
