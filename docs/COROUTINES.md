# Streamix Coroutines

`@epikodelabs/streamix/coroutines` runs CPU-heavy work in Web Workers without blocking the main thread.

A **coroutine** is a background task runner created from your function. It generates a worker script (as a blob), manages a pool of Web Workers, and exposes a direct task runner via `processTask(...)`.

Use `coroutine(...)` when you need:
- background computation
- direct task execution through `processTask(...)`
- one-off worker execution through `compute(...)`
- sequential pipeline composition through `compose(...)`

Use `createPool()` and `checkout(...)` when you need dedicated worker access for stateful sessions.

If you need worker/main-thread messaging, use `actor(...)` instead. See [ACTORS.md](./ACTORS.md).

---

## What a coroutine is

```
Your function ──► blob script ──► WorkerPool (internal) ──► TaskRunner
```

1. You provide a task function.
2. The coroutine factory turns it into a Web Worker script (blob URL).
3. An internal `WorkerPool` creates and reuses workers from that blob.
4. The returned object is a `TaskRunner` — call `processTask(data)` directly.

A **worker** is a single Web Worker thread — an implementation detail managed by the internal pool. `Coroutine` does **not** expose pool methods. If you need low-level worker control, use `createPool()` instead.

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

Offload a function to a dedicated worker pool without managing `coroutine()` yourself. `compute` creates a **SIMD pool** — the task is baked into the worker blob once and shared by every worker.

```ts
import { compute } from "@epikodelabs/streamix/coroutines";

const run = compute(function square(value: number) {
  return value * value;
});

const result = await run(7); // 49
await run.finalize();        // terminate workers when done
```

The pool is created when `compute(...)` is called. Workers are spawned lazily as tasks arrive, up to `navigator.hardwareConcurrency` (or 4 as fallback).

### `checkout(...)`

Check out a single dedicated worker from a **generic pool** for multiple sequential tasks. The worker is returned to the pool when you call `release()`.

Unlike `coroutine.processTask()`, which assigns each task to any idle worker, `checkout` pins all tasks to the **same worker**. This is useful for stateful sessions.

```ts
import { checkout, createPool } from "@epikodelabs/streamix/coroutines";

const pool = createPool();

const session = await checkout(pool, () => {}, () => {}).query();

try {
  const a = await session.processTask((x: number) => x * 10, 1);
  const b = await session.processTask((x: number) => x * 10, 2);
} finally {
  session.release();
}
```

`session.processTask(fn, data)` sends the function and data directly to the checked-out worker. The worker compiles the function with `new Function` and executes it. Functions are cached per worker by their source code.

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
