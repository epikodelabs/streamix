# Streamix Coroutines

`@epikodelabs/streamix/coroutines` provides worker-backed operators for CPU-heavy work without blocking the main thread.

Use plain `coroutine(...)` when you need:
- background computation
- worker pooling
- direct task execution through `processTask(...)`
- stream integration through `compute(...)`
- persistent worker reuse through `hire(...)`

If you need worker/main-thread messaging, use `interactive(...)` instead. See [INTERACTIVES.md](./INTERACTIVES.md).

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

const worker = coroutine(function square(value: number) {
  return value * value;
});

const stream = from([1, 2, 3]).pipe(
  compute(worker, Promise.resolve(4))
);
```

### `hire(...)`

Keep one worker checked out for multiple sequential tasks:

```ts
import { hire, coroutine } from "@epikodelabs/streamix/coroutines";

const worker = coroutine(function multiply(value: number) {
  return value * 10;
});

const hired = await hire(worker, () => {}, () => {}).query();

try {
  const a = await hired.sendTask(1);
  const b = await hired.sendTask(2);
} finally {
  hired.release();
}
```

### `cascade(...)`

Chain coroutine stages:

```ts
import { cascade, coroutine } from "@epikodelabs/streamix/coroutines";

const decode = coroutine(function decode(input: string) {
  return JSON.parse(input);
});

const project = coroutine(function project(input: { value: number }) {
  return input.value;
});

const pipeline = cascade(decode, project);
const result = await pipeline.processTask('{"value":42}');
```

## Helpers

Coroutines still support helpers. There are two forms:

The library also injects its own internal async bootstrap for transpiled worker
code. That bootstrap is not the same thing as user-facing `helpers`.

### Positional helper functions

Use this when the helper is normal code you control:

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

Use this when you need to inject raw worker-side snippets:

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

## Rules

- Prefer `function` expressions for worker tasks and helper functions.
- Keep worker code self-contained.
- Do not rely on variables from outer lexical scope.
- Pass helper functions explicitly when the worker needs them.
- Use config `helpers` only for raw injected snippets that cannot be expressed as normal helper functions.

## When To Use `interactive(...)` Instead

Use `interactive(...)` when the worker needs:
- request/response with the main thread
- one-way worker-to-main events
- one-way main-to-worker messages
- worker-local concurrency primitives plus a main-thread bridge

See [INTERACTIVES.md](./INTERACTIVES.md).
