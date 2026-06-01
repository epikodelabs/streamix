# Streamix Actors

An actor is a long-lived worker that holds state and responds to messages — like a tiny server running in a background thread.

Think of it as a loop that receives messages one at a time, updates its own state, and optionally sends messages back. Unlike a regular function call, an actor keeps running between messages and remembers what happened before.

Use `actor(...)` when you need something that:
- **remembers things** across multiple messages (a counter, a queue, a connection)
- **receives messages** from the main thread over time
- **sends requests or results back** to the main thread or to other actors
- **coordinates its own async work** internally

For running a single task once and getting a result back, use `coroutine(...)` instead.

---

## How it works

Every actor has two sides: a **worker** (where state lives and messages are handled) and a **main-thread handle** (how you talk to it from your app).

Here's the picture:

```
your app (main thread)
    │
    │  send / request
    ▼
actor worker (background thread)
    │  behavior(msg, state, utils) → nextState
    │
    └─ can send messages back to main
```

1. You write a **behavior function** — a simple function that receives a message and the current state, and returns the new state.
2. `actor(...)` spins up a dedicated background worker running that behavior.
3. Every message you send gets processed in order. The returned state is saved and passed into the next call.

---

## Worker side — the behavior function

```ts
(msg, state, utils) => nextState
```

This is the only function you write. It runs inside the background worker.

| Parameter | What it is |
|---|---|
| `msg` | The incoming message. Bus messages look like `{ kind: "actor-bus", topic, payload }`. Request messages deliver the payload directly. |
| `state` | The actor's current state — whatever you returned last time (or `initialState` on the first call). |
| `utils` | Helper tools available only inside the worker (see below). |

**`utils` at a glance:**

| | What it does |
|---|---|
| `utils.outbox.send(to, topic, payload)` | Fire-and-forget message to another actor or `"main"` |
| `utils.outbox.request(to, topic, payload)` | Ask another actor or `"main"` for data and wait for the reply |
| `utils.inbox` | The actor's inbound stream — useful for background tasks running inside the worker |
| `utils.concurrency` | Channels, `select`, timeouts, cancellation — for coordinating work inside the worker |

---

## Main thread — the actor handle

After calling `actor(...)`, you get back a small handle. All messaging goes through `main`:

```ts
const counter = actor("counter", behavior, initialState);

main.outbox.send(counter, "inc", { n: 5 });    // fire-and-forget
const value = await main.outbox.request(counter, "inc", { n: 0 }); // ask and wait
```

**Sending messages:**

| | What it does |
|---|---|
| `main.outbox.send(to, topic, payload)` | Send a message, don't wait for a reply |
| `main.outbox.request(to, topic, payload)` | Send a message and `await` the response |
| `main.outbox.publish(topic, payload)` | Broadcast to every actor at once |
| `main.outbox.stop(actor)` | Shut the actor down and free its worker |

**Receiving messages from the actor:**

| | What it does |
|---|---|
| `main.inbox.subscribe(handler)` | Listen to all bus messages coming in |
| `main.inbox.subscribe(name, handler)` | Listen only to messages addressed to a specific name (e.g. `"main"`) |
| `main.inbox.clear()` | Remove all subscriptions |

---

## Basic example

```ts
import { actor, main } from "@epikodelabs/streamix/coroutines";

// Behavior: handle "inc" and "dec" messages, return new count
const counter = actor("counter", async (msg: any, state: number) => {
  if (msg.kind === "actor-bus" && msg.topic === "inc") return state + msg.payload.n;
  if (msg.kind === "actor-bus" && msg.topic === "dec") return state - msg.payload.n;
  return state;
}, 10); // initial state = 10

main.outbox.send(counter, "inc", { n: 5 }); // state → 15
main.outbox.send(counter, "dec", { n: 3 }); // state → 12

// request acts like a send, but also returns the new state
const value = await main.outbox.request(counter, "inc", { n: 0 }); // → 12
console.log(value); // 12

await main.outbox.stop(counter);
```

**Key things to notice:**
- The behavior just returns a number — no mutation, no side effects required.
- `send` is fire-and-forget. `request` waits for the next state to come back.
- `initialState` is `10`, so the first message starts from there.

---

## Calling back to the main thread

If the worker needs to fetch data or trigger something on the main thread, use `utils.outbox.request("main", ...)` paired with `registerActorRequestHandler`:

```ts
import { actor, main, registerActorRequestHandler } from "@epikodelabs/streamix/coroutines";

const fetcher = actor("fetcher",
  async (msg: any, state: number, utils) => {
    if (msg.kind === "actor-bus" && msg.topic === "fetch") {
      // Ask the main thread to do a fetch, then update state with the result
      const data = await utils.outbox.request("main", "fetch", msg.payload.url);
      return data.count;
    }
    return state;
  },
  0
);

// This runs on the main thread when the worker calls request("main", ...)
registerActorRequestHandler("main", async (_topic: string, url: string) => {
  const res = await fetch(url);
  return res.json();
});
```

The worker can't call `fetch` directly in all environments — this pattern lets the worker delegate that to the main thread cleanly.

---
