# Streamix Actors

`actor(...)` runs your task function inside a **dedicated Web Worker**. Because workers are isolated, the task has no direct access to the main thread — instead, `utils` is injected as the second argument and provides two bridges back:

- `utils.main` — communicate with the main thread: send one-way messages, make request/response calls, or receive commands sent from main.
- `utils.concurrency` — coordinate async work *inside the worker*: channels, select, contexts, and timeouts, all running in the worker scope.

Use `actor(...)` when your worker needs to **both** compute in the background **and** exchange data with the main thread. For pure background computation with no main-thread communication, use `coroutine(...)` instead.

---

## How it works

```
Main thread                              Worker
────────────────────────────             ────────────────────────────────────
                                         async function task(input, utils) {
const ref = actor({                        const data = await utils.main.request(q);
  onRequest: async (q) => {    ◄──req──
    return fetch(...);          ──res──►
  },
  onMessage: (p) => {          ◄──msg──  utils.main.send({ progress: 50 });
    console.log(p);
  },
})(task);

const result =                 ◄─done──  return result;
  await ref.start(data);       ──data──► // input arrives as argument

ref.send(cmd);                 ──cmd───► const cmd = await utils.main.receive();
                                         }
```

The **config object** (`onRequest`, `onMessage`) is code that runs on the **main thread** and reacts to messages arriving from the worker.

The **task function** is serialized and runs entirely inside the **worker**. The `utils` parameter is the only way it can reach back to main.

---

## Pizza Kitchen Example

This example intentionally uses **actors**, not plain coroutines.

A plain coroutine is like a line cook who takes one order, silently makes the pizza, and hands it over. Done. No talking. No drama.  

An **actor** is a real chef with personality: they stay in the kitchen for the whole shift, yell for ingredients, complain about customers, update you on progress, throw a fit when cancelled, and only clock out when the kitchen is clean.

### In this pizza example:

- `actor(...)` → hires the dramatic chef  
- `utils.main.inbox` → the chef’s earpiece for manager/customer complaints  
- `utils.main.request(...)` → “Hey boss, what’s the gluten-free dough again?!”  
- `utils.main.send(...)` → live gossip from the kitchen (“Margherita is on fire… literally”)  
- `select(...)` → the chef’s chaotic multitasking brain, constantly deciding what to handle next

Actors turn your workers into **interactive, responsive, cancel-friendly kitchen stars** instead of silent one-and-done robots.  

Perfect when your concurrency needs personality. 🍕
No shared state. Just professional (but dramatic) chefs doing their job.

### Full Chef Actor

```ts
import { actor, WorkerUtils, type Channel } from "@epikodelabs/streamix/coroutines";

// Browser-compatible (console only, no DOM)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Types
type Order = { id: string; item: string; customer: string };
type Recipe = { item: string; ingredients: string[]; bakeMs: number };
type KitchenCommand = { type: "cancel"; orderId: string } | { type: "close" };
type KitchenEvent =
  | { type: "started"; order: Order; oven: string }
  | { type: "stage"; order: Order; stage: string; oven: string }
  | { type: "ready"; order: Order; oven: string }
  | { type: "cancelled"; order: Order; reason: string; oven: string }
  | { type: "timeout"; order: Order; oven: string }
  | { type: "closed"; completed: number; cancelled: number; totalRevenue: number };

// Recipe database
const recipes = new Map<string, Recipe>([
  ["Margherita", { item: "Margherita", ingredients: ["tomato", "mozzarella", "basil"], bakeMs: 3000 }],
  ["Pepperoni", { item: "Pepperoni", ingredients: ["tomato", "mozzarella", "pepperoni"], bakeMs: 3500 }],
  ["Hawaiian", { item: "Hawaiian", ingredients: ["tomato", "mozzarella", "ham", "pineapple"], bakeMs: 3200 }],
  ["Quattro Formaggi", { item: "Quattro Formaggi", ingredients: ["mozzarella", "gorgonzola", "parmesan", "ricotta"], bakeMs: 2800 }],
  ["Diavola", { item: "Diavola", ingredients: ["tomato", "mozzarella", "spicy salami", "chili"], bakeMs: 3800 }]
]);

// Head Chef Actor
const headChef = actor<string, Recipe, KitchenEvent, KitchenCommand>({
  onRequest: async (item: string): Promise<Recipe> => {
    console.log(`  📋 [Manager] Looking up recipe for ${item}...`);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const recipe = recipes.get(item);
        if (!recipe) reject(new Error(`No recipe for ${item}`));
        else resolve(recipe);
      }, 500);
    });
  },
})(
  async function kitchenShift(input: { orders: Order[] }, utils: WorkerUtils<string, Recipe, KitchenCommand, KitchenEvent>) {
    const { channel, background, withTimeout } = utils.concurrency;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    // Prices must live inside the worker — closures are not serialized across the worker boundary
    const prices = new Map<string, number>([
      ["Margherita", 12.99],
      ["Pepperoni", 14.99],
      ["Hawaiian", 13.99],
      ["Quattro Formaggi", 15.99],
      ["Diavola", 16.99]
    ]);

    // ---- Shared state ----
    let totalRevenue = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    let closing = false;
    const cancelledIds = new Set<string>();

    // ---- Channels ----
    const orderQueue = channel<Order>(input.orders.length);
    const cmdChannel = channel<KitchenCommand>(10);

    for (const order of input.orders) {
      orderQueue.trySend(order);
    }
    orderQueue.close();

    // ---- Command forwarder ----
    // Reads commands from main thread and forwards them into cmdChannel
    // so the rest of the worker can select/recv from a local channel.
    const commandForwarder = async () => {
      while (!closing) {
        const cmd = await utils.main.receive();
        if (!cmd) break;
        await cmdChannel.send(cmd);
        if (cmd.type === "close") break;
      }
    };

    // ---- Oven worker ----
    // Each oven is a concurrent task inside the actor worker.
    // It pulls orders from the shared queue and bakes them stage-by-stage.
    const ovenWorker = async (ovenId: string) => {
      while (!closing) {
        // Short-timeout receive so we stay responsive to the closing flag
        const [pollCtx, pollCancel] = withTimeout(background(), 100);
        let order: Order | undefined;
        try {
          order = await orderQueue.receive(pollCtx.signal);
        } catch {
          // timeout — loop around and check closing
        } finally {
          pollCancel();
        }

        if (!order) {
          if (orderQueue.closed) break;
          continue;
        }

        if (closing) break;

        // Pre-check cancellation
        if (cancelledIds.has(order.id)) {
          cancelledCount++;
          utils.main.send({ type: "cancelled", order, reason: "Customer changed mind", oven: ovenId });
          continue;
        }

        // Fetch recipe from main thread
        const recipe = await utils.main.request(order.item);

        utils.main.send({ type: "started", order, oven: ovenId });

        // Bake stage by stage
        const stages = [
          { name: "🥣 Preparing dough", ms: recipe.bakeMs / 3 },
          { name: "🔥 Baking in oven", ms: recipe.bakeMs / 3 },
          { name: "✨ Finishing touches", ms: recipe.bakeMs / 3 },
        ];

        let wasCancelled = false;

        for (const stage of stages) {
          utils.main.send({ type: "stage", order, stage: stage.name, oven: ovenId });

          // Wait stage duration while polling for cancellation
          const deadline = Date.now() + stage.ms;
          while (Date.now() < deadline) {
            if (cancelledIds.has(order.id)) {
              wasCancelled = true;
              break;
            }
            await sleep(Math.min(50, deadline - Date.now()));
          }

          if (wasCancelled) break;
        }

        if (wasCancelled) {
          cancelledCount++;
          utils.main.send({ type: "cancelled", order, reason: "Customer changed mind", oven: ovenId });
          continue;
        }

        // Done!
        const price = prices.get(order.item) ?? 10;
        totalRevenue += price;
        completedCount++;
        utils.main.send({ type: "ready", order, oven: ovenId, price });
      }
    };

    // ---- Command processor ----
    // Reads the local command channel and updates shared state.
    const commandProcessor = async () => {
      while (!closing) {
        const [pollCtx, pollCancel] = withTimeout(background(), 100);
        let cmd: KitchenCommand | undefined;
        try {
          cmd = await cmdChannel.receive(pollCtx.signal);
        } catch {
          // timeout
        } finally {
          pollCancel();
        }

        if (!cmd) continue;

        if (cmd.type === "cancel") {
          cancelledIds.add(cmd.orderId);
        }

        if (cmd.type === "close") {
          closing = true;
          break;
        }
      }
    };

    // ---- Run everything concurrently ----
    const forwarder = commandForwarder();
    const processor = commandProcessor();
    const ovens = Promise.all([
      ovenWorker("Oven #1"),
      ovenWorker("Oven #2"),
      ovenWorker("Oven #3"),
    ]);

    // Processor drives shutdown; ovens finish their current pizzas.
    await processor;
    await ovens;
    await forwarder.catch(() => {});

    cmdChannel.close();

    // Report final stats
    utils.main.send({
      type: "closed",
      completed: completedCount,
      cancelled: cancelledCount,
      totalRevenue,
    });

    return { completed: completedCount, cancelled: cancelledCount, totalRevenue };
  }
);

// ========== CONSOLE SIMULATION ==========

async function runFullDay() {
  console.clear();
  console.log("\n" + "=".repeat(70));
  console.log("🍕 STREAMIX PIZZA - FULL WORKING DAY (Browser Console) 🍕");
  console.log("=".repeat(70) + "\n");

  let totalDailyRevenue = 0;
  const timeouts: ReturnType<typeof setTimeout>[] = [];

  // Setup event listener for the whole day
  const unsubscribe = headChef.onMessage((event: KitchenEvent) => {
    const time = new Date().toLocaleTimeString();

    switch (event.type) {
      case "started":
        console.log(`  🍳 [${time}] Started: ${event.order.item} for ${event.order.customer} (${event.oven})`);
        break;

      case "stage":
        console.log(`     📍 ${event.stage} - ${event.order.item} (${event.order.customer})`);
        break;

      case "ready":
        console.log(`  ✅ [${time}] READY! ${event.order.item} for ${event.order.customer} 🍕 (${event.oven})`);
        break;

      case "cancelled":
        console.log(`  ❌ [${time}] CANCELLED: ${event.order.item} for ${event.order.customer} - ${event.reason}`);
        break;

      case "timeout":
        console.log(`  ⏰ [${time}] TIMEOUT: ${event.order.item} got burnt! 😱`);
        break;

      case "closed":
        console.log(`\n  🏁 Shift completed!`);
        console.log(`     ✅ Completed: ${event.completed} pizzas`);
        console.log(`     ❌ Cancelled: ${event.cancelled} pizzas`);
        console.log(`     💰 Revenue: $${event.totalRevenue.toFixed(2)}\n`);
        totalDailyRevenue += event.totalRevenue;
        break;
    }
  });

  try {
    // ===== MORNING SHIFT =====
    console.log("🌅 MORNING SHIFT (9:00 AM - Slow start)");
    console.log("-".repeat(50));

    const morningOrders: Order[] = [
      { id: "M1", item: "Margherita", customer: "John" },
      { id: "M2", item: "Pepperoni", customer: "Sarah" },
      { id: "M3", item: "Hawaiian", customer: "Mike" },
    ];

    await headChef.start({ orders: morningOrders });
    await delay(1000);

    // ===== LUNCH RUSH =====
    console.log("\n🌞 LUNCH RUSH (12:00 PM - Getting busy)");
    console.log("-".repeat(50));

    const lunchOrders: Order[] = [
      { id: "L1", item: "Quattro Formaggi", customer: "Emma" },
      { id: "L2", item: "Diavola", customer: "Luca" },
      { id: "L3", item: "Margherita", customer: "Sophia" },
      { id: "L4", item: "Pepperoni", customer: "Oliver" },
    ];

    const lunchShift = headChef.start({ orders: lunchOrders });

    // Drama during lunch
    timeouts.push(setTimeout(() => {
      console.log(`\n  📞 [${new Date().toLocaleTimeString()}] PHONE: Customer wants to cancel Diavola (too spicy!) 🌶️`);
      headChef.send({ type: "cancel", orderId: "L2" });
    }, 4000));

    timeouts.push(setTimeout(() => {
      console.log(`\n  📞 [${new Date().toLocaleTimeString()}] PHONE: Delivery driver cancelled Pepperoni order!`);
      headChef.send({ type: "cancel", orderId: "L4" });
    }, 8000));

    await lunchShift;
    timeouts.forEach(clearTimeout);
    timeouts.length = 0;
    await delay(1000);

    // ===== AFTERNOON =====
    console.log("\n🌤️ AFTERNOON (2:00 PM - Quiet period)");
    console.log("-".repeat(50));

    const afternoonOrders: Order[] = [
      { id: "A1", item: "Hawaiian", customer: "Isabella (Takeout)" },
      { id: "A2", item: "Diavola", customer: "Ethan (Delivery)" },
    ];

    await headChef.start({ orders: afternoonOrders });
    await delay(1000);

    // ===== EVENING CHAOS =====
    console.log("\n🌙 EVENING RUSH (6:00 PM - Full chaos mode)");
    console.log("-".repeat(50));

    const eveningOrders: Order[] = [
      { id: "E1", item: "Diavola", customer: "Marco (Regular)" },
      { id: "E2", item: "Quattro Formaggi", customer: "Giulia" },
      { id: "E3", item: "Pepperoni", customer: "Antonio" },
      { id: "E4", item: "Margherita", customer: "Francesca" },
      { id: "E5", item: "Hawaiian", customer: "Roberto" },
    ];

    const eveningShift = headChef.start({ orders: eveningOrders });

    // Evening drama
    timeouts.push(setTimeout(() => {
      console.log(`\n  😤 [${new Date().toLocaleTimeString()}] Marco: "Where's my pizza?! I'm leaving!"`);
      headChef.send({ type: "cancel", orderId: "E1" });
    }, 5000));

    timeouts.push(setTimeout(() => {
      console.log(`\n  🎂 [${new Date().toLocaleTimeString()}] Roberto: "Birthday party is leaving! Cancel Hawaiian!"`);
      headChef.send({ type: "cancel", orderId: "E5" });
    }, 10000));

    timeouts.push(setTimeout(() => {
      console.log(`\n  🚨 [${new Date().toLocaleTimeString()}] FIRE MARSHAL: Kitchen inspection! Close immediately!`);
      headChef.send({ type: "close" });
    }, 18000));

    await eveningShift;
    timeouts.forEach(clearTimeout);
    timeouts.length = 0;

    // ===== FINAL REPORT =====
    console.log("\n" + "=".repeat(70));
    console.log("📊 STREAMIX PIZZA - END OF DAY REPORT");
    console.log("=".repeat(70));
    console.log(`
  📈 STATISTICS:

  Morning Shift:     3 pizzas (smooth sailing)
  Lunch Rush:        4 pizzas (2 cancellations 😤)
  Afternoon:         2 pizzas (quiet)
  Evening Chaos:     5 pizzas (early closure 🚨)

  ─────────────────────────────────────────
  📊 TOTAL:          14 pizzas ordered
  💰 REVENUE:        $${totalDailyRevenue.toFixed(2)}

  🎭 ACTOR PATTERNS DEMONSTRATED:
  • Multiple concurrent pizzas (3 ovens)
  • Mid-cooking cancellations
  • Graceful shutdown with active orders
  • Request/response for recipes
  • Event streaming to console
  • Load balancing across resources

  👨‍🍳 Head Chef actor successfully managed all chaos!
  🍕 Streamix: Where actors bring personality to concurrency!
    `);
    console.log("=".repeat(70) + "\n");
  } finally {
    unsubscribe();
    timeouts.forEach(clearTimeout);
    await headChef.finalize();
  }
}


describe("actor", () => {
  it("should run the full day simulation without errors", async () => {
    await runFullDay().catch(err => {
      console.error("Simulation failed with error:", err);
      throw err;
    });
  }, 60000);
});
```

### Key Patterns

| Goal                    | Chef Behavior                      | Code Pattern                     |
|------------------------|------------------------------------|----------------------------------|
| Juggle multiple things | Orders + commands + timers         | `select` with `receive`          |
| Load balance ovens     | First available oven wins          | `send` cases in `select`         |
| Handle mid-bake cancel | React to inbox instantly           | Inner `select` + cmd check       |
| Timeout safety         | Per-stage & shift deadlines        | `withTimeout`                    |
| Ask for recipe         | Request from manager               | `utils.main.request()`           |
| Graceful end           | Drain queue or "close" command     | `!ok` + `otherwise("idle")`      |

Actors = autonomous chefs. `select` = their fast decision-making brain. Clean, responsive, and fun to manage. 🍕

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
| Receive commands from main | — | ✓ `utils.main.receive()` |
| Worker-side channels & select | — | ✓ `utils.concurrency` |
| Worker model | Pool (SIMD) | Single dedicated worker |
