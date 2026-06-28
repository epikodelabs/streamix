# streamix Coroutines

`@epikodelabs/streamix/coroutines` runs CPU-heavy work in Web Workers without blocking the main thread.

A `coroutine(...)` is a background task runner created from your function. It generates a worker script, starts one dedicated worker for that script on demand, and exposes a direct task API through `processTask(...)`.

Use `coroutine(...)` when you need:
- background computation
- direct task execution through `processTask(...)`
- reuse of the same dedicated worker across many calls
- sequential pipeline composition through `compose(...)`

Use `compute(...)` when you need pooled throughput instead of a single dedicated worker.

If you need worker/main-thread messaging, use `actor(...)` instead. See [ACTORS.md](./ACTORS.md).

---

## What a coroutine is

```text
your function -> worker script -> one dedicated worker -> processTask(...)
```

1. You provide a task function.
2. The coroutine factory turns it into a worker script.
3. The coroutine creates one reusable worker for that script.
4. Calls to `processTask(data)` are queued and executed on that worker.

A `Coroutine` is not a pool and does not expose worker lifecycle primitives. If you need a worker pool, use `compute(...)`.

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
await primes.finalize();
```

---

## Main APIs

### `processTask(...)`

Run one task and get one result:

```ts
const result = await primes.processTask(10_000);
```

Calls are queued onto the coroutine's dedicated worker.

### `finalize()`

Terminate the dedicated worker and reject any queued or in-flight work:

```ts
await primes.finalize();
```

### `compute(...)`

Offload a function to a dedicated worker pool. `compute(...)` bakes the task into one worker script and lets multiple workers reuse that same script for throughput.

```ts
import { compute } from "@epikodelabs/streamix/coroutines";

const run = compute(function square(value: number) {
  return value * value;
});

const result = await run(7); // 49
await run.finalize();        // terminate the pool when done
```

The pool is created when `compute(...)` is called. Workers are spawned lazily as tasks arrive, up to `navigator.hardwareConcurrency` (or 4 as fallback).

### `compose(...)`

Chain coroutines sequentially so the output of each stage becomes the input of the next:

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
await pipeline.finalize();
```

When `compose(...)` receives `CoroutineScript` inputs, it merges them into one worker script and runs the pipeline inside one dedicated worker task. When it receives generic `TaskRunner` inputs, those stages are executed sequentially on the main thread side by calling each runner.

---

## Helpers

There are two ways to give a worker extra code.

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

### Trailing `helpers` option

Use this for raw worker-side snippets that cannot be expressed as normal functions:

```ts
import { coroutine } from "@epikodelabs/streamix/coroutines";

declare const injected: (value: number) => number;

const worker = coroutine(
  function task(input: number) {
    return injected(input);
  },
  {
    helpers: [
      "const SCALE = 2;",
      "function injected(value) { return value * SCALE; }",
    ],
  }
);
```

---

## Rules

- Prefer `function` expressions for worker tasks and helper functions.
- Keep worker code self-contained.
- Do not rely on variables from outer lexical scope.
- Pass helper functions explicitly when the worker needs them.
- Use trailing `helpers` only for raw injected snippets that cannot be expressed as normal helper functions.
- Call `finalize()` when the coroutine is no longer needed.

---

## When To Use `actor(...)` Instead

Use `actor(...)` when the worker needs:
- request/response with the main thread
- one-way worker-to-main events
- one-way main-to-worker messages
- worker-local concurrency primitives plus a main-thread bridge
- long-lived state that evolves over time

See [ACTORS.md](./ACTORS.md).
