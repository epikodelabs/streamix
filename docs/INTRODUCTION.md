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

Streamix is a reactive streams library built on async generators. Values are computed on demand — consumers pull, producers don't push blindly. The result is natural backpressure, predictable memory use, and a `for await...of`-first API that composes well with modern TypeScript.

```bash
npm install @epikodelabs/streamix
```

## Core concepts

### Streams

A stream is an async iterable sequence. You can iterate it directly or pipe it through operators.

```ts
import { range, map, filter, take } from '@epikodelabs/streamix';

const evens = range(1, 20).pipe(
  filter(n => n % 2 === 0),
  map(n => n * 10),
  take(5)
);

for await (const value of evens) {
  console.log(value); // 20, 40, 60, 80, 100
}
```

### Operators

Operators transform streams. Sync and async callbacks are both supported.

```ts
stream.pipe(
  map(async x => await enrich(x)),
  filter(x => x.valid),
  debounce(200),
  take(10)
)
```

Full catalog: `audit`, `buffer`, `bufferCount`, `bufferUntil`, `bufferWhile`, `catchError`, `concatMap`, `debounce`, `defaultIfEmpty`, `delay`, `delayUntil`, `distinctUntilChanged`, `distinctUntilKeyChanged`, `endWith`, `exhaustMap`, `expand`, `filter`, `finalize`, `first`, `fork`, `groupBy`, `ignoreElements`, `last`, `map`, `mergeMap`, `observeOn`, `partition`, `reduce`, `sample`, `scan`, `select`, `shareReplay`, `skip`, `skipUntil`, `skipWhile`, `slidingPair`, `startWith`, `switchMap`, `take`, `takeUntil`, `takeWhile`, `tap`, `throttle`, `throwError`, `toArray`, `withLatestFrom`.

### Stream factories

| Factory | Description |
|---------|-------------|
| `combineLatest(...sources)` | Latest value from each source, combined |
| `concat(...sources)` | Sources run sequentially |
| `defer(factory)` | Fresh stream per subscriber |
| `EMPTY()` | Completes immediately |
| `forkJoin(...sources)` | Emits once when all complete |
| `from(source)` | Arrays, iterables, generators, promises |
| `fromEvent(target, event)` | DOM / Node events |
| `fromPromise(p)` | Promise as a single-emission stream |
| `interval(ms)` | Counter every `ms` milliseconds |
| `merge(...sources)` | Interleaved concurrent emissions |
| `of(...values)` | Fixed sequence, then complete |
| `race(...sources)` | First source to emit wins |
| `range(start, count)` | Sequential integers |
| `retry(source, n)` | Retry on error, up to `n` times |
| `timer(delay, period?)` | Delayed, optionally repeating |
| `zip(...sources)` | Pair emissions by index |

### Subjects

Subjects are hot streams for push-based producers. Use them when an event source is naturally imperative, when several consumers need the same live emissions, or when late subscribers need a current value or replayed history.

```ts
import { createSubject, createBehaviorSubject, createReplaySubject } from '@epikodelabs/streamix';

const events = createSubject<{ type: string }>();
events.subscribe(event => console.log(event.type));
events.next({ type: 'ready' });

const current = createBehaviorSubject(0);
current.next(1);

const recent = createReplaySubject<string>(3);
recent.next('connected');
```

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

### `query()` — promise from a stream

```ts
const first = await interval(1000).pipe(take(1)).query();
```

Resolves to the first emitted value and unsubscribes automatically.

---

## Coroutines

Offload heavy work to Web Workers without losing stream composability.

```ts
import { compute, compose, actor } from '@epikodelabs/streamix';

// Run a function in a worker pool
const result = await compute(() => heavyCalculation());

// Run a whole pipeline in the background
const background = compose(source.pipe(map(expensiveTransform)));

// Long-lived stateful worker
const counter = actor({ count: 0 }, (state, msg) => {
  if (msg === 'increment') return { count: state.count + 1 };
  return state;
});
```

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

Most reactive libraries push values eagerly. Streamix pulls — the consumer asks for the next value, and only then is it computed.

```ts
async function* primes() {
  let n = 2;
  while (true) {
    if (isPrime(n)) yield n;
    n++;
  }
}

// Only 5 primes are ever computed
for await (const p of createStream('primes', primes).pipe(take(5))) {
  console.log(p);
}
```

This gives you on-demand computation, bounded memory, and consumer-driven backpressure without manual coordination.

---

## Streamix vs RxJS

| | Streamix | RxJS |
|--|----------|------|
| Execution model | Pull-based (lazy) | Push-based (eager) |
| Backpressure | Consumer-driven | Manual patterns required |
| Async/await | Native | Limited |
| Bundle size | Small | Larger |
| Hot producers | Subjects + async iteration | Subjects + observable subscriptions |

---

## Resources

- [Documentation](https://epikodelabs.github.io/streamix)
- [npm](https://www.npmjs.com/package/@epikodelabs/streamix)
- [GitHub](https://github.com/epikodelabs/streamix)
- [Give feedback](https://forms.gle/CDLvoXZqMMyp4VKu9)

**Live demos:** [Animation](https://stackblitz.com/edit/stackblitz-starters-pkzdzmuk) · [Heavy computation](https://stackblitz.com/edit/stackblitz-starters-73vspfzz) · [Travel blog](https://stackblitz.com/edit/stackblitz-starters-873uh85w)

---

## License

GNU AGPL v3 or later
