# Streamix Actors

`actor(...)` creates an **autonomous worker** that runs a persistent behavior loop. The worker eagerly initializes with state and processes messages via `post()` (fire-and-forget) or `ask()` (request-response).

Because workers are isolated, the behavior has no direct access to the main thread — instead, `utils` is injected as the third argument **inside the worker only**:

- `utils.outbox` — send messages **from worker to main**: `send(payload)` emits one-way events the main thread receives via `main.inbox.receive()`; `request(payload)` calls the main-thread `config.onRequest` handler and awaits the result.
- `utils.inbox` — a standalone channel **inside the worker** for internal coordination. It is *not* automatically wired to `actor.post()`; messages from main arrive as the behavior's `msg` argument.
- `utils.concurrency` — coordinate async work *inside the worker*: channels, select, contexts, and timeouts.

> **You cannot use `utils.inbox` or `utils.outbox` from the main thread.**
> On the main thread, use `actor.post()`, `actor.ask()`, and `actor.onMessage()` instead.

Use `actor(...)` when you need a **stateful, long-lived worker** that responds to messages over time. For one-shot background computation, use `coroutine(...)` instead.

---

## How it works

```
Main thread                              Worker
────────────────────────────             ────────────────────────────────────
                                          
const counter = actor(counterBehavior);   async function counterBehavior(msg, state, utils) {
                                            // update state
                                            return newState;
                                          }

const c = counter(0);                     let state = initialState;
                                          // behavior loop starts

c.post("inc");                  ───msg──► state = await counterBehavior("inc", state, utils);

const s = await c.ask("dec");   ◄─state── state = await counterBehavior("dec", state, utils);
                                          // return state
```

The **behavior function** is serialized and runs entirely inside the **worker**. It receives `(msg, state, utils)` and returns the new state. The `utils` parameter is the only way the worker can reach back to main.

The **config object** (`onRequest`, `onMessage`) is code that runs on the **main thread** and reacts to messages arriving from the worker.

---

## API

### Without config

```ts
const createActor = actor(behavior, ...helpers);
const actor = createActor(initialState);
```

### With config

```ts
const createActor = actor(config)(behavior, ...helpers);
const actor = createActor(initialState);
```

### Instance API

| Member | Type | Description |
|--------|------|-------------|
| Member | Type | Description |
|--------|------|-------------|
| `post(msg)` | method | Fire-and-forget message to the actor mailbox (received as `msg` in the behavior) |
| `ask(msg)` | method | Send a message and await the **updated state** |
| `stop()` | method | Stop the behavior loop |
| `finalize()` | method | Terminate the worker and release resources |
| `onMessage(handler)` | method | Subscribe to one-way messages sent from the worker via `utils.outbox.send()`; returns unsubscribe function |
| `running` | property | `true` while the behavior loop is active |

---

## Counter Example

```ts
import { actor, main } from "@epikodelabs/streamix/coroutines";

type Msg = { type: "inc"; n: number } | { type: "dec"; n: number };

const createCounter = actor(async (msg: Msg, state: number) => {
  if (msg.type === "inc") return state + msg.n;
  if (msg.type === "dec") return state - msg.n;
  return state;
});

const counter = createCounter(10);

main.outbox.send(counter, { type: "inc", n: 5 });
main.outbox.send(counter, { type: "dec", n: 3 });

const value = await main.outbox.ask(counter, { type: "inc", n: 0 });
console.log(value); // → 12

await counter.finalize();
```

### With helpers

```ts
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const createBoundedCounter = actor(async (msg: Msg, state: number, _utils, clampFn: typeof clamp) => {
  const next = msg.type === "inc" ? state + msg.n : state - msg.n;
  return clampFn(next, 0, 100);
}, clamp);

const counter = createBoundedCounter(50);
```

### With config

```ts
const createCounter = actor({
  onRequest: async (query: string) => {
    const res = await fetch(query);
    return res.json();
  },
  onMessage: (event) => console.log("Worker says:", event),
})(async (msg: Msg, state: number, utils) => {
  if (msg.type === "fetch") {
    const data = await utils.outbox.request(msg.query);
    return data.count;
  }
  return state;
});

const counter = createCounter(0);
```

---

## Kitchen Example

An actor that manages a pizza kitchen with multiple ovens, cancellations, and recipe lookups. Background oven workers capture state by reference so that `cancel` and `close` commands are visible immediately.

```ts
import { actor, WorkerUtils } from "@epikodelabs/streamix/coroutines";

type Order = { id: string; item: string; customer: string };
type Recipe = { item: string; ingredients: string[]; bakeMs: number };

type KitchenMessage =
  | { type: "runShift"; orders: Order[] }
  | { type: "cancel"; orderId: string }
  | { type: "close" };

type KitchenEvent =
  | { type: "started"; order: Order; oven: string }
  | { type: "ready"; order: Order; oven: string; price: number }
  | { type: "cancelled"; order: Order; reason: string; oven: string }
  | { type: "closed"; completed: number; cancelled: number; totalRevenue: number };

type KitchenState = {
  running: boolean;
  closing: boolean;
  cancelledIds: Set<string>;
  completedCount: number;
  cancelledCount: number;
  totalRevenue: number;
};

const kitchen = actor({
  onRequest: async (item: string): Promise<Recipe> => {
    return recipes.get(item) ?? { item, ingredients: [], bakeMs: 3000 };
  },
})(async function kitchenBehavior(
  msg: KitchenMessage,
  state: KitchenState,
  utils: WorkerUtils<string, Recipe, KitchenMessage, KitchenEvent>
) {
  const { channel, background, withTimeout } = utils.concurrency;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  if (msg.type === "runShift" && !state.running) {
    state.running = true;
    state.closing = false;
    state.completedCount = 0;
    state.cancelledCount = 0;
    state.totalRevenue = 0;
    state.cancelledIds.clear();

    const prices = new Map([
      ["Margherita", 12.99],
      ["Pepperoni", 14.99],
      ["Hawaiian", 13.99],
    ]);

    const orderQueue = channel<Order>(msg.orders.length);
    for (const order of msg.orders) orderQueue.trySend(order);
    orderQueue.close();

    const ovenWorker = async (ovenId: string) => {
      while (!state.closing) {
        const order = await orderQueue.receive();
        if (!order) break;

        if (state.cancelledIds.has(order.id)) {
          state.cancelledCount++;
          utils.outbox.send({ type: "cancelled", order, reason: "Customer changed mind", oven: ovenId });
          continue;
        }

        const recipe = await utils.outbox.request(order.item);
        utils.outbox.send({ type: "started", order, oven: ovenId });

        await sleep(recipe.bakeMs);

        const price = prices.get(order.item) ?? 10;
        state.totalRevenue += price;
        state.completedCount++;
        utils.outbox.send({ type: "ready", order, oven: ovenId, price });
      }
    };

    Promise.all([ovenWorker("Oven #1"), ovenWorker("Oven #2"), ovenWorker("Oven #3")]).then(() => {
      utils.outbox.send({
        type: "closed",
        completed: state.completedCount,
        cancelled: state.cancelledCount,
        totalRevenue: state.totalRevenue,
      });
      state.running = false;
    });
  }

  if (msg.type === "cancel") {
    state.cancelledIds.add(msg.orderId);
  }

  if (msg.type === "close") {
    state.closing = true;
  }

  return state;
})({
  running: false,
  closing: false,
  cancelledIds: new Set(),
  completedCount: 0,
  cancelledCount: 0,
  totalRevenue: 0,
});

kitchen.onMessage((event) => {
  if (event.type === "ready") console.log(`✅ ${event.order.item} ready!`);
});

kitchen.post({ type: "runShift", orders: morningOrders });
```

---

## `coroutine(...)` vs `actor(...)`

| | `coroutine(...)` | `actor(...)` |
|---|---|---|
| Runs in a Worker | ✓ | ✓ |
| One-shot task | ✓ | — |
| Stateful message loop | — | ✓ |
| Main-thread messaging | — | ✓ `main.outbox.send()` / `main.outbox.ask()` / `main.inbox.receive()` |
| Main-thread `request` handler | — | ✓ `utils.outbox.request(q)` |
| One-way events to main | — | ✓ `utils.outbox.send(payload)` |
| Worker-side channels & select | — | ✓ `utils.concurrency` |
| Worker model | Pool (SIMD) | Single dedicated worker |
