# streamix

Reactive streams that don't fight you. Built on async generators for pull-based execution, tiny bundles, and an API that feels familiar.

<p align="center">
  <img src="https://github.com/epikodelabs/streamix/blob/main/LOGO.png?raw=true" alt="streamix Logo" width="500">
</p>

<p align="center">
  <a href="https://github.com/epikodelabs/streamix/actions/workflows/build.yml">
    <img src="https://github.com/epikodelabs/streamix/actions/workflows/build.yml/badge.svg?branch=main" alt="Build Status">
  </a>
  <a href="https://www.npmjs.com/package/@epikodelabs%2Fstreamix">
    <img src="https://img.shields.io/npm/v/@epikodelabs%2Fstreamix.svg?style=flat-square" alt="NPM Version">
  </a>
  <a href="https://www.npmjs.com/package/@epikodelabs%2Fstreamix">
    <img src="https://img.shields.io/npm/dm/@epikodelabs%2Fstreamix.svg?style=flat-square" alt="NPM Downloads">
  </a>
  <a href="https://github.com/epikodelabs/streamix">
    <img src="https://raw.githubusercontent.com/epikodelabs/streamix/main/projects/libraries/streamix/bundle-size.svg" alt="Bundle Size">
  </a>
  <a href="https://codecov.io/github/epikodelabs/streamix" >
    <img src="https://codecov.io/github/epikodelabs/streamix/graph/badge.svg?token=ITHDU7JVOI" alt="Code Coverage"/>
  </a>
</p>

---

## ✨ The Problem with Reactive Streams

You've been there: RxJS is powerful but your bundle is bloated. Promises are simple but chaining async operations turns into callback soup. React's useEffect dependencies spiral out of control. You need reactive patterns without the baggage.

**streamix** gives you reactive streams that compute on-demand, compose naturally with async/await, and ship in a fraction of the size. Built on async generators, it's pull-based by design—values only compute when you ask for them, giving you natural backpressure and predictable behavior.

### What You Get

🪶 **Lightweight** — Generator-based core means minimal bundle impact  
🎯 **Pull-based** — Values compute on-demand, no wasted cycles  
⚡ **Async native** — Built for `for await...of` and async workflows  
🔄 **RxJS-familiar** — Map, filter, debounce—operators you already know  
⚛️ **React-ready** — Drop-in replacement for complex useEffect chains  
🎨 **Flexible** — Subjects for manual control, streams for composition  
🔍 **Debuggable** — Iterator-first design makes each step inspectable

Whether you're building real-time dashboards, CLI tools, or background processors, streamix keeps async complexity manageable without the framework tax.

---

## 📦 Installation

```bash
npm install @epikodelabs/streamix
```

---

## ⚡️ Quick Start

### Transform Data Streams

```typescript
import { range, map, filter, take } from '@epikodelabs/streamix';

const stream = range(1, 100)
  .pipe(
    map(x => x * 2),
    filter(x => x % 3 === 0),
    take(5)
  );

for await (const value of stream) {
  console.log(value); // 6, 12, 18, 24, 30
}
```

### Tame User Input

```typescript
import { fromEvent, debounce, map, filter } from '@epikodelabs/streamix';

const searchInput = document.getElementById('search');
const searchStream = fromEvent(searchInput, 'input')
  .pipe(
    map(event => event.target.value),
    debounce(300),
    filter(text => text.length > 2)
  );

for await (const searchTerm of searchStream) {
  console.log('Searching for:', searchTerm);
}
```

### Simplify React Components

Stop wrestling with useEffect dependencies and cleanup functions:

```typescript
import { useEffect, useState } from 'react';
import { fromEvent, debounce, map, filter } from '@epikodelabs/streamix';

function SearchComponent() {
  const [results, setResults] = useState([]);

  useEffect(() => {
    const searchInput = document.getElementById('search');
    const stream = fromEvent(searchInput, 'input')
      .pipe(
        map(e => e.target.value),
        debounce(300),
        filter(text => text.length > 2)
      );

    (async () => {
      for await (const term of stream) {
        const data = await fetchResults(term);
        setResults(data);
      }
    })();
  }, []); // One dependency array. That's it.

  return <ResultsList results={results} />;
}
```

No dependency arrays to maintain. No manual cleanup. No stale closure bugs. Just streams.

---

## 🧠 Core Concepts

### Streams Are Just Async Generators

At their core, streams are async generators—functions that yield values over time:

```typescript
import { createStream } from '@epikodelabs/streamix';

async function* numberStream() {
  for (let i = 0; i < 10; i++) {
    yield i;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

const stream = createStream('numbers', numberStream);
```

This simple foundation means streams are predictable, testable, and easy to reason about.

### Stream Factories: Common Patterns, Zero Boilerplate

Rather than writing generators for every use case, reach for built-in factories:

**Combine Multiple Sources**
- `combineLatest(...sources)` — React to any change across multiple streams
- `concat(...sources)` — Chain streams sequentially, one after another
- `forkJoin(...sources)` — Wait for all streams to complete, emit final values
- `merge(...sources)` — Mix concurrent streams into a single flow
- `race(...sources)` — First to emit wins, others get cancelled
- `zip(...sources)` — Pair values by index across streams

**Create From Anything**
- `defer(factory)` — Lazy evaluation—build streams only when subscribed
- `from(source)` — Lift arrays, iterables, async generators, or promises
- `fromEvent(target, event)` — Turn DOM clicks, key presses, anything into streams
- `fromPromise(promise)` — Single-value streams from promise-based APIs
- `of(...values)` — Emit a known set of values immediately
- `range(start, count)` — Generate sequential numbers without loops

**Control Timing**
- `interval(ms)` — Metronome for your async operations
- `timer(delay, period?)` — Delayed start, optional repetition

**Shape Behavior**
- `EMPTY()` — The stream that does nothing (useful for conditional logic)
- `iif(condition, trueSource, falseSource)` — Branch based on runtime conditions
- `loop(factory)` — Keep generating while values keep coming
- `retry(source, attempts)` — Resilience built in—retry failed operations

### Operators: Compose Without Nesting

Operators transform streams without callback pyramids. Pipe them together for readable async logic:

```typescript
const stream = from(items)
  .pipe(
    map(x => x * 2),
    filter(x => x > 10),
    debounce(100),
    take(5)
  );
```

Mix sync and async transformations seamlessly:

```typescript
const results = from(pages)
  .pipe(
    map(page => page.length),
    map(async length => {
      await expensiveOperation(length);
      return length * 2;
    }),
    filter(num => num > 10)
  );
```

**40+ Operators Organized By Purpose**

**Shape Your Data**  
`map`, `scan`, `reduce`, `expand`, `recurse`, `groupBy`, `partition` — Transform, accumulate, and reorganize streams into exactly what you need.

**Pick What Matters**  
`filter`, `take`, `takeWhile`, `takeUntil`, `skip`, `skipWhile`, `skipUntil`, `first`, `last`, `elementAt`, `elementNth`, `distinctUntilChanged`, `distinctUntilKeyChanged`, `unique` — Cut through noise and extract signal.

**Orchestrate Multiple Streams**  
`withLatestFrom`, `sample`, `fork`, `slidingPair` — Coordinate timing and combine data across concurrent flows.

**Control the Flow**  
`buffer`, `bufferCount`, `debounce`, `throttle`, `audit`, `delay`, `delayUntil` — Rate limiting, batching, and timing control without manual state management.

**Flatten Nested Streams**  
`concatMap`, `mergeMap`, `switchMap` — Handle streams that produce streams—perfect for API calls, dynamic data, and conditional flows.

**Handle Edge Cases**  
`tap`, `catchError`, `defaultIfEmpty`, `ignoreElements`, `throwError`, `observeOn`, `shareReplay`, `toArray` — Debug, recover from errors, and handle empty or failed streams gracefully.

**Aggregate Results**  
`count`, `every`, `some`, `min`, `max`, `select` — Reduce streams to single values or boolean checks.

### Subjects: When You Need Manual Control

Sometimes you need to push values into a stream on your own terms:

```typescript
import { createSubject } from '@epikodelabs/streamix';

const messages = createSubject<string>();

// Consumer listens
(async () => {
  for await (const msg of messages) {
    console.log('Received:', msg);
  }
})();

// Producer pushes
messages.next('System online');
messages.next('Processing...');
messages.complete();
```

### Query: Get One Value and Bail

When you just need the first emitted value as a promise:

```typescript
import { interval, take, map } from '@epikodelabs/streamix';

// Wait for the first value
const stream = interval(1000).pipe(take(1));
const first = await stream.query();
console.log('First value:', first);

// Or transform before querying
const transformed = interval(500).pipe(
  map(value => value * 10),
  take(1)
);
const result = await transformed.query();
console.log('Result:', result); // 0
```

---

## 🌐 HTTP Client That Streams

Built-in HTTP client designed for stream composition:

```typescript
import { map, retry } from '@epikodelabs/streamix';
import {
  createHttpClient,
  readJson,
  useBase,
  useLogger,
  useTimeout
} from '@epikodelabs/streamix/http';

const client = createHttpClient().withDefaults(
  useBase("https://api.example.com"),
  useLogger(),
  useTimeout(5000)
);

// Automatic retries, stream transformations, all in one flow
const dataStream = retry(() => client.get("/users", readJson), 3)
  .pipe(
    map(users => users.filter(user => user.active))
  );

for await (const activeUsers of dataStream) {
  console.log('Active users:', activeUsers);
}
```

---

## 🧪 Real-World Example: Live Search

Debounce user input, call an API, handle errors, update the UI—all in one stream:

```typescript
import {
  fromEvent,
  fromPromise,
  debounce,
  map,
  filter,
  switchMap,
  startWith
} from '@epikodelabs/streamix';

const searchInput = document.getElementById('search');
const resultsDiv = document.getElementById('results');

const searchResults = fromEvent(searchInput, 'input')
  .pipe(
    map(e => e.target.value.trim()),
    debounce(300),                    // Wait for typing to pause
    filter(query => query.length > 2), // Ignore short queries
    switchMap(query =>                 // Cancel previous requests
      fromPromise(
        fetch(`/api/search?q=${query}`)
          .then(r => r.json())
          .catch(() => ({ error: 'Search failed', query }))
      )
    ),
    startWith({ results: [], query: '' })
  );

for await (const result of searchResults) {
  if (result.error) {
    resultsDiv.innerHTML = `<p class="error">${result.error}</p>`;
  } else {
    resultsDiv.innerHTML = result.results
      .map(item => `<div class="result">${item.title}</div>`)
      .join('');
  }
}
```

No state variables. No cleanup logic. Just a single, readable stream.

---

## 🎬 See It In Action

- [Simple Animation](https://stackblitz.com/edit/stackblitz-starters-pkzdzmuk) — Visual transformations with streams
- [Heavy Computation](https://stackblitz.com/edit/stackblitz-starters-73vspfzz) — Handling large datasets efficiently
- [Travel Blog](https://stackblitz.com/edit/stackblitz-starters-873uh85w) — Full application example

---

## 🧬 Pull-Based = Predictable

Unlike push-based streams that fire whenever they want, streamix generators only compute values when you ask for them:

```typescript
import { createStream, take } from '@epikodelabs/streamix';

async function* expensiveStream() {
  for (let i = 0; i < 1000000; i++) {
    yield expensiveComputation(i); // Only runs when consumed
  }
}

const stream = createStream('calculations', expensiveStream)
  .pipe(take(10)); // Stops after 10 values—no wasted computation
```

This gives you:
- **On-demand computation** — No CPU cycles burned until you iterate
- **Natural backpressure** — Consumer controls the pace
- **Lower memory** — Values exist only while being processed
- **Easier debugging** — Step through values predictably

---

## ⚖️ Streamix vs RxJS

| Feature | Streamix | RxJS |
|---------|----------|------|
| **Philosophy** | Pull-based, compute on-demand | Push-based, eager execution |
| **Bundle Size** | ~15KB minified | ~50KB+ minified |
| **Learning Curve** | Focused API, easier entry | Comprehensive but steeper |
| **Async/Await** | Native throughout | Requires conversion |
| **Backpressure** | Built-in by design | Manual implementation |
| **Best For** | Modern async workflows, bundle-conscious apps | Complex reactive systems, existing RxJS codebases |

Both are excellent tools. Choose streamix for new projects where bundle size matters and async/await is primary. Choose RxJS for established patterns or when you need its extensive operator ecosystem.

---

## 📚 Learn More

- [API Documentation](https://epikodelabs.github.io/streamix) — Complete reference
- [streamix 2.0 Updates](https://medium.com/p/a1eb9e7ce1d7) — generator-driven reactive library
- [Reactive Programming Guide](https://medium.com/p/0bfc206ad41c) — streamix vs redux-saga

---

## 🤝 Contributing

Found a bug? Have an idea? We'd love to hear from you.

- **Bug reports** — Minimal reproduction case in an issue
- **Features** — Describe the problem and your proposed solution
- **Docs** — Clarifications and examples always welcome
- **Code** — Follow existing patterns, include tests

[Share feedback](https://forms.gle/CDLvoXZqMMyp4VKu9) and help shape streamix.

---

## 📜 License

MIT — use it freely.

---

<p align="center">
  <strong>Ready to stream?</strong><br>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">Install from NPM</a> ·
  <a href="https://github.com/epikodelabs/streamix">Star on GitHub</a> ·
  <a href="https://forms.gle/CDLvoXZqMMyp4VKu9">Give Feedback</a>
</p>