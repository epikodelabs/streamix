<p align="center">
  <img src="https://github.com/epikodelabs/streamix/blob/main/projects/libraries/streamix/LOGO.png?raw=true" alt="Streamix Logo" width="500">
</p>

<p align="center">
  <strong>Reactive streams built on async generators</strong><br>
  Small bundle, pull-based execution, and a familiar operator API
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

## Why Streamix

Streamix is a reactive streams library built on async generators. It focuses on a small bundle size and pull-based execution while keeping an API that feels familiar to RxJS users.

### Highlights

- Pull-based execution so values are computed when requested
- Async iterator first, designed for `for await...of`
- Async callbacks are supported in `subscribe` handlers
- `query()` retrieves actual emitted value as a promise
- Operators for mapping, filtering, combination, and control flow
- Subjects for manual emission and multicasting
- Optional HTTP client and DOM observation utilities

---

## Installation

```bash
# npm
npm install @epikodelabs/streamix

# yarn
yarn add @epikodelabs/streamix

# pnpm
pnpm add @epikodelabs/streamix
```

---

## Quick start

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

### Subscribe with async callbacks

```typescript
import { interval } from '@epikodelabs/streamix';

const sub = interval(1000).subscribe(async value => {
  await fetch('/metrics', { method: 'POST', body: JSON.stringify({ value }) });
});

// Later:
sub.unsubscribe();
```

### Subscribe with a receiver

```typescript
import { interval, take } from '@epikodelabs/streamix';

const sub = interval(500)
  .pipe(take(3))
  .subscribe({
    next: value => console.log('tick:', value),
    error: err => console.error('error:', err),
    complete: () => console.log('complete'),
  });

sub.unsubscribe();
```

### Subscribe and cancel on a condition

```typescript
import { interval } from '@epikodelabs/streamix';

const sub = interval(1000).subscribe(value => {
  console.log('value:', value);
  if (value >= 5) {
    sub.unsubscribe();
  }
});
```

---

## Core concepts

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

### Operators

Transform, filter, and combine streams with familiar operators:

```typescript
import { map, filter, mergeMap, combineLatest } from '@epikodelabs/streamix';

const processedStream = sourceStream
  .pipe(
    map(x => x * 2),
    filter(x => x > 10),
    mergeMap(x => fetchDataFor(x))
  );
```

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

---

## HTTP client

Streamix includes an HTTP client that composes well with streams:

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

const dataStream = retry(() => client.get("/users", readJson), 3)
  .pipe(
    map(users => users.filter(user => user.active))
  );

for await (const activeUsers of dataStream) {
  console.log('Active users:', activeUsers);
}
```

---

## Real-world example

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

---

## Available operators

### Transformation
- `map` - Transform each value
- `scan` - Accumulate values over time
- `buffer` - Collect values into arrays

### Filtering
- `filter` - Keep values that match criteria
- `take` - Take first N values
- `takeWhile` - Take while condition is true
- `skip` - Skip first N values
- `distinct` - Remove duplicates

### Combination
- `mergeMap` - Merge multiple streams
- `switchMap` - Switch to latest stream
- `combineLatest` - Combine latest values
- `concat` - Connect streams sequentially

### Utility
- `tap` - Side effects without changing stream
- `delay` - Add delays between emissions
- `retry` - Retry failed operations
- `finalize` - Cleanup when stream completes
- `debounce` - Limit emission rate

---

## Live demos

- [Simple Animation](https://stackblitz.com/edit/stackblitz-starters-pkzdzmuk)
- [Heavy Computation](https://stackblitz.com/edit/stackblitz-starters-73vspfzz)
- [Travel Blog](https://stackblitz.com/edit/stackblitz-starters-873uh85w)

---

## Generator-based architecture

Unlike push-based streams, Streamix uses pull-based async generators:

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

---

## Streamix vs RxJS

| Feature | Streamix | RxJS |
| --- | --- | --- |
| Bundle size | Small, generator-based core | Larger, broad operator set |
| Learning curve | Moderate, smaller API surface | Steeper, larger surface area |
| Execution model | Pull-based | Push-based |
| Async/await | Native | Limited |
| Backpressure | Consumer-driven | Requires patterns |

---

## Documentation and resources

- [API Documentation](https://epikodelabs.github.io/streamix)
- [Blog: Exploring Streamix](https://medium.com/p/00d5467f0c01)
- [Streamix 2.0 Updates](https://medium.com/p/a1eb9e7ce1d7)
- [Reactive Programming Guide](https://medium.com/p/0bfc206ad41c)

---

## Contributing

We welcome issues and pull requests. If you are new to the codebase:

- Open an issue with a minimal reproduction for bugs
- Propose features with a short problem statement and example
- Improve docs with focused changes

[Share your feedback](https://forms.gle/CDLvoXZqMMyp4VKu9)

---

## License

MIT License

---

<p align="center">
  <strong>Get started</strong><br>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">Install from NPM</a> -
  <a href="https://github.com/epikodelabs/streamix">View on GitHub</a> -
  <a href="https://forms.gle/CDLvoXZqMMyp4VKu9">Give Feedback</a>
</p>

<p align="center">
   If Streamix is useful to you, consider giving the repo a <a href="https://github.com/epikodelabs/streamix">star</a> 
</p>

