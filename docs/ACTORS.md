# Streamix Actors

`actor(...)` runs your task function inside a **Web Worker**. Because workers are isolated, the task has no direct access to the main thread — instead, `utils` is injected as the second argument and provides two bridges back:

- `utils.main` — communicate with the main thread: send one-way messages, make request/response calls, or receive commands sent from main.
- `utils.concurrency` — coordinate async work *inside the worker*: channels, select, contexts, and timeouts, all running in the worker scope.

Use `actor(...)` when your worker needs to **both** compute in the background **and** exchange data with the main thread. For pure background computation with no main-thread communication, use `coroutine(...)` instead.

---

## How it works

```
Main thread                            Worker
────────────────────────────           ────────────────────────────────────
actor({                                async function task(input, utils) {
  onRequest: (q) => ...,     ◄─ req ──   const data = await utils.main.request(q);
             (q) => ...,     ── res ─►    
  onMessage: (p) => ...,     ◄─ msg ──   utils.main.send({ progress: 50 });

})(task);                                // cmd arrives via utils.main.recv
actor.sendToWorker(id, cmd)  ── cmd ─►   const cmd = await utils.main.recv();              
                                       }
```

The **config object** (`onRequest`, `onMessage`) is code that runs on the **main thread** and reacts to messages arriving from the worker.

The **task function** is serialized and runs entirely inside the **worker**. The `utils` parameter is the only way it can reach back to main.

---

## Examples

### Ask main for data

The worker initiates a request; the main thread handles it and sends back a response. The `request` handler runs on the **main thread**.

```ts
// Main thread: `request` is called here when the worker calls utils.main.request(...)
const dogFinder = actor({
  request: async (breed: string) => {
    return fetch(`https://dog.ceo/api/breed/${breed}/images/random`)
      .then((r) => r.json());
  },
})(
  // Worker: task runs here
  async function task(breed: string, utils) {
    const dog = await utils.main.request(breed);
    return dog.message; // URL of a very good boy
  }
);

const photo = await dogFinder.processTask("corgi");
```

### Send one-way updates to main

The worker pushes progress events; `onMessage` receives them on the **main thread**.

```ts
// Main thread: `onMessage` is called here for each utils.main.send(...) from the worker
const oven = actor({
  onMessage: (payload: { status: string; percent: number }) => {
    console.log(`Cookies ${payload.status} (${payload.percent}%)`);
  },
})(
  // Worker: task runs here
  async function bake(count: number, utils) {
    for (let i = 0; i <= count; i++) {
      utils.main.send({ status: "baking", percent: Math.round((i / count) * 100) });
      await new Promise((r) => setTimeout(r, 100));
    }
    utils.main.send({ status: "done", percent: 100 });
    return "🍪".repeat(count);
  }
);
```

### Send commands from main to worker

`actor.sendToWorker(workerId, payload)` delivers a message from the **main thread** into the worker's inbox. The worker reads it with `utils.main.recv()`.

```ts
// Worker: task runs here; utils.main.recv() blocks until a message arrives from main
const vacuum = actor(async function task(room: string, utils) {
  while (true) {
    const cmd = await utils.main.recv();
    if (cmd === "dock") return "docked";
    if (cmd === "panic") return "hiding under couch";
    // ...cleaning logic...
  }
});

// Main thread: acquire a specific worker and steer it directly
const { workerId } = await vacuum.getIdleWorker();
const pending = vacuum.assignTask(workerId, "kitchen");

vacuum.sendToWorker(workerId, "dock"); // delivered to utils.main.recv() inside the worker

const result = await pending; // "docked"
vacuum.returnWorker(workerId);
```

---

## Full Example — Ramen Timer

The worker does all the cooking logic. It asks main for the recipe, pushes status updates, and listens for the chef to abort — all from inside the worker via `utils`.

```ts
// Main thread: config callbacks run here
const ramen = actor({
  request: async (flavor: string) => ({ flavor, minutes: flavor === "udon" ? 6 : 3 }),
  onMessage: (payload: { stage: string }) => console.log(payload.stage),
})(
  // Worker: task runs here
  async function cook(input: { flavor: string }, utils) {
    const { channel, recv, select, otherwise } = utils.concurrency; // worker-side concurrency
    const ticks = channel<number>(1);

    // Ask main for the recipe — handled by `request` on the main thread
    const recipe = await utils.main.request(input.flavor);
    await ticks.send(recipe.minutes);

    for (let remaining = recipe.minutes; remaining > 0; remaining--) {
      // Push a status update — handled by `onMessage` on the main thread
      utils.main.send({ stage: `boiling... ${remaining} min left` });

      const winner = await select([
        recv(ticks, "tick"),
        recv(utils.main.inbox, "chef"), // messages sent via actor.sendToWorker(...)
        otherwise("bubble"),
      ]);

      if (winner.name === "chef" && winner.value === "abort") {
        return "poured down the sink";
      }

      if (winner.name === "tick") {
        await ticks.send(remaining - 1);
      }
    }

    return "slurp time";
  }
);
```

Drive it from the main thread:

```ts
const { workerId } = await ramen.getIdleWorker();
const pending = ramen.assignTask(workerId, { flavor: "udon" });

// Send a command into the worker's inbox — received via utils.main.inbox / utils.main.recv()
ramen.sendToWorker(workerId, "abort");

const result = await pending; // "poured down the sink"
ramen.returnWorker(workerId);
```

---

## Injecting helpers into the worker

Because the task is serialized and sent to a worker, only code that is explicitly passed along is available inside it. Two ways to inject helpers:

**Pass as function arguments** (preferred — type-safe and tree-shaken):

```ts
const worker = actor(async function task(input: number, utils, clamp: typeof clamp) {
  return clamp(input, 0, 100);
}, clamp);
```

**Inject as raw strings** (for snippets that can't be serialized as functions):

```ts
const worker = actor({
  helpers: [
    "function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }",
  ],
})(function task(input: number, utils) {
  return clamp(input, 0, 100); // clamp is available in the worker scope
});
```

---

## `coroutine(...)` vs `actor(...)`

| | `coroutine(...)` | `actor(...)` |
|---|---|---|
| Runs in a Worker | ✓ | ✓ |
| Main-thread `request` handler | — | ✓ `utils.main.request(q)` |
| One-way events to main | — | ✓ `utils.main.send(payload)` |
| Receive commands from main | — | ✓ `utils.main.recv()` |
| Worker-side channels & select | — | ✓ `utils.concurrency` |