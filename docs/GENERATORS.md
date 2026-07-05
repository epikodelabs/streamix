# 🚀 Understanding Async Generators

Async generators are great. What if we just add operator pipelines to them?

That's Streamix—a library that wraps async generators with composable operators while keeping the pull-based semantics intact.

The examples below use the current atom-based API: [`pipe`](/api/#function-pipe) / [`from`](/api/#function-from) for operator pipelines, and [`flow`](/ATOMS) / [`loop`](/api/#function-loop) / [`listen`](/api/#function-listen) for shared hot sources.

```bash
npm install @epikodelabs/streamix
```

✅ **What you get:**
- Familiar operators: `pipe`, `map`, `filter`, `merge`, `debounce`, etc.
- Same pull-based execution—consumer still controls the pace
- Operators work with sync/async/promises without distinction
- Two consumption styles: `for await...of` or `subscribe()`
- Multicast when you need shared execution
- ~9-11 KB gzipped, zero dependencies

---

## 💡 The Idea

Async generators already give you lazy evaluation and backpressure:

```typescript
async function* bedtimeStory() {
  yield "Once upon a time...";
  await sleep(1000);
  yield "There was a dragon.";
  await sleep(1000);
  yield "The end!";
}

for await (const page of bedtimeStory()) {
  console.log(page);
}
```

But chaining transformations requires nested functions. streamix adds operator pipelines:

```typescript
import { filter, from, map, pipe } from '@epikodelabs/streamix';

const theaterShow = pipe(
  from(bedtimeStory()),
  map(page => page.toUpperCase()),
  filter(page => page.includes("DRAGON"))
);

for await (const scene of theaterShow) {
  console.log(scene);
}
```

Same behavior, cleaner syntax. The generator stays pull-based.

---

## ⚡ Quick Start

```typescript
import { filter, from, map, pipe, take } from '@epikodelabs/streamix';

async function* countSheep(total: number) {
  for (let i = 1; i <= total; i++) {
    yield `Sheep #${i}`;
    await new Promise(r => setTimeout(r, 500));
  }
}

const sleepyTime = pipe(
  from(countSheep(100)),
  filter(sheep => !sheep.includes("13")),
  map(sheep => sheep + " zzz"),
  take(10)
);

for await (const sheep of sleepyTime) {
  console.log(sheep);
}

// Or use subscribe
sleepyTime.subscribe(sheep => console.log(sheep));
```

---

## 🎣 Pull Semantics Preserved

**Pull:** consumer requests values, producer waits.

```typescript
for await (const fish of fishingTrip()) {
  await cookFish(fish);
  console.log("Yum!");
}
```

streamix keeps this pull behavior even with `subscribe()`. The callback style is implemented using internal buffering over pull-based iteration—the consumer's pace still controls the producer.

---

## 🔁 / 🔂 Multicast vs Unicast

**Unicast** (`pipe` from an async generator): each consumer gets its own iterator.

```typescript
const piped = pipe(
  from(toyBox()),
  map(toy => toy.toUpperCase())
);

for await (const toy of piped) { /* chain 1 */ }
for await (const toy of piped) { /* chain 2 */ }
```

**Multicast** ([`flow`](/ATOMS) / [`listen`](/api/#function-listen)): shared execution across subscribers.

```typescript
import { flow } from '@epikodelabs/streamix';

const shared = flow(toyBox());

shared.subscribe(toy => console.log("Kid 1:", toy));
shared.subscribe(toy => console.log("Kid 2:", toy));
```

---

## ⏳ Backpressure

Natural backpressure is preserved—slow consumers pause producers:

```typescript
async function* candyMachine(signal: AbortSignal) {
  while (!signal.aborted) {
    yield "Candy!";
    await delay(100);
  }
}

const candies = flow(candyMachine); // flow owns the AbortSignal

for await (const candy of candies) {
  await chewSlowly(2000);
}
```

When a producer outpaces a consumer, values accumulate in an internal queue. The queue is unbounded—monitor memory if the producer is consistently faster.

**Managing queue growth:**

```typescript
pipe(candies, take(100));
pipe(candies, throttle(100));
pipe(candies, filter((_, i) => i % 10 === 0));
```

---

## 🧹 Cleanup

`finally` blocks always run:

```typescript
async function* paintJob(signal: AbortSignal) {
  try {
    yield "Red paint";
    yield "Blue paint";
    yield "Green paint";
  } finally {
    console.log("Cleaning brushes!");
  }
}

const paints = flow(paintJob);

for await (const paint of paints) {
  if (paint === "Blue") break;
}
// Output: Cleaning brushes!
```

Use an `AbortSignal` for resource cleanup. Pass a generator factory to `flow` so it owns the signal:

```typescript
async function* dbLogs(signal: AbortSignal) {
  const db = await connect();
  signal.addEventListener('abort', () => db.close());

  try {
    while (!signal.aborted) {
      yield await db.query('SELECT * FROM logs');
      await delay(1000);
    }
  } finally {
    db.close();
  }
}

const logs = flow(dbLogs); // flow creates and aborts the signal on disposal
```

---

## Examples

### Raindrop Race

```typescript
async function* raindrops() {
  for (let i = 0; i < 20; i++) {
    yield `Drop ${i}`;
    await sleep(Math.random() * 1000);
  }
}

const race = pipe(
  from(raindrops()),
  map(drop => ({ drop, time: Date.now() })),
  take(5)
);

for await (const finisher of race) {
  console.log(`${finisher.drop} finished!`);
}
```

### Real-Time Metrics

```typescript
import { flow } from '@epikodelabs/streamix';

async function* metrics(signal: AbortSignal) {
  while (!signal.aborted) {
    yield await collectMetrics();
    await delay(1000);
  }
}

const allMetrics = flow(metrics); // flow owns the AbortSignal

const highLoad = pipe(
  allMetrics,
  filter(m => m.cpu > 80 || m.memory > 90)
);

highLoad.subscribe(sendAlert);
allMetrics.subscribe(updateDashboard);
```

### File Processing

```typescript
async function* readChunks(path: string) {
  const file = await open(path);
  try {
    while (!file.eof) {
      yield await file.read(1024 * 1024);
    }
  } finally {
    await file.close();
  }
}

const errors = pipe(
  from(readChunks('app.log')),
  map(chunk => chunk.toString()),
  mergeMap(text => text.split('\n')),
  filter(line => line.includes('ERROR'))
);

for await (const line of errors) {
  console.error(line);
  if (shouldStop(line)) break;
}
```

---

## When to Use

| Scenario | Use |
|----------|-----|
| Simple iteration | Plain async generators |
| Operator pipelines | [`pipe`](/api/#function-pipe) |
| Hot sources (events, WebSockets) | [`listen`](/api/#function-listen) / [`flow`](/ATOMS) |
| Resource-intensive work | streamix (automatic backpressure) |
| Multiple consumers | [`flow`](/ATOMS) with shared async generators |
| Small bundle size matters | streamix (~9KB) |

---

## Summary

The core idea: **add operator pipelines to async generators.**

streamix keeps the pull-based semantics you get with native async iteration—consumer controls pace, natural backpressure, lazy evaluation—while adding the composability of reactive operators.

```typescript
// Before: nested functions
for await (const n of mapped(filtered(numbers()))) { }

// After: operator pipeline
pipe(
  from(numbers()),
  filter(n => n % 2 === 0),
  map(n => n * 2)
)
```

---

## Resources

- [GitHub Repository](https://github.com/epikodelabs/streamix)
- [npm Package](https://www.npmjs.com/package/@epikodelabs/streamix)
- [Bundle Analysis](https://bundlephobia.com/package/@epikodelabs/streamix)
