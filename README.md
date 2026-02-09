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

## 📁 Monorepo Structure

```
projects/libraries/streamix/
├── src/                        # Core library (abstractions, operators/streams)
├── aggregates/                 # Aggregate operators (average, min/max, etc.)
├── coroutines/                 # Web Worker background processing
├── dom/                        # DOM observation utilities (onResize, etc.)
├── networking/                 # HTTP client, WebSocket, JSONP
└── tracing/                    # Stream lifecycle tracing/debugging
```

## ⚡️ Quick start

The quick start below shows how to lift generators or ranged sequences into operator pipelines; you can iterate them directly or fall back to `subscribe` when you need push-style delivery.

### Basic stream operations

```typescript
import { range, map, filter, take } from '@epikodelabs/streamix';

const potionRecipe = range(1, 20)
  .pipe(
    map(ingredient => ({
      name: ['Dragon Scale', 'Phoenix Tear', 'Unicorn Hair', 'Mermaid Kelp'][ingredient % 4],
      power: ingredient * 10,
      rarity: ingredient % 3 === 0 ? 'legendary' : 'common'
    })),
    filter(item => item.rarity === 'legendary'),
    map(item => `✨ ${item.name} (${item.power} power)`),
    take(5)
  );

for await (const ingredient of potionRecipe) {
  console.log('Adding to cauldron:', ingredient);
}
// → Adding to cauldron: ✨ Dragon Scale (30 power)
// → Adding to cauldron: ✨ Dragon Scale (60 power)
// → Adding to cauldron: ✨ Dragon Scale (90 power)
// → Adding to cauldron: ✨ Dragon Scale (120 power)
// → Adding to cauldron: ✨ Dragon Scale (150 power)
```

### Handling user events

```typescript
import {
  fromEvent,
  debounce,
  filter,
  switchMap,
  map,
  startWith
} from '@epikodelabs/streamix';

const searchInput = document.getElementById('search') as HTMLInputElement;
const jokesDiv = document.getElementById('jokes');

const jokeStream = fromEvent(searchInput, 'input')
  .pipe(
    map(e => (e.target as HTMLInputElement).value.trim()),
    debounce(400),
    filter(term => term.length > 1),
    switchMap(term =>
      fromPromise(
        fetch(`https://icanhazdadjoke.com/search?term=${encodeURIComponent(term)}`, {
          headers: { Accept: 'application/json' }
        })
          .then(r => r.json())
          .then(data => data.results.slice(0, 5))
          .catch(() => [{ joke: 'No jokes found... that’s not funny 😢' }])
      )
    ),
    startWith([])
  );

for await (const jokes of jokeStream) {
  jokesDiv.innerHTML = jokes.length
    ? jokes.map((j: any) => `<div class="joke">😂 ${j.joke}</div>`).join('')
    : '<p>Type something like "cat" or "pizza"...</p>';
}
```

## 🧠 Core concepts

### Streams

Streams are sequences of values over time, implemented as async generators:

```typescript
import { createStream } from '@epikodelabs/streamix';

async function* countdown() {
  for (let i = 10; i > 0; i--) {
    yield `T-${i}...`;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  yield '🚀 Launch!';
}

const launchStream = createStream('countdown', countdown);

for await (const msg of launchStream) {
  console.log(msg);
}
// → T-10...
// → T-9...
// ... 
// → 🚀 Launch!
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
const magicShow = from(storyPages)
  .pipe(
    map(async page => {
      await dramaticPause(1000);
      return page.toUpperCase() + '!!!';
    }),
    filter(text => text.length > 20)
  );
```

**Full operator catalog:** audit, buffer, bufferCount,  bufferUntil, bufferWhile,catchError, concatMap, debounce, defaultIfEmpty, delay, delayUntil, distinctUntilChanged, distinctUntilKeyChanged, endWith, exhaustMap, expand, filter, finalize, first, fork, groupBy, ignoreElements, last, map, mergeMap, observeOn, partition, reduce, sample, scan, select, shareReplay, skip, skipUntil, skipWhile, slidingPair, startWith, switchMap, take, takeUntil, takeWhile, tap, throttle, throwError, toArray, withLatestFrom.

### Build custom operators

Every built-in operator you already know is just a wrapper around `createOperator`. It lets you capture the underlying iterator and return a new async iterator that applies whatever scheduling, buffering, or branching logic you need before handing values to the downstream consumer.

```typescript
import { createOperator, DONE, NEXT } from '@epikodelabs/streamix';

const onlyPrime = () =>
  createOperator<number, number>('onlyPrime', function (source) {
    const isPrime = (n: number) => {
      if (n <= 1) return false;
      for (let i = 2; i <= Math.sqrt(n); i++) if (n % i === 0) return false;
      return true;
    };

    return {
      async next() {
        while (true) {
          const result = await source.next();
          if (result.done) return DONE;
          if (isPrime(result.value)) return NEXT(result.value);
        }
      },
      return: source.return?.bind(source),
      throw: source.throw?.bind(source),
    };
  });
```

Now you can mix `onlyPrime()` into any pipeline just like the built-ins:

```typescript
const stream = from([1, 2, 3, 4]).pipe(onlyPrime(), map(n => n * 10));
```

Because `createOperator` works directly with async iterators, you get the same pull-based backpressure behavior that powers the rest of the library and can freely interleave async callbacks, metadata, and cancellation hooks.

---

### Subjects

Manually control stream emissions:

```typescript
import { createSubject } from '@epikodelabs/streamix';

const chat = createSubject<string>();

for await (const msg of chat) {
  console.log('New message:', msg);
}

chat.next('Hey! 👋');
chat.next('Anyone here?');
chat.complete();
```

### Query the first value

`query()` retrieves the actual emitted value as a promise, then automatically unsubscribes.

```typescript
const firstLaunch = await interval(1000).pipe(take(1)).query();
console.log('First tick:', firstLaunch); // → 0
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

const api = createHttpClient().withDefaults(
  useBase("https://api.github.com"),
  useLogger(),
  useTimeout(5000)
);

const starsStream = retry(() => api.get("/repos/epikodelabs/streamix", readJson), 3)
  .pipe(map(repo => repo.stargazers_count));

for await (const stars of starsStream) {
  console.log(`⭐ Current stars: ${stars}`);
}
```

## 🧪 Real-world example

Live search with API calls and basic error handling:

```typescript
import {
  fromEvent,
  debounce,
  filter,
  switchMap,
  map,
  startWith,
  catchError
} from '@epikodelabs/streamix';
import { fromPromise } from '@epikodelabs/streamix';

const searchInput = document.getElementById('chuck-search') as HTMLInputElement;
const jokesDiv = document.getElementById('chuck-jokes');
const loadingEl = document.getElementById('loading');
const emptyEl = document.getElementById('empty');

interface ChuckJoke {
  id: string;
  value: string;
}

const chuckStream = fromEvent(searchInput, 'input')
  .pipe(
    map(e => (e.target as HTMLInputElement).value.trim()),
    debounce(400),
    filter(query => query.length > 0),
    switchMap(query =>
      fromPromise(
        fetch(`https://api.chucknorris.io/jokes/search?query=${encodeURIComponent(query)}`)
          .then(r => {
            if (!r.ok) throw new Error('API error');
            return r.json();
          })
          .then(data => data.result as ChuckJoke[])
          .then(jokes => jokes.slice(0, 8)) // Limit to avoid flooding
          .catch(() => [] as ChuckJoke[])
      )
    ),
    map(jokes => ({
      jokes,
      message: jokes.length === 0 
        ? `No Chuck Norris jokes found for "${searchInput.value}". Even Chuck is disappointed. 😔`
        : null
    })),
    startWith({ jokes: [], loading: true })
  );

for await (const result of chuckStream) {
  if (result.loading) {
    jokesDiv!.innerHTML = '';
    loadingEl!.style.display = 'block';
    emptyEl!.style.display = 'none';
    continue;
  }

  loadingEl!.style.display = 'none';

  if (result.jokes.length === 0) {
    emptyEl!.textContent = result.message || 'Type something Chuck Norris would approve of...';
    emptyEl!.style.display = 'block';
    jokesDiv!.innerHTML = '';
    continue;
  }

  emptyEl!.style.display = 'none';
  jokesDiv!.innerHTML = result.jokes
    .map((joke: ChuckJoke) => `
      <div class="joke-card">
        <p><strong>💪</strong> ${joke.value}</p>
      </div>
    `)
    .join('');
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

async function* expensivePrimes() {
  let n = 2;
  while (true) {
    console.log('🔥 Computing next prime...');
    while (!isPrime(n)) n++;
    yield n++;
    // Artificial heavy work
    for (let i = 0; i < 1e8; i++);
  }
}

const primes = createStream('primes', expensivePrimes).pipe(take(5));

for await (const p of primes) {
  console.log('Prime:', p);
}
// Only 5 "Computing..." logs appear—no wasted work!
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
