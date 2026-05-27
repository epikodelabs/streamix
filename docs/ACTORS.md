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
- `utils.bus.publish(topic, payload)` broadcasts to registered actors through the integrated actor bus.
- `utils.bus.send(to, topic, payload)` targets one or more registered actor ids through the bus.
- `utils.inbox` is a worker-local channel for internal coordination inside the actor.
- `utils.concurrency` exposes channels, `select`, timeouts, cancellation, and related helpers inside the worker.

`utils` exists only inside the worker. The main thread does not call it directly.

---

## Main-thread model

The actor instance itself is intentionally small:

| Member | Type | Description |
|---|---|---|
| `name` | property | Stable actor name used for direct addressing |
| `running` | property | `true` while the actor worker is running |

Main-thread messaging goes through `main`:

| API | Description |
|---|---|
| `main.outbox.send(actorOrName, msg)` | Fire-and-forget message to the actor |
| `main.outbox.request(actorOrName, msg)` | Send a message and await the updated state |
| `main.outbox.stop(actorOrName)` | Stop the actor and release its worker resources |
| `main.inbox.listen(actorOrName, handler)` | Subscribe to messages sent from the worker via `utils.outbox.send(...)` |
| `main.inbox.listen()` | Await the next message from any actor |
| `main.bus.publish(topic, payload)` | Broadcast to every named actor |
| `main.bus.send(to, topic, payload)` | Send a bus message to explicit actor ids |
| `main.bus.listen(...)` | Observe all bus traffic, or only direct messages sent to a name |

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

Bus traffic is routed separately from ordinary worker events. Messages emitted through `utils.bus` are handled by `main.bus`; they do not show up as `main.inbox.listen(actorOrName, handler)` events. The main thread participates in the bus under the reserved name `"main"`.

---

## API

### Without config

```ts
const createActor = actor(behavior, ...helpers);
const counter = createActor("counter", initialState);
```

### With config

```ts
const createActor = actor(config)(behavior, ...helpers);
const counter = createActor("counter", initialState);
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

const counter = createCounter("counter", 10);

main.outbox.send(counter, { type: "inc", n: 5 });
main.outbox.send(counter, { type: "dec", n: 3 });

const value = await main.outbox.request<Msg, number>(counter, { type: "inc", n: 0 });
console.log(value); // 12

await main.outbox.stop(counter);
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

const counter = createBoundedCounter("bounded-counter", 50);
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

const counter = createCounter("counter", 0);
```

---

## Actor Bus Example

```ts
import {
  actor,
  isActorBusMessage,
  main,
} from "@epikodelabs/streamix/coroutines";

type State = { received: string[] };

const createNode = actor((msg: unknown, state: State, utils) => {
  if (msg === "announce") {
    utils.bus.publish("chat", "hello");
    return state;
  }

  if (isActorBusMessage<string>(msg) && msg.topic === "chat") {
    return {
      received: [...state.received, msg.payload],
    };
  }

  return state;
});

const alpha = createNode("alpha", { received: [] });
const beta = createNode("beta", { received: [] });

main.bus.listen((message) => {
  console.log(message.from, message.payload);
});

main.outbox.send(alpha, "announce");
```

---

## Kitchen Example

A multi-actor kitchen with a cashier, a chef, and three oven coroutines. The cashier takes orders and forwards them to the chef via the actor bus. The chef requests recipes from the main thread, delegates baking to dedicated oven workers, and emits live events.

```ts
import { actor, coroutine, main } from "@epikodelabs/streamix/coroutines";

type Order = { id: string; item: string; customer: string };
type Recipe = { item: string; ingredients: string[]; bakeMs: number };

const recipes = new Map<string, Recipe>([
  ["Margherita", { item: "Margherita", ingredients: ["tomato", "mozzarella"], bakeMs: 3000 }],
  ["Pepperoni",  { item: "Pepperoni",  ingredients: ["tomato", "mozzarella", "pepperoni"], bakeMs: 3500 }],
]);

const prices = new Map<string, number>([
  ["Margherita", 12.99],
  ["Pepperoni", 14.99],
]);

// ===== OVEN COROUTINES =====
const ovens = [
  { id: "Oven #1", worker: coroutine(async (task: { order: Order; recipe: Recipe }) => {
    await new Promise(r => setTimeout(r, task.recipe.bakeMs));
    return task;
  }) },
  { id: "Oven #2", worker: coroutine(async (task: { order: Order; recipe: Recipe }) => {
    await new Promise(r => setTimeout(r, task.recipe.bakeMs));
    return task;
  }) },
  { id: "Oven #3", worker: coroutine(async (task: { order: Order; recipe: Recipe }) => {
    await new Promise(r => setTimeout(r, task.recipe.bakeMs));
    return task;
  }) },
];

// ===== CHEF ACTOR =====
const chef = actor({
  onRequest: async (payload: unknown) => {
    if (typeof payload === "string") return recipes.get(payload);

    const task = payload as { type: "bake"; order: Order; recipe: Recipe };
    if (task.type === "bake") {
      const oven = ovens.find(o => !o.busy);
      if (!oven) throw new Error("No free oven");
      oven.busy = true;
      try {
        await oven.worker.processTask({ order: task.order, recipe: task.recipe });
        return { ovenId: oven.id, price: prices.get(task.order.item) ?? 10 };
      } finally {
        oven.busy = false;
      }
    }
  },
})(async function chefBehavior(msg: any, state: any, utils: any) {
  if (msg.kind === "actor-bus" && msg.topic === "cook") {
    const order = msg.payload as Order;
    state.activeTasks = (state.activeTasks ?? 0) + 1;

    (async () => {
      const recipe = await utils.outbox.request(order.item);
      const result = await utils.outbox.request({ type: "bake", order, recipe });
      state.activeTasks--;
      utils.outbox.send({ type: "ready", order, oven: result.ovenId, price: result.price });
    })();
  }

  if (msg.kind === "actor-bus" && msg.topic === "close") {
    // When closing and no active tasks, emit closed event
  }

  return state;
})("chef", {});

// ===== CASHIER ACTOR =====
const cashier = actor(async function cashierBehavior(msg: any, state: any, utils: any) {
  if (msg.type === "runShift") {
    for (const order of msg.orders) utils.bus.send("chef", "cook", order);
    utils.bus.send("chef", "close", null);
  }
  if (msg.type === "cancel") utils.bus.send("chef", "cancel", msg.orderId);
  if (msg.type === "close") utils.bus.send("chef", "close", null);
  return state;
})("cashier", {});

// ===== MAIN THREAD =====
main.inbox.listen(chef, (event) => console.log("Kitchen event:", event));
main.outbox.send(cashier, { type: "runShift", orders: [
  { id: "1", item: "Margherita", customer: "Alice" },
  { id: "2", item: "Pepperoni",  customer: "Bob" },
] });
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
