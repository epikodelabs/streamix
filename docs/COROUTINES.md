# Streamix Coroutines

`@epikodelabs/streamix/coroutines` runs CPU-heavy work in Web Workers without blocking the main thread.

A **coroutine** is a background-task operator created from your function. It generates a worker script (as a blob), manages a pool of Web Workers, and exposes both a **stream operator** and a **direct task runner**.

Use `coroutine(...)` when you need:
- background computation
- worker pooling
- direct task execution through `processTask(...)`
- stream integration through `compute(...)`
- dedicated worker checkout through `checkout(...)`
- sequential pipeline composition through `compose(...)`

If you need worker/main-thread messaging, use `actor(...)` instead. See [ACTORS.md](./ACTORS.md).

---

## What a coroutine is

```
Your function ──► blob script ──► WorkerPool ──► Coroutine (Operator + TaskRunner)
```

1. You provide a task function.
2. The coroutine factory turns it into a Web Worker script (blob URL).
3. A `WorkerPool` creates and reuses workers from that blob.
4. The returned `Coroutine` is both:
   - an `Operator` — you can pipe streams through it with `compute(...)`
   - a `TaskRunner` — you can call `processTask(data)` directly

A **worker** is a single Web Worker thread — an implementation detail managed by the pool. You rarely interact with workers directly unless you use `checkout(...)`.

A coroutine result wears two hats: it is a stream `Operator`/`TaskRunner` **and** it exposes the underlying `WorkerPool` methods (`getIdleWorker`, `assignTask`, etc.). `checkout(...)` uses only the pool facet — it does not care about the operator part.

---

## Quick Start

```ts
import { coroutine } from "@epikodelabs/streamix/coroutines";

const primes = coroutine(function findPrimes(limit: number) {
  const result: number[] = [];

  for (let n = 2; n <= limit; n++) {
    let isPrime = true;
    for (let d = 2; d * d <= n; d++) {
      if (n % d === 0) {
        isPrime = false;
        break;
      }
    }
    if (isPrime) result.push(n);
  }

  return result;
});

const values = await primes.processTask(10_000);
```

---

## Main APIs

### `processTask(...)`

Run one task and get one result:

```ts
const result = await primes.processTask(10_000);
```

### `compute(...)`

Use a coroutine inside a stream pipeline:

```ts
import { compute, coroutine } from "@epikodelabs/streamix/coroutines";
import { from } from "@epikodelabs/streamix";

const square = coroutine(function square(value: number) {
  return value * value;
});

const stream = from([1, 2, 3]).pipe(
  compute(square, Promise.resolve(4))
);
```

### `checkout(...)`

Check out a single dedicated worker from a pool for multiple sequential tasks. The worker is returned to the pool when you call `release()`.

`checkout` works with any `WorkerPool` — a plain `coroutine(...)`, an `actor(...)`, or even a raw `createPool(...)` result.

```ts
import { checkout, coroutine } from "@epikodelabs/streamix/coroutines";

const multiply = coroutine(function multiply(value: number) {
  return value * 10;
});

// A coroutine result is also a WorkerPool, so it can be passed to checkout.
const session = await checkout(multiply, () => {}, () => {}).query();

try {
  const a = await session.processTask(1);
  const b = await session.processTask(2);
} finally {
  session.release();
}
```

### `compose(...)`

Chain coroutines sequentially — the output of each becomes the input of the next:

```ts
import { compose, coroutine } from "@epikodelabs/streamix/coroutines";

const decode = coroutine(function decode(input: string) {
  return JSON.parse(input);
});

const project = coroutine(function project(input: { value: number }) {
  return input.value;
});

const pipeline = compose(decode, project);
const result = await pipeline.processTask('{"value":42}');
```

Each coroutine in the chain keeps its own worker pool. `compose` does not create new workers or blobs — it reuses the pools you provide.

---

## Helpers

There are two ways to give a worker extra functions.

### Positional helper functions

Use this for normal helper code you control:

```ts
const worker = coroutine(
  async function task(input: number) {
    return double(await delayValue(input));
  },
  function double(value: number) {
    return value * 2;
  },
  async function delayValue(value: number) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return value;
  }
);
```

### Config `helpers`

Use this for raw worker-side snippets that cannot be expressed as normal functions:

```ts
import { coroutine, type CoroutineConfig } from "@epikodelabs/streamix/coroutines";

const config: CoroutineConfig = {
  helpers: [
    "const SCALE = 2;",
    "function injected(value) { return value * SCALE; }",
  ],
};

declare const injected: (value: number) => number;

const worker = coroutine(config)(function task(input: number) {
  return injected(input);
});
```

---

## Rules

- Prefer `function` expressions for worker tasks and helper functions.
- Keep worker code self-contained.
- Do not rely on variables from outer lexical scope.
- Pass helper functions explicitly when the worker needs them.
- Use config `helpers` only for raw injected snippets that cannot be expressed as normal helper functions.

---

## When To Use `actor(...)` Instead

Use `actor(...)` when the worker needs:
- request/response with the main thread
- one-way worker-to-main events
- one-way main-to-worker messages
- worker-local concurrency primitives plus a main-thread bridge

See [ACTORS.md](./ACTORS.md).
