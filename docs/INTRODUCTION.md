<p align="center">
  <img src="https://raw.githubusercontent.com/epikodelabs/epikodelabs.github.io/refs/heads/main/streamix/LOGO.png" alt="streamix" width="380">
</p>

<p align="center">
  <strong>Reactive flows built on async iterators.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">
    <img src="https://img.shields.io/npm/v/@epikodelabs%2Fstreamix.svg?style=flat-square&color=0ea5e9">
  </a>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">
    <img src="https://img.shields.io/npm/dt/@epikodelabs%2Fstreamix.svg?style=flat-square&color=0ea5e9">
  </a>
  <a href="https://epikodelabs.github.io/streamix/bundle-size.svg">
    <img src="https://raw.githubusercontent.com/epikodelabs/epikodelabs.github.io/161dea3e83f7bb6c27dcee0e33d615ba91cc5c5b/streamix/bundle-size.svg">
  </a>
  <a href="https://github.com/epikodelabs/streamix/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg?style=flat-square">
  </a>
</p>

streamix is a reactive flows library built on async iterators. It gives you synchronous state reads, composable derived values, lifecycle-aware scopes, and flows that work naturally with modern TypeScript.

```bash
npm install @epikodelabs/streamix
```

## Core concepts

### Atoms

Atoms are reactive values: readable, writable, composable with `derived`, and consumable as async iterables when you need pipelines.

```ts
import { atom, derived, iterate, map, pipe, take } from '@epikodelabs/streamix';

const count = atom(0);         // always has a value
const label = atom<string>();  // value arrives later

const summary = derived(() => `count is ${count.value}`);

count.next(5);
console.log(summary.value); // "count is 5"

const doubled = pipe(count, map(n => n * 2), take(1));
for await (const value of doubled) console.log(value);
```

### Operators

Operators transform flows. Sync and async callbacks are both supported.

```ts
import { filter, map, pipe, range, take } from '@epikodelabs/streamix';

const valid = pipe(
  range(1, 100),
  map(x => enrich(x)),
  filter(x => x.valid),
  take(10)
);

for await (const item of valid) {
  console.log(item);
}
```

> **Pipe signature:** `pipe()` is a standalone function — the source comes first, followed by any number of operators: `pipe(source, op1, op2, ...)`. The source can be an atom, a flow, or any async iterable. This replaces the v2 method-chaining style (`source.pipe(op1, op2)`); the pipeline reads left-to-right and returns a new atom. Up to 16 operators keep full type inference — beyond that, the result falls back to `Atom<any>`. See the [migration guide](MIGRATION.md) for the full v2 → v3 mapping.

Full catalog: `audit`, `buffer`, `bufferCount`, `bufferUntil`, `bufferWhile`, `catchError`, `concatMap`, `debounce`, `defaultIfEmpty`, `delay`, `delayUntil`, `distinctUntilChanged`, `distinctUntilKeyChanged`, `endWith`, `exhaustMap`, `expand`, `filter`, `finalize`, `first`, `fork`, `groupBy`, `ignoreElements`, `last`, `map`, `mergeMap`, `observeOn`, `partition`, `reduce`, `sample`, `scan`, `select`, `shareReplay`, `skip`, `skipUntil`, `skipWhile`, `slidingPair`, `startWith`, `switchMap`, `take`, `takeUntil`, `takeWhile`, `tap`, `throttle`, `throwError`, `toArray`, `withLatestFrom`.

### Flow Factories

| Factory | Description |
|---------|-------------|
| `combineLatest(...sources)` | Latest value from each source, combined |
| `concat(...sources)` | Sources run sequentially |
| `defer(factory)` | Fresh flow per subscriber |
| `EMPTY()` | Completes immediately |
| `forkJoin(...sources)` | Emits once when all complete |
| `from(source)` | Arrays, iterables, generators, promises |
| `fromEvent(target, event)` | DOM / Node events |
| `fromPromise(p)` | Promise as a single-emission flow |
| `interval(ms)` | Counter every `ms` milliseconds |
| `merge(...sources)` | Interleaved concurrent emissions |
| `of(...values)` | Fixed sequence, then complete |
| `race(...sources)` | First source to emit wins |
| `range(start, count)` | Sequential integers |
| `retry(source, n)` | Retry on error, up to `n` times |
| `timer(delay, period?)` | Delayed, optionally repeating |
| `zip(...sources)` | Pair emissions by index |

### Custom operators

```ts
import { createOperator, DONE, NEXT } from '@epikodelabs/streamix';

const onlyPrime = () =>
  createOperator<number, number>('onlyPrime', source => ({
    async next() {
      while (true) {
        const result = await source.next();
        if (result.done) return DONE;
        if (isPrime(result.value)) return NEXT(result.value);
      }
    }
  }));
```

### Consume a single emission

```ts
for await (const first of pipe(interval(1000), take(1))) {
  console.log(first);
}
```

The pipeline completes after the first emitted value.

---

## HTTP client

```ts
import { createHttpClient, readJson, useBase, useTimeout } from '@epikodelabs/streamix/networking';

const api = createHttpClient().withDefaults(
  useBase('https://api.example.com'),
  useTimeout(5000)
);

for await (const data of api.get('/items', readJson)) {
  console.log(data);
}
```

---

## Why pull-based?

Most reactive libraries push values eagerly. streamix pulls: the consumer asks for the next value, and only then is it computed.

```ts
async function* primes() {
  let n = 2;
  while (true) {
    if (isPrime(n)) yield n;
    n++;
  }
}

// Only 5 primes are ever computed
for await (const p of pipe(primes(), take(5))) {
  console.log(p);
}
```

This gives you on-demand computation, bounded memory, and consumer-driven backpressure without manual coordination.

---

## streamix vs RxJS

| | streamix | RxJS |
|--|----------|------|
| Execution model | Pull-based (lazy) | Push-based (eager) |
| Backpressure | Consumer-driven | Manual patterns required |
| Async/await | Native | Limited |
| Bundle size | Small | Larger |
| Reactive state | Atoms + derived | Manual stores |

---

## Resources

- [Documentation](https://epikodelabs.github.io/streamix)
- [npm](https://www.npmjs.com/package/@epikodelabs/streamix)
- [GitHub](https://github.com/epikodelabs/streamix)
- [Give feedback](https://forms.gle/CDLvoXZqMMyp4VKu9)

---

## License

GNU AGPL v3 or later
