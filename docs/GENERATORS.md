# 🚀 Understanding Async Generators and Streamix

Async generators are great. What if we just add operator pipelines to them?

That's Streamix—a library that wraps async generators with composable operators while keeping the pull-based semantics intact.

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

// You control when to turn pages
for await (const page of bedtimeStory()) {
  console.log(page);
  await ask("Ready for next page?");
}
```

But chaining transformations requires nested functions:

```typescript
async function* filtered(source) {
  for await (const value of source) {
    if (value % 2 === 0) yield value;
  }
}

async function* mapped(source) {
  for await (const value of source) {
    yield value * 2;
  }
}

// Gets messy quickly
for await (const n of mapped(filtered(numbers()))) {
  console.log(n);
}
```

**The solution:** Add operator pipelines.

```typescript
import { from, map, filter } from '@epikodelabs/streamix';

const theaterShow = from(bedtimeStory())
  .pipe(
    map(page => page.toUpperCase()),
    filter(page => page.includes("DRAGON"))
  );

for await (const scene of theaterShow) {
  console.log(scene);
}
```

Same behavior, cleaner syntax. The generator stays pull-based—Streamix just adds the pipeline.

---

## ⚡ Quick Start

```typescript
import { from, map, filter, take } from '@epikodelabs/streamix';

// Simple async generator - counting sheep
async function* countSheep(total) {
  for (let i = 1; i <= total; i++) {
    yield `Sheep #${i}`;
    await new Promise(r => setTimeout(r, 500));
  }
}

// Add operator pipeline
const sleepyTime = from(countSheep(100))
  .pipe(
    filter(sheep => !sheep.includes("13")), // No unlucky sheep
    map(sheep => sheep + " zzz"),
    take(10) // Only count 10
  );

// Pull values with for-await-of
for await (const sheep of sleepyTime) {
  console.log(sheep);
  // Output: Sheep #1 zzz, Sheep #2 zzz, ...
}

// Or use subscribe
sleepyTime.subscribe(sheep => console.log(sheep));
```

---

## 🎣 Pull Semantics Preserved

**Pull:** Consumer requests values. Producer waits.

```typescript
// You're fishing
for await (const fish of fishingTrip()) {
  await cookFish(fish); // Cook each before getting next
  console.log("Yum!");
}
```

This is different from push-based observables where the producer decides when to emit.

Streamix keeps this pull behavior even when you use `subscribe()`. The callback style is implemented using internal buffering over pull-based iteration—the consumer's pace still controls the producer.

---

## 🔧 Creating Streams

Use `createStream` to wrap generators with operator support:

```typescript
const powerUps = createStream('game', signal => {
  return async function*() {
    while (!signal.aborted) {
      await sleep(1000);
      yield ["Star", "Mushroom", "Fire Flower"][Math.random() * 3 | 0];
    }
  }();
});

// Now you can pipe operators
const player = powerUps.pipe(
  filter(power => power !== "Mushroom"),
  map(power => `Collected: ${power}`)
);

player.subscribe(power => {
  console.log(power);
  increaseScore();
});
```

Multiple subscribers share execution (multicast):

```typescript
const movie = createStream('blockbuster', signal => {
  return async function*() {
    yield "Scene 1: Explosion!";
    yield "Scene 2: Chase scene!";
    yield "Scene 3: Happy ending!";
  }();
});

// Two friends watching
movie.subscribe(scene => console.log("Friend A:", scene));
movie.subscribe(scene => console.log("Friend B:", scene));
// Both see the same movie at similar times
```

The `signal` parameter lets you detect when all subscribers leave:

```typescript
createStream('websocket', signal => {
  const ws = new WebSocket(url);
  
  signal.addEventListener('abort', () => ws.close());
  
  return async function*() {
    try {
      for await (const msg of websocketMessages(ws)) {
        if (signal.aborted) break;
        yield msg;
      }
    } finally {
      ws.close();
    }
  }();
});
```

---

## 🎬 Consuming Streams

### for-await-of

Direct iteration when you need control:

```typescript
// Like watching a play where you say "Next scene please!"
for await (const scene of theaterShow) {
  console.log("Scene:", scene);
  await eatPopcorn(); // Take your time
  
  if (shouldStop()) break;
}
```

### subscribe()

Callback-based when you don't need loop control:

```typescript
// Like a regular movie theater
const ticket = theaterShow.subscribe({
  next: scene => console.log("Watching:", scene),
  error: err => console.error("Error:", err),
  complete: () => console.log("The end!")
});

// Leave early if you want
ticket.unsubscribe();
```

---

## 🏭 Stream factories

Streamix ships a range of helper factories so you can stand up common sources without calling `createStream` directly:

- `combineLatest(...sources)` — join the latest values from multiple streams.
- `concat(...sources)` — run sources sequentially, one after another.
- `defer(factory)` — build a fresh stream by invoking the factory per subscription.
- `EMPTY()` — a stream that immediately completes without emitting anything.
- `forkJoin(...sources)` — emit once with the final values after all sources complete.
- `from(source)` — lift arrays, iterables, async generators, or promises into a stream.
- `fromEvent(target, event)` — convert DOM/Node-style events into a stream.
- `fromPromise(promise)` — wrap a promise-producing operation so it emits once and completes.
- `iif(condition, trueSource, falseSource)` — branch between two creator callbacks.
- `interval(ms)` — emit an increasing counter every `ms` milliseconds.
- `loop(factory)` — repeat a factory-based generator while it keeps yielding.
- `merge(...sources)` — interleave concurrent emissions from multiple sources.
- `of(...values)` — emit the provided values in order and then complete.
- `race(...sources)` — mirror the first source to emit and cancel the rest.
- `range(start, count)` — emit a fixed range of sequential numbers.
- `retry(source, attempts)` — repeat a source when it errors, up to `attempts` times.
- `timer(delay, period?)` — emit after an initial delay and optionally repeat.
- `zip(...sources)` — pair emissions from sources by matching indexes.

---

## 🧰 Operators

The pipeline idea: chain transformations without nested functions.

```typescript
stream.pipe(
  map(x => x * 2),
  filter(x => x > 10),
  take(5),
  debounce(100)
)
```

**Operators handle sync and async transparently:**

```typescript
const magicShow = from(storyBook)
  .pipe(
    map(page => page.length),           // Quick counting
    map(async length => {               // Slow magic
      await thinkAboutIt(1000);
      return length * 2;
    }),
    filter(num => num > 10)             // Quick check
  );
```

**Available operators:** 

`audit`, `buffer`, `bufferCount`, `catchError`, `concatMap`, `count`, `debounce`, `defaultIfEmpty`, `delay`, `delayUntil`, `distinctUntilChanged`, `distinctUntilKeyChanged`, `elementAt`, `elementNth`, `every`, `expand`, `filter`, `first`, `fork`, `groupBy`, `ignoreElements`, `last`, `map`, `max`, `mergeMap`, `min`, `observeOn`, `partition`, `recurse`, `reduce`, `sample`, `scan`, `select`, `shareReplay`, `skip`, `skipUntil`, `skipWhile`, `slidingPair`, `some`, `switchMap`, `take`, `takeUntil`, `takeWhile`, `tap`, `throttle`, `throwError`, `toArray`, `unique`, `withLatestFrom`

**Example:**

```typescript
async function* makeCookies() {
  yield "Chocolate chip";
  yield "Oatmeal raisin";
  yield "Sugar cookie";
}

const cookieFactory = from(makeCookies())
  .pipe(
    map(cookie => cookie + " (wrapped)"),
    filter(cookie => cookie.includes("chocolate")),
    map(cookie => `Gift: ${cookie}`)
  );

for await (const gift of cookieFactory) {
  await wrapGift(gift);
  console.log("Ready:", gift);
}
```

---

## 🔁 / 🔂 Multicast vs Unicast
 
**Multicast** (from `createStream`): Shared execution

```typescript
const toyBox = createStream('toys', async function* () {
  yield "Car";
  yield "Teddy";
  yield "Dice";
});

// Two kids want the same toy box
const kid1 = toyBox.subscribe(toy => console.log("Kid 1:", toy));
const kid2 = toyBox.subscribe(toy => console.log("Kid 2:", toy));
// They have to SHARE the toys
```

**Unicast** (from `.pipe()`): Independent execution

```typescript
const piped = toyBox.pipe(map(toy => toy.toUpperCase()));

for await (const toy of piped) { /* chain 1 */ }
for await (const toy of piped) { /* chain 2 */ }
// Each creates new iterator chain
```

---

## ⏳ Backpressure

Natural backpressure is preserved—slow consumers pause producers:

```typescript
// The "Too Much Candy" Problem
const candyMachine = createStream('candy', async function* (signal: AbortSignal) {
  while (!signal.aborted) {
    yield "Candy!";
    // Makes candy REALLY fast
  }
});

// If you eat slowly...
for await (const candy of candyMachine) {
  await chewSlowly(2000); // Takes 2 seconds to eat
  // Candy piles up in the machine while you're chewing
}
```

When producer outpaces consumer, values accumulate in an internal queue. The queue is unbounded—monitor memory if producer is consistently faster.

**Managing queue growth:**

```typescript
// Solution: Make the machine slower or eat faster

// Limit items
candyMachine.pipe(take(100))

// Throttle
candyMachine.pipe(throttle(100))

// Sample
candyMachine.pipe(filter((_, i) => i % 10 === 0))

// Or slow down producer
async function*() {
  while (!signal.aborted) {
    yield "Candy!";
    await delay(100); // Pace production
  }
}
```

---

## 🧹 Cleanup

`finally` blocks always run:

```typescript
const messyStream = createStream('paint', async function* (signal: AbortSignal) {
  try {
    yield "Red paint";
    yield "Blue paint";
    yield "Green paint";
  } finally {
    console.log("Cleaning brushes!"); // Always happens
  }
});

// Even if you spill paint and stop...
for await (const paint of messyStream) {
  if (paint === "Blue") {
    console.log("Blue everywhere!");
    break; // Oops
  }
}
// Output: Cleaning brushes! (Still cleans up)
```

Use `signal` for resource cleanup:

```typescript
createStream('db', async (signal: AbortSignal) => {
  const db = await connect();
  signal.addEventListener('abort', () => db.close());
  
  return async function* () {
    try {
      while (!signal.aborted) {
        yield await db.query('SELECT * FROM logs');
        await delay(1000);
      }
    } finally {
      db.close();
    }
  }();
});
```

---

## Examples

### Raindrop Race

```typescript
// Each raindrop goes at its own pace
async function* raindrops() {
  for (let i = 0; i < 20; i++) {
    yield `Drop ${i}`;
    await sleep(Math.random() * 1000); // Random speed
  }
}

// Race them
const race = from(raindrops())
  .pipe(
    map(drop => ({ drop, time: Date.now() })),
    take(5) // First 5 to finish
  );

console.log("Ready... Set... Go!");
for await (const finisher of race) {
  console.log(`${finisher.drop} finished!`);
}
```

### Real-Time Metrics

```typescript
const metrics = createStream('system', async function* (signal: AbortSignal) {
  while (!signal.aborted) {
    yield await collectMetrics();
    await delay(1000);
  }
});

const highLoad = metrics.pipe(
  filter(m => m.cpu > 80 || m.memory > 90)
);

highLoad.subscribe(sendAlert);
metrics.subscribe(updateDashboard);
```

### File Processing

```typescript
async function* readChunks(path) {
  const file = await open(path);
  try {
    while (!file.eof) {
      yield await file.read(1024 * 1024);
    }
  } finally {
    await file.close();
  }
}

const errors = createStream('logs', signal => readChunks('app.log')).pipe(
  map(chunk => chunk.toString()),
  mergeMap(text => text.split('\n')),
  filter(line => line.includes('ERROR'))
);

for await (const line of errors) {
  console.error(line);
  if (shouldStop(line)) break;
}
```

### Interactive Quiz

```typescript
async function* questions() {
  yield "What's your favorite animal?";
  await think(1000);
  yield "What's your favorite color?";
  await think(1000);
  yield "Let's make a story!";
}

const quiz = from(questions())
  .pipe(
    map(question => `Question: ${question}`),
    filter(question => question.includes("favorite"))
  );

for await (const q of quiz) {
  const answer = await ask(q);
  console.log("You said:", answer);
}
```

### API Rate Limiting

```typescript
async function* userIds() {
  yield* [1, 2, 3, 4, 5];
}

const users = createStream('users', userIds).pipe(
  map(id => fetch(`/api/users/${id}`).then(r => r.json())),
  filter(user => user.active)
);

for await (const user of users) {
  await saveToDatabase(user); // Sequential, rate-limited
}
```

---

## When to Use

| Scenario | Use |
|----------|-----|
| Simple iteration | Plain async generators |
| Need operator pipelines | Streamix |
| Hot sources (events, WebSockets) | `createStream` (multicast) |
| Resource-intensive work | Streamix (automatic backpressure) |
| Multiple consumers | `createStream` (multicast) |
| Small bundle size matters | Streamix (~9KB) |

**Use Streamix when:**
- You want operator pipelines for async generators
- Backpressure is important
- You want reactive-style composition
- Bundle size matters

**Skip it when:**
- Simple iteration suffices (plain async generators work fine)
- Your team is heavily invested in another reactive library

---

## Summary

The core idea: **Add operator pipelines to async generators.**

Streamix keeps the pull-based semantics you get with native async iteration—consumer controls pace, natural backpressure, lazy evaluation—while adding the composability of reactive operators.

```typescript
// Before: nested functions
for await (const n of mapped(filtered(numbers()))) { }

// After: operator pipeline
from(numbers())
  .pipe(
    filter(n => n % 2 === 0),
    map(n => n * 2)
  )
```

Same behavior, cleaner syntax, same pull semantics.

---

## Resources

- [GitHub Repository](https://github.com/epikodelabs/streamix)
- [npm Package](https://www.npmjs.com/package/@epikodelabs/streamix)
- [Bundle Analysis](https://bundlephobia.com/package/@epikodelabs/streamix)
