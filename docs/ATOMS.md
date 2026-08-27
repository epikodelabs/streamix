# Atoms and Scopes

Atoms are **streamix**'s primitive for live, reactive values. The `atom()`, `derived()`, and `flow()` functions all produce individual atoms. **Scopes** organize these atoms into disposable, reactive object graphs with computed fields, methods, and lifecycle boundaries.

---

## 1. Atoms in Depth

An atom is a reactive value that you can read from synchronously, subscribe to for updates, consume as an async iterable, or pipe through operators.

### The Core Atom Interface

Every atom—whether created via `atom`, `derived`, `flow`, or `pipe`—implements this base interface:

```ts
interface Atom<T> {
  readonly value: T;         // Current value (throws on pending error/disposal)
  readonly safeValue: T;     // Last successful value (never throws)
  readonly previous: T | undefined;
  readonly disposed: boolean;
  readonly error?: any;
  subscribe(callback: (value: T) => void): Subscription;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

```

> **Note:** Writable atoms extend this base interface with mutation methods like `.next(value)`, `.set(value)`, and `.fail(error)`.

---

### Three Core Atom Types

#### A. Writable Atoms (`atom`)

These are your primary state sources, holding a single piece of mutable state.

```ts
const count = atom(0);
count.next(42);
console.log(count.value); // 42

```

* **Tip:** Pass `{ discrete: true }` in the options if you need every update (even duplicate values) to fire notifications to subscribers. This is perfect for event streams.

#### B. Derived Atoms (`derived`)

These represent computed values that automatically recalculate when their dependencies update:

```ts
const fullName = derived($ => `${$(firstName)} ${$(lastName)}`);

```

The `$` helper tracks dependencies dynamically.

> `derived()` is intentionally synchronous. If the computation needs `await`, cancellation, or restart semantics, move that work into `flow()`.

#### C. Flow Atoms (`flow`)

Designed for async generators, standard iterables, or stream factories. Flows respect cooperative cancellation via an `AbortSignal` and tie their cleanup directly to atom disposal.

```ts
const ticks = flow(async function* (signal) {
  while (!signal?.aborted) {
    yield Date.now();
    await sleep(1000);
  }
});

```

For one-shot async recomputation, model it as a flow explicitly:

```ts
const total = flow(async function* () {
  const rates = await loadRates();
  yield price.value * rates.tax + tax.value;
});
```
---

## 1. The Standard Scope Blueprint

In everyday development, almost every scope you build will follow this standard structural layout:

```ts
import { scope, method } from "@epikodelabs/streamix";

const taskManager = scope({
  // 1. Core State (Writable Atoms)
  filter: "all" as "all" | "completed" | "active",
  tasks: [
    { id: 1, text: "Buy milk", done: false },
    { id: 2, text: "Write docs", done: true },
  ],

  // 2. Computed State (Derived Atoms)
  // Standard computed values receive 'self' as their first argument.
  visibleTasks: (self) => {
    if (self.filter === "completed") return self.tasks.filter(t => t.done);
    if (self.filter === "active") return self.tasks.filter(t => !t.done);
    return self.tasks;
  },

  stats: (self) => {
    const total = self.tasks.length;
    const completed = self.tasks.filter(t => t.done).length;
    return { total, completed, remaining: total - completed };
  },

  // 3. Actions / Mutations (Imperative Methods)
  // Always wrap functions that mutate state in `method()` to keep them non-reactive.
  toggleTask: method((self, id: number) => {
    self.tasks = self.tasks.map(t => 
      t.id === id ? { ...t, done: !t.done } : t
    );
  }),

  addTask: method((self, text: string) => {
    const newId = self.tasks.length + 1;
    self.tasks = [...self.tasks, { id: newId, text, done: false }];
  })
});

```

### Understanding the Compiled Output:

* **Direct Read/Write (`taskManager.filter`)**: Accessing a property retrieves the current value. Assigning a new value (e.g., `taskManager.filter = "active"`) automatically pushes the update through the reactive system.
* **Dependency Tracking (`taskManager.visibleTasks`)**: Whenever `taskManager.filter` or `taskManager.tasks` is updated, `visibleTasks` automatically recalculates. You read it like a plain property: `console.log(taskManager.visibleTasks)`.
* **Action Execution (`taskManager.addTask("...")`)**: Methods are called as standard imperative functions to safely execute side effects and mutations.

---

## 2. Crucial Best Practices for Daily Development

To keep your scopes predictable, highly performant, and bug-free, follow these core guidelines:

### Rule A: Treat All State as Immutable

When updating arrays or objects inside a scope's methods, **always reassign the property** instead of mutating the existing reference.

```ts
// ❌ WRONG: Mutating the array directly avoids the setter proxy. 
// Subscriptions and computed dependencies will NOT trigger!
taskManager.tasks.push({ id: 3, text: "New Task", done: false }); 

// ✅ CORRECT: Always assign a new reference
taskManager.tasks = [...taskManager.tasks, { id: 3, text: "New Task", done: false }];

```

### Rule B: Only Mutate State Inside Methods

Never mutate writable state inside a derived property (the computed formulas). Formulas must remain **pure, side-effect-free functions** that only read and compute data.

```ts
// ❌ WRONG: Writing to state inside a computed formula causes infinite update loops!
const badScope = scope({
  count: 0,
  doubled: (self) => {
    self.count = self.count + 1; // Pure chaos
    return self.count * 2;
  }
});

```

### Rule C: Use `.at` Only When You Need streamix Stream APIs

For standard data access in UI templates or basic business logic, read and write values directly. Only use the `.at` namespace when you need access to the underlying streamix `Atom` instance (e.g., to manually subscribe or pipe operators).

```ts
// Reading the resolved value (Standard)
console.log(taskManager.visibleTasks); 

// Accessing the underlying reactive Atom (For subscribing / stream operations)
const subscription = taskManager.at.visibleTasks.subscribe(tasks => {
  console.log("Tasks updated:", tasks);
});

```

---

## 3. Common Pitfalls & Traps

Beyond losing the execution context with the standard `this` keyword, watch out for these typical scoping mistakes:

### Trap #1: Defining "Dead" Non-Reactive Properties

If you write a standard function in your blueprint without wrapping it in `method()`, or if you don't accept `self` as the first argument, streamix won't know how to compile it. It will treat it as a static property.

```ts
// ❌ WRONG: Compiled as a static action on load. This will NOT reactively track 'query'.
const searchScope = scope({
  query: "",
  results() {
    return runSearch(this.query); 
  }
});

```

```ts
// ✅ CORRECT: Compiled as a reactive, derived computed atom.
const searchScope = scope({
  query: "",
  results: (self) => runSearch(self.query) 
});

```

### Trap #2: Forgetting to Clean Up (Memory Leaks)

Scopes manage and cache active subscriptions to build their reactive trees. If you instantiate scopes dynamically (for example, inside a UI component or a short-lived request handler), you must dispose of them.

```ts
// In your component unmount or cleanup function:
taskManager.dispose();

```

---

## 4. Standard UI Optimization: Analog Mode

By default, streamix operates in **Discrete Mode**, meaning every state change immediately and synchronously triggers updates. This is excellent for services, events, and testing, but can cause laggy performance or "screen flickering" in UI components due to rapid, consecutive rendering cycles.

Always switch your UI-facing scopes to **Analog Mode** to automatically batch and coalesce changes on a microtask queue:

```ts
// Ideal for React, Vue, or vanilla UI rendering
const uiState = scope({
  firstName: "Jane",
  lastName: "Doe",
  fullName: self => `${self.firstName} ${self.lastName}`
}, { mode: "analog" });

// Modifying both properties only triggers exactly ONE UI update cycle at the end of the microtask:
uiState.firstName = "John";
uiState.lastName = "Smith";

```
