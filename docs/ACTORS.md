# Streamix Actors

`actor(...)` runs your code in a Web Worker and gives it two tools:

- `utils.main` — talk to the main thread (request data, send messages, receive commands)
- `utils.concurrency` — coordinate async work inside the worker (channels, select, timeouts)

Use it when your worker needs to **both** compute in the background **and** chat with the main thread.

---

## Basic Usage

### Ask main for data

The worker asks, the main thread fetches, the worker gets its answer.

```ts
const dogFinder = actor({
  request: async (breed) => {
    return fetch(`https://dog.ceo/api/breed/${breed}/images/random`)
      .then((r) => r.json());
  },
})(async function task(breed, utils) {
  const dog = await utils.main.request(breed);
  return dog.message; // URL of a very good boy
});

const photo = await dogFinder.processTask("corgi");
```

### Send one-way updates to main

The worker brags about its progress while the main thread listens.

```ts
const oven = actor({
  onMessage: (payload) => {
    console.log(`Cookies ${payload.status} (${payload.percent}%)`);
  },
})(async function bake(count, utils) {
  for (let i = 0; i <= count; i++) {
    utils.main.send({ status: "baking", percent: Math.round((i / count) * 100) });
    await new Promise((r) => setTimeout(r, 100));
  }
  utils.main.send({ status: "done", percent: 100 });
  return "🍪".repeat(count);
});
```

### Send commands from main to worker

The main thread steers the worker in real time.

```ts
const vacuum = actor(async function task(room, utils) {
  while (true) {
    const cmd = await utils.main.recv();
    if (cmd === "dock") return "docked";
    if (cmd === "panic") return "hiding under couch";
    // ...cleaning logic...
  }
});

const { workerId } = await vacuum.getIdleWorker();
const pending = vacuum.assignTask(workerId, "kitchen");

// Change your mind
vacuum.sendToWorker(workerId, "dock");

const result = await pending; // "docked"
vacuum.returnWorker(workerId);
```

---

## Full Example — Ramen Timer

The worker boils noodles, counts down, and listens for the chef to call it off.

```ts
const ramen = actor({
  request: async (flavor) => ({ flavor, minutes: flavor === "udon" ? 6 : 3 }),
  onMessage: (payload) => console.log(payload.stage),
})(async function cook(input, utils) {
  const { channel, recv, select, otherwise } = utils.concurrency;
  const ticks = channel<number>(1);

  // Ask main how long this noodle type needs
  const recipe = await utils.main.request(input.flavor);
  await ticks.send(recipe.minutes);

  for (let remaining = recipe.minutes; remaining > 0; remaining--) {
    utils.main.send({ stage: `boiling... ${remaining} min left` });

    // Wait for tick, a command from the chef, or just keep bubbling
    const winner = await select([
      recv(ticks, "tick"),
      recv(utils.main.inbox, "chef"),
      otherwise("bubble"),
    ]);

    // Chef says dinner is cancelled
    if (winner.name === "chef" && winner.value === "abort") {
      return "poured down the sink";
    }

    // Tick received — continue countdown
    if (winner.name === "tick") {
      await ticks.send(remaining - 1);
    }
  }

  return "slurp time";
});
```

Drive it from main:

```ts
const { workerId } = await ramen.getIdleWorker();
const pending = ramen.processTask({ flavor: "udon" });

// Oh no, forgot the guest is allergic
ramen.sendToWorker(workerId, "abort");

const result = await pending; // "poured down the sink"
ramen.returnWorker(workerId);
```

---

## Helpers

Inject raw snippets into the worker if you need them:

```ts
const worker = actor({
  helpers: [
    "function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }",
  ],
})(function task(input, utils) {
  utils.main.send({ value: clamp(input, 0, 100) });
  return input;
});
```

Prefer normal helper arguments when possible:

```ts
const worker = actor(async function task(input, utils, clamp) {
  return clamp(input, 0, 100);
}, clamp);
```

---

## `coroutine(...)` vs `actor(...)`

| Use `coroutine(...)` | Use `actor(...)` |
|----------------------|------------------------|
| Background computation only | Ask main for data |
| | Send events to main |
| | Receive commands from main |
| | Coordinate local worker flows |
