# streamix

Reactive streams built on async generators.
Small bundle, pull-based execution, and a familiar operator API.

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


## Give a Star on GitHub

If streamix helps you, please give it a star: https://github.com/epikodelabs/streamix


## ✨ Why Streamix

**streamix** is a reactive streams library built on async generators. It focuses on a small bundle size and pull-based execution while keeping an API that feels familiar to RxJS users, and normalizing async operations toward an iterator-first workflow keeps each stream predictable, which makes debugging and testing easier whether you are building a dashboard, a CLI, or a background job processor.

### Highlights

- Pull-based execution so values are computed when requested
- Async iterator first, designed for `for await...of`
- Async callbacks are supported in `subscribe` handlers
- `query()` retrieves actual emitted value as a promise
- Operators for mapping, filtering, combination, and control flow
- Subjects for manual emission and multicasting
- Optional HTTP client and DOM observation utilities


## 📦 Installation

```bash
# npm
npm install @epikodelabs/streamix

# yarn
yarn add @epikodelabs/streamix

# pnpm
pnpm add @epikodelabs/streamix
```


## ⚡️ Quick start

The quick start below shows how to lift generators or ranged sequences into operator pipelines; you can iterate them directly or fall back to `subscribe` when you need push-style delivery.

### Basic stream operations

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

### Handling user events

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

## 🧠 Core concepts

### Streams

Streams are sequences of values over time, implemented as async generators:

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

### 🏭 Available factories

The library ships a range of helper factories so you can stand up common sources without calling `createStream` directly:

- `combineLatest(...sources)` - join the latest values from multiple streams.
- `concat(...sources)` - run sources sequentially, one after another.
- `defer(factory)` - build a fresh stream by invoking the factory per subscription.
- `EMPTY()` - a stream that immediately completes without emitting anything.
- `forkJoin(...sources)` - emit once with the final values after all sources complete.
- `from(source)` - lift arrays, iterables, async generators, or promises into a stream.
- `fromEvent(target, event)` - convert DOM/Node-style events into a stream.
- `fromPromise(promise)` - wrap a promise-producing operation so it emits once and completes.
- `iif(condition, trueSource, falseSource)` - branch between two creator callbacks.
- `interval(ms)` - emit an increasing counter every `ms` milliseconds.
- `loop(factory)` - repeat a factory-based generator while it keeps yielding.
- `merge(...sources)` - interleave concurrent emissions from multiple sources.
- `of(...values)` - emit the provided values in order and then complete.
- `race(...sources)` - mirror the first source to emit and cancel the rest.
- `range(start, count)` - emit a fixed range of sequential numbers.
- `retry(source, attempts)` - repeat a source when it errors, up to `attempts` times.
- `timer(delay, period?)` - emit after an initial delay and optionally repeat.
 - `zip(...sources)` - pair emissions from sources by matching indexes.

## 🛠️ Available operators

Operators compose async generators with familiar transformations so you can restructure logic without nested blocks.

```typescript
stream.pipe(
  map(x => x * 2),
  filter(x => x > 10),
  take(5),
  debounce(100)
)
```

Operators handle sync and async callbacks transparently:

```typescript
const magicShow = from(storyBook)
  .pipe(
    map(page => page.length),
    map(async length => {
      await thinkAboutIt(1000);
      return length * 2;
    }),
    filter(num => num > 10)
  );
```

**Full operator catalog:** audit, buffer, bufferCount, catchError, concatMap, debounce, defaultIfEmpty, delay, delayUntil, distinctUntilChanged, distinctUntilKeyChanged, endWith, exhaustMap, expand, filter, finalize, first, fork, groupBy, ignoreElements, last, map, mergeMap, observeOn, partition, reduce, sample, scan, select, shareReplay, skip, skipUntil, skipWhile, slidingPair, startWith, switchMap, take, takeUntil, takeWhile, tap, throttle, throwError, toArray, withLatestFrom.

### Build custom operators

Every built-in operator you already know is just a wrapper around `createOperator`. It lets you capture the underlying iterator and return a new async iterator that applies whatever scheduling, buffering, or branching logic you need before handing values to the downstream consumer.

```typescript
import { createOperator, DONE, NEXT } from '@epikodelabs/streamix';

const evenOnly = () =>
  createOperator<number, number>('evenOnly', function (source) {
    return {
      async next() {
        while (true) {
          const result = await source.next();
          if (result.done) return DONE;
          if (result.value % 2 === 0) return NEXT(result.value);
        }
      },
      return: source.return?.bind(source),
      throw: source.throw?.bind(source),
    };
  });
```

Now you can mix `evenOnly()` into any pipeline just like the built-ins:

```typescript
const stream = from([1, 2, 3, 4]).pipe(evenOnly(), map(n => n * 10));
```

Because `createOperator` works directly with async iterators, you get the same pull-based backpressure behavior that powers the rest of the library and can freely interleave async callbacks, metadata, and cancellation hooks.

---

### Subjects

Manually control stream emissions:

```typescript
import { createSubject } from '@epikodelabs/streamix';

const subject = createSubject<string>();

for await (const value of subject) {
  console.log('Received:', value);
}

subject.next('Hello');
subject.next('World');
subject.complete();
```

### Query the first value

`query()` retrieves the actual emitted value as a promise, then automatically unsubscribes.

```typescript
import { interval, take, map } from '@epikodelabs/streamix';

const stream = interval(1000).pipe(take(1));
const first = await stream.query();
console.log('first:', first);

const transformed = interval(500).pipe(
  map(value => value * 10),
  take(1)
);
const result = await transformed.query();
console.log('result:', result);
```


## 🌐 HTTP client

streamix includes an HTTP client that composes well with streams:

```typescript
import { map, retry } from '@epikodelabs/streamix';
import {
  createHttpClient,
  readJson,
  useBase,
  useLogger,
  useTimeout
} from '@epikodelabs/streamix/networking';

const client = createHttpClient().withDefaults(
  useBase("https://api.example.com"),
  useLogger(),
  useTimeout(5000)
);

const dataStream = retry(() => client.get("/users", readJson), 3)
  .pipe(
    map(users => users.filter(user => user.active))
  );

for await (const activeUsers of dataStream) {
  console.log('Active users:', activeUsers);
}
```

## 🧪 Real-world example

Live search with API calls and basic error handling:

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
    debounce(300),
    filter(query => query.length > 2),
    switchMap(query => fromPromise(
      fetch(`/api/search?q=${query}`)
        .then(r => r.json())
        .catch(() => ({ error: 'Search failed', query }))
    )),
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

## 🎬 Live demos

- [Simple Animation](https://stackblitz.com/edit/stackblitz-starters-pkzdzmuk)
- [Heavy Computation](https://stackblitz.com/edit/stackblitz-starters-73vspfzz)
- [Travel Blog](https://stackblitz.com/edit/stackblitz-starters-873uh85w)


## 🧬 Generator-based architecture

Unlike push-based streams, streamix uses pull-based async generators:

```typescript
import { createStream, take } from '@epikodelabs/streamix';

async function* expensiveStream() {
  for (let i = 0; i < 1000000; i++) {
    yield expensiveComputation(i);
  }
}

const stream = createStream('calculations', expensiveStream)
  .pipe(take(10));
```

This enables:
- On-demand computation
- Lower memory usage per stream
- Natural backpressure from the consumer


## ⚖️ Streamix vs RxJS

| Feature | Streamix | RxJS |
| --- | --- | --- |
| Bundle size | Small, generator-based core | Larger, broad operator set |
| Learning curve | Moderate, smaller API surface | Steeper, larger surface area |
| Execution model | Pull-based | Push-based |
| Async/await | Native | Limited |
| Backpressure | Consumer-driven | Requires patterns |


## 📚 Documentation and resources

- [API Documentation](https://epikodelabs.github.io/streamix)
- [Blog: Exploring streamix](https://medium.com/p/00d5467f0c01)
- [streamix 2.0 Updates](https://medium.com/p/a1eb9e7ce1d7)
- [Reactive Programming Guide](https://medium.com/p/0bfc206ad41c)


## 🤝 Contributing

We welcome issues and pull requests. If you are new to the codebase:

- Open an issue with a minimal reproduction for bugs
- Propose features with a short problem statement and example
- Improve docs with focused changes

[Share your feedback](https://forms.gle/CDLvoXZqMMyp4VKu9)


## 📜 License

MIT License


<p align="center">
  <strong>Get started</strong><br>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">Install from NPM</a> -
  <a href="https://github.com/epikodelabs/streamix">View on GitHub</a> -
  <a href="https://forms.gle/CDLvoXZqMMyp4VKu9">Give Feedback</a>
</p>
