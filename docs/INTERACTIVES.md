# Streamix Interactives

`interactive(...)` builds on the coroutine worker pool and adds a worker/main-thread bridge.

Use it when your worker needs both:
- local worker-side concurrency
- explicit messaging with the main thread

The worker receives two namespaces:

- `utils.concurrency`
- `utils.main`

## Worker-Side API

### `utils.concurrency`

Local coordination inside the worker runtime:

- `channel(...)`
- `recv(...)`
- `send(...)`
- `otherwise(...)`
- `select(...)`
- `background()`
- `withCancel(...)`
- `withTimeout(...)`
- `withDeadline(...)`

These are local primitives. They do not cross the worker boundary by themselves.

### `utils.main`

The worker/main-thread bridge:

- `utils.main.request(payload)`
- `utils.main.send(payload)`
- `utils.main.recv()`
- `utils.main.receive()`
- `utils.main.inbox`

This bridge is task-scoped for the currently running interactive task.

## Main-Thread API

### `request`

Handle worker request/response calls:

```ts
import { interactive } from "@epikodelabs/streamix/coroutines";

const worker = interactive({
  request: async (payload: { id: string }) => {
    return fetch(`/api/items/${payload.id}`).then((r) => r.json());
  },
})(async function task(input: string, utils) {
  return utils.main.request({ id: input });
});
```

### `onMessage`

Handle one-way worker-to-main messages:

```ts
const worker = interactive({
  onMessage: (payload) => {
    console.log("Worker message:", payload);
  },
})(async function task(_input: void, utils) {
  utils.main.send({ stage: "started" });
  return 1;
});
```

### `sendToWorker(...)`

Push main-thread messages into the active worker task:

```ts
const worker = interactive(async function task(_input: void, utils) {
  const message = await utils.main.recv();
  return message;
});

const { workerId } = await worker.getIdleWorker();
worker.returnWorker(workerId);

const pending = worker.processTask(undefined);
worker.sendToWorker(workerId, { command: "continue" });

const result = await pending;
```

## Full Example

```ts
import { interactive } from "@epikodelabs/streamix/coroutines";

const timer = interactive<
  { seconds: number },
  number,
  { id: string },
  { id: string; value: number },
  { command: "stop" }
>({
  request: async ({ id }) => ({ id, value: 10 }),
  onMessage: (payload) => {
    console.log("tick", payload);
  },
})(async function runTimer(input, utils) {
  const { channel, recv, send, select, otherwise } = utils.concurrency;
  const ticks = channel<number>(1);

  const data = await utils.main.request({ id: "seed" });
  await ticks.send(data.value);

  for (let remaining = input.seconds; remaining > 0; remaining--) {
    utils.main.send({ remaining });

    const winner = await select([
      recv(ticks, "tick"),
      recv(utils.main.inbox, "main"),
      otherwise("idle"),
    ]);

    if (winner.name === "main" && winner.value?.command === "stop") {
      return remaining;
    }

    if (winner.name === "tick") {
      await ticks.send(remaining - 1);
    }
  }

  return 0;
});
```

## Helpers

Interactive workers still support helper injection through `helpers`:

```ts
const worker = interactive({
  helpers: [
    "function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }",
  ],
})(function task(input, utils) {
  utils.main.send({ value: clamp(input, 0, 100) });
  return input;
});
```

Prefer normal positional helper functions when possible, and reserve config `helpers` for raw injected snippets.
The async worker bootstrap is injected internally by the library and is separate
from these user-facing `helpers`.

## Choosing Between `coroutine(...)` and `interactive(...)`

Use `coroutine(...)` when you only need background computation.

Use `interactive(...)` when the worker must:
- ask the main thread for data
- emit events to the main thread
- receive messages from the main thread
- coordinate multiple local worker flows while still talking to the host
