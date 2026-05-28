# Streamix Actors

`actor(...)` creates a long-lived, stateful worker that runs a persistent behavior loop.

An actor owns one dedicated worker. It does not come from the compute pool, and it is not a coroutine with extra messaging layered on top.

Use `actor(...)` when you need:
- worker state that evolves over time
- messages sent from main to worker
- requests or bus messages sent from worker back out
- worker-local concurrency primitives such as channels, select, and cancellation

For one-shot or queued task execution on a single dedicated worker, use `coroutine(...)`. For pooled throughput across multiple workers, use `compute(...)`.

---

## Worker-side model

Your behavior runs inside the worker with the signature:

```ts
(msg, state, utils) => nextState
```

- `msg` is the next message addressed to the actor. Messages sent via `main.outbox.send(...)` arrive as actor-bus envelopes (`{ kind: "actor-bus", topic, payload }`). Requests sent via `main.outbox.request(...)` deliver the raw payload.
- `state` is the actor's current state.
- `utils.outbox.request(name, topic, payload)` asks one named target for data and awaits the reply. Use `"main"` for the source actor's main-thread side.
- `utils.outbox.send(to, topic, payload)` targets one or more registered actor names through the bus. Use `"main"` to address the main thread.
- `utils.inbox` mirrors the actor's inbound message stream so worker-local background tasks can also listen to actor-bound messages.
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
| `main.outbox.send(to, topic, payload)` | Fire-and-forget bus message to one or more targets |
| `main.outbox.request(to, topic, payload)` | Send a request and await the response |
| `main.outbox.publish(topic, payload)` | Broadcast a bus message to every named actor |
| `main.outbox.stop(actorOrName)` | Stop the actor and release its worker resources |
| `main.inbox.subscribe(handler)` | Subscribe to all actor-bus messages |
| `main.inbox.subscribe(name, handler)` | Subscribe to bus messages addressed to a specific name, including `"main"` |
| `main.inbox.clear()` | Clear all bus subscriptions |

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
6. Worker-originated requests and direct bus messages flow back through `main`.

Messages emitted through `utils.outbox.send(name, topic, payload)` are routed as actor-bus messages. On the main thread you can broadcast through `main.outbox.publish(...)`. The main thread participates in the bus under the reserved name `"main"`.

---

## API

### Basic

```ts
const counter = actor("counter", behavior, initialState);
```

### With helpers

Helper functions passed after `initialState` are serialized into the worker.

```ts
const counter = actor("counter", behavior, initialState, helper1, helper2);
```

### With request handler

Worker requests made via `utils.outbox.request("main", topic, payload)` are handled on the main thread through the request-handler registry:

```ts
import { actor, main, registerActorRequestHandler } from "@epikodelabs/streamix/coroutines";

const counter = actor("counter", behavior, initialState);

registerActorRequestHandler("main", async (topic, payload) => {
  // handle worker requests here
});
```

---

## Counter Example

```ts
import { actor, main } from "@epikodelabs/streamix/coroutines";

const counter = actor("counter", async (msg: any, state: number) => {
  if (msg.kind === "actor-bus" && msg.topic === "inc") return state + msg.payload.n;
  if (msg.kind === "actor-bus" && msg.topic === "dec") return state - msg.payload.n;
  return state;
}, 10);

main.outbox.send(counter, "inc", { n: 5 });
main.outbox.send(counter, "dec", { n: 3 });

const value = await main.outbox.request(counter, "inc", { n: 0 });
console.log(value); // 12

await main.outbox.stop(counter);
```

### With helpers

```ts
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

const counter = actor("bounded-counter",
  async function boundedCounter(msg: any, state: number) {
    const n = msg.kind === "actor-bus" ? msg.payload.n : 0;
    const next = msg.topic === "inc" ? state + n : state - n;
    return clamp(next, 0, 100);
  },
  50,
  clamp
);
```

### With request handler

```ts
const counter = actor("counter",
  async (msg: any, state: number, utils) => {
    if (msg.kind === "actor-bus" && msg.topic === "fetch") {
      const data = await utils.outbox.request("main", "fetch", msg.payload.query);
      return data.count;
    }
    return state;
  },
  0
);

registerActorRequestHandler("main", async (_topic: string, query: string) => {
  const res = await fetch(query);
  return res.json();
});
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

const alpha = actor("alpha", (msg: unknown, state: State, utils) => {
  if (isActorBusMessage<string>(msg) && msg.topic === "announce") {
    utils.outbox.send("beta", "chat", "hello");
    return state;
  }

  if (isActorBusMessage<string>(msg) && msg.topic === "chat") {
    return {
      received: [...state.received, msg.payload],
    };
  }

  return state;
}, { received: [] });

const beta = actor("beta", (msg: unknown, state: State, utils) => {
  if (isActorBusMessage<string>(msg) && msg.topic === "announce") {
    utils.outbox.send("beta", "chat", "hello");
    return state;
  }

  if (isActorBusMessage<string>(msg) && msg.topic === "chat") {
    return {
      received: [...state.received, msg.payload],
    };
  }

  return state;
}, { received: [] });

main.inbox.subscribe((message) => {
  console.log(message.from, message.payload);
});

main.outbox.send(alpha, "announce", undefined);
```

---

## Kitchen Example

A multi-actor kitchen with a cashier, a chef, and three oven coroutines. The cashier takes orders and forwards them to the chef via the actor bus. The chef requests recipes from the main thread, delegates baking to dedicated oven workers, and emits live events.

```ts
import { actor, coroutine, main, registerActorRequestHandler } from "@epikodelabs/streamix/coroutines";

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
const chef = actor("chef", async function chef(msg: any, state: any, utils: any) {
  if (msg.kind === "actor-bus" && msg.topic === "cook") {
    const order = msg.payload as Order;
    state.activeTasks = (state.activeTasks ?? 0) + 1;

    (async () => {
      const recipe = await utils.outbox.request("main", "recipe", order.item);
      const result = await utils.outbox.request("main", "bake", { order, recipe });
      state.activeTasks--;
      utils.outbox.send("main", "ready", { order, oven: result.ovenId, price: result.price });
    })();
  }

  if (msg.kind === "actor-bus" && msg.topic === "close") {
    // When closing and no active tasks, emit closed event
  }

  return state;
}, {});

registerActorRequestHandler("main", async (topic: string, payload: unknown) => {
  if (topic === "recipe" && typeof payload === "string") return recipes.get(payload);

  const task = payload as { order: Order; recipe: Recipe };
  if (topic === "bake") {
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
});

// ===== CASHIER ACTOR =====
const cashier = actor("cashier", async function cashier(msg: any, state: any, utils: any) {
  if (msg.kind === "actor-bus" && msg.topic === "runShift") {
    for (const order of msg.payload.orders) utils.outbox.send("chef", "cook", order);
    utils.outbox.send("chef", "close", null);
  }
  if (msg.kind === "actor-bus" && msg.topic === "cancel") {
    utils.outbox.send("chef", "cancel", msg.payload);
  }
  if (msg.kind === "actor-bus" && msg.topic === "close") {
    utils.outbox.send("chef", "close", null);
  }
  return state;
}, {});

// ===== MAIN THREAD =====
main.inbox.subscribe((message) => {
  if (message.topic === "ready") {
    console.log("Kitchen event:", message.payload);
  }
});
main.outbox.send(cashier, "runShift", { orders: [
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
| Worker-to-main request handler | no | yes via `utils.outbox.request("main", topic, payload)` |
| Direct messages to main | no | yes via `utils.outbox.send("main", topic, payload)` |
| Worker-side channels and select | no | yes via `utils.concurrency` |

If you need pooled compute across multiple workers, use `compute(...)`.
