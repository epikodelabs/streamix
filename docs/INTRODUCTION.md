<p align="center">
  <img src="https://epikodelabs.github.io/streamix/LOGO.png" alt="streamix" width="380">
</p>

<p align="center">
  <strong>Reactive flows built on async generators.</strong>
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

streamix is a reactive flows library built on async generators. It gives you synchronous state reads, composable derived values, lifecycle-aware scopes, and flows that work naturally with modern TypeScript.

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

## Coroutines

Offload heavy work to Web Workers without losing composability.

```ts
import { actor, coroutine, main } from '@epikodelabs/streamix/coroutines';

// Run a function in one dedicated worker
const square = coroutine(function square(value: number) {
  return value * value;
});
const result = await square.run(7); // 49
await square.dispose();

// Long-lived stateful worker
const counter = actor('counter', (msg: { topic: string; payload?: { amount?: number } }, state: number) => {
  if (msg.topic === 'inc') return state + (msg.payload?.amount ?? 1);
  return state;
}, 0);

main.outbox.send(counter, 'inc', { amount: 1 });
const one = await main.outbox.request(counter, 'inc', { amount: 0 }); // 1
const two = await main.outbox.request(counter, 'inc', { amount: 1 }); // 2
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
