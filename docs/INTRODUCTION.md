<p align="center">
  <img src="https://epikodelabs.github.io/streamix/LOGO.png" alt="streamix" width="380">
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

streamix is a reactive streams library built on async generators. Values are computed on demand — consumers pull, producers don't push blindly. The result is natural backpressure, predictable memory use, and a `for await...of`-first API that composes well with modern TypeScript.

```bash
npm install @epikodelabs/streamix
```

## Core concepts

### Streams (Legacy)

> **Deprecated:** The imperative `createStream` API shown in this section is deprecated and no longer exported from `@epikodelabs/streamix`. New code should build async sequences with [`atom`](/ATOMS), [`flow`](/ATOMS), [`loop`](/api/#function-loop), or plain async generators combined with [`pipe`](/api/#function-pipe).

A stream is an async iterable sequence. You can iterate it directly or pipe it through operators.

```ts
import { filter, map, pipe, range, take } from '@epikodelabs/streamix';

const evens = pipe(
  range(1, 20),
  filter(n => n % 2 === 0),
  map(n => n * 10),
  take(5)
);

for await (const value of evens) {
  console.log(value); // 20, 40, 60, 80, 100
}
```

### Atoms

Atoms are reactive values — readable, writable, and composable with `derived`. They are also streams, so they pipe and iterate like any other source.

```ts
import { atom, derived, pipe } from '@epikodelabs/streamix';

const count = atom(0);         // always has a value
const label = atom<string>();  // value arrives later

const summary = derived(() => `count is ${count.value}`);

count.next(5);
console.log(summary.value); // "count is 5"

// As a stream
pipe(count, map(n => n * 2)).subscribe(console.log);
```

**Migration from Subjects:**

| Before | After |
|--------|-------|
| `createSubject<T>()` | `atom<T>()` |
| `createBehaviorSubject(initial)` | `atom(initial)` |

### Operators

Operators transform streams. Sync and async callbacks are both supported.

```ts
pipe(
  stream,
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
const first = await pipe(interval(1000), take(1)).query();
```

Resolves to the first emitted value and unsubscribes automatically.

---

## Coroutines

Offload heavy work to Web Workers without losing composability.

```ts
import { actor, compose, compute, coroutine, main } from '@epikodelabs/streamix/coroutines';

// Run a function in a worker pool
const square = coroutine(function square(value: number) {
  return value * value;
});
const result = await square.processTask(7); // 49
await square.finalize();

// Long-lived stateful worker
const counter = actor('counter', (msg: { action: 'inc' | 'get' }, state: number) => {
  if (msg.action === 'inc') return state + 1;
  return state;
}, 0);

const one = await main.outbox.request(counter, 'update', { action: 'inc' }); // 1
const two = await main.outbox.request(counter, 'update', { action: 'inc' }); // 2
await main.outbox.stop(counter);
```

Worker functions are serialized and run in isolation, so they must be self-contained. streamix APIs are not available inside Web Workers.

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

Most reactive libraries push values eagerly. streamix pulls — the consumer asks for the next value, and only then is it computed.

```ts
async function* primes() {
  let n = 2;
  while (true) {
    if (isPrime(n)) yield n;
    n++;
  }
}

// Only 5 primes are ever computed
for await (const p of pipe(primes, take(5))) {
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
| Reactive state | Atoms + derived | BehaviorSubject + manual |

---

## Resources

- [Documentation](https://epikodelabs.github.io/streamix)
- [npm](https://www.npmjs.com/package/@epikodelabs/streamix)
- [GitHub](https://github.com/epikodelabs/streamix)
- [Give feedback](https://forms.gle/CDLvoXZqMMyp4VKu9)

---

## License

GNU AGPL v3 or later