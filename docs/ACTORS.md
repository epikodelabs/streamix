# Streamix Actors

`actor(...)` creates a long-lived, stateful worker that runs a persistent behavior loop.

An actor owns one dedicated worker. It does not come from the compute pool, and it is not a coroutine with extra messaging layered on top.

Use `actor(...)` when you need:
- worker state that evolves over time
- messages sent from main to worker
- events or requests sent from worker back to main
- worker-local concurrency primitives such as channels, select, and cancellation

For one-shot or queued task execution on a single dedicated worker, use `coroutine(...)`. For pooled throughput across multiple workers, use `compute(...)`.

---

## Worker-side model

Your behavior runs inside the worker with the signature:

```ts
(msg, state, utils) => nextState
```

- `msg` is the message sent from the main thread.
- `state` is the actor's current state.
- `utils.outbox.send(payload)` emits a one-way message to the main thread.
- `utils.outbox.request(payload)` asks the main thread for data and awaits the reply.
- `utils.inbox` is a worker-local channel for internal coordination inside the actor.
- `utils.concurrency` exposes channels, `select`, timeouts, cancellation, and related helpers inside the worker.

`utils` exists only inside the worker. The main thread does not call it directly.

---

## Main-thread model

The actor instance itself is intentionally small:

| Member | Type | Description |
|---|---|---|
| `running` | property | `true` while the actor worker is running |
| `stop(reason?)` | method | Stop the behavior loop |
| `finalize()` | method | Terminate the worker and release resources |

Main-thread messaging goes through `main`:

| API | Description |
|---|---|
| `main.outbox.send(actor, msg)` | Fire-and-forget message to the actor |
| `main.outbox.request(actor, msg)` | Send a message and await the updated state |
| `main.inbox.receive(actor, handler)` | Subscribe to messages sent from the worker via `utils.outbox.send(...)` |
| `main.inbox.receive()` | Await the next message from any actor |

---

## How it works

```text
main thread -> actor message -> dedicated worker -> behavior(msg, state, utils) -> next state
```

1. You define a behavior function.
2. `actor(...)` serializes that behavior into a worker script.
3. One dedicated worker is created for the actor instance.
4. Messages from the main thread are fed into the behavior loop.
5. The behavior returns the next state.
6. Worker-originated events and requests flow back through `main`.

---

## API

### Without config

```ts
const createActor = actor(behavior, ...helpers);
const counter = createActor(initialState);
```

### With config

```ts
const createActor = actor(config)(behavior, ...helpers);
const counter = createActor(initialState);
```

`config` runs on the main thread and can contain:

- `onRequest`: handles `utils.outbox.request(...)` calls originating from the worker
- `onMessage`: receives one-way `utils.outbox.send(...)` traffic from the worker
- `helpers`: raw worker-side helper snippets

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

const value = await main.outbox.request<Msg, number>(counter, { type: "inc", n: 0 });
console.log(value); // 12

await counter.finalize();
```

### With helpers

```ts
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

const createBoundedCounter = actor(
  async function boundedCounter(msg: Msg, state: number) {
    const next = msg.type === "inc" ? state + msg.n : state - msg.n;
    return clamp(next, 0, 100);
  },
  clamp
);

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
  if ((msg as any).type === "fetch") {
    const data = await utils.outbox.request((msg as any).query);
    return data.count;
  }
  return state;
});

const counter = createCounter(0);
```

---

## Kitchen Example

An actor that manages a pizza kitchen with multiple internal oven tasks, cancellations, and recipe lookups. The actor itself still owns one dedicated worker; the extra coordination happens inside that worker through `utils.concurrency`.

```ts
import { actor, type WorkerUtils } from "@epikodelabs/streamix/coroutines";

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
  const { channel } = utils.concurrency;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
```

---

## `coroutine(...)` vs `actor(...)`

| | `coroutine(...)` | `actor(...)` |
|---|---|---|
| Runs in a Worker | yes | yes |
| Worker model | Single dedicated worker | Single dedicated worker |
| Pooled throughput | no | no |
| One-shot task processing | yes | no |
| Stateful message loop | no | yes |
| Main-thread messaging | no | yes via `main.outbox` / `main.inbox` |
| Worker-to-main request handler | no | yes via `utils.outbox.request(...)` |
| One-way events to main | no | yes via `utils.outbox.send(...)` |
| Worker-side channels and select | no | yes via `utils.concurrency` |

If you need pooled compute across multiple workers, use `compute(...)`.
