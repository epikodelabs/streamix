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

Atoms propagate every write immediately. Use `transaction()` when several writes must become one reactive state transition.

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
  visibleTasks: (self: any) => {
    if (self.filter === "completed") return self.tasks.filter(t => t.done);
    if (self.filter === "active") return self.tasks.filter(t => !t.done);
    return self.tasks;
  },

  stats: (self: any) => {
    const total = self.tasks.length;
    const completed = self.tasks.filter(t => t.done).length;
    return { total, completed, remaining: total - completed };
  },

  // 3. Actions / Mutations (Imperative Methods)
  // Always wrap functions that mutate state in `method()` to keep them non-reactive.
  toggleTask: method((self: any, id: number) => {
    self.tasks = self.tasks.map(t => 
      t.id === id ? { ...t, done: !t.done } : t
    );
  }),

  addTask: method((self: any, text: string) => {
    const newId = self.tasks.length + 1;
    self.tasks = [...self.tasks, { id: newId, text, done: false }];
  })
});

```

### Understanding the Compiled Output:

* **Direct Read/Write (`taskManager.filter`)**: Accessing a property retrieves the current value. Assigning a new value (e.g., `taskManager.filter = "active"`) automatically pushes the update through the reactive system.
* **Dependency Tracking (`taskManager.visibleTasks`)**: Whenever `taskManager.filter` or `taskManager.tasks` is updated, `visibleTasks` automatically recalculates. You read it like a plain property: `console.log(taskManager.visibleTasks)`.
* **Action Execution (`taskManager.addTask("...")`)**: Methods are called as standard imperative functions to safely execute side effects and mutations.
* **Typing `self`**: TypeScript cannot infer `self` for you here. `method()` gives its callback's `self` no inference site (it always needs an annotation), and computed properties only infer `self` when the scope declares an explicit shape. Quick samples use `self: any`; for real code, prefer a shape interface — `scope<TaskManagerShape>(...)` infers `self` in computed properties, and `method((self: TaskManagerShape, id: number) => ...)` types your methods end to end.

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
  doubled: (self: any) => {
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
  results: (self: any) => runSearch(self.query)
});

```

### Trap #2: Forgetting to Clean Up (Memory Leaks)

Scopes manage and cache active subscriptions to build their reactive trees. If you instantiate scopes dynamically (for example, inside a UI component or a short-lived request handler), you must dispose of them.

```ts
// In your component unmount or cleanup function:
taskManager.dispose();

```

### Trap #3: Expecting `method()` to Batch Its Writes

`method()` only marks a function as imperative — it does **not** group its assignments into one update. A method that assigns several properties produces one transition per line, so computed properties re-run after each assignment. Wrap multi-write bodies in `transaction()` to commit them as a single update (see [Explicit Transactions](#4-explicit-transactions)).

---

## 4. Explicit Transactions

Atoms and scopes have one state propagation model: ordinary writes propagate immediately. When several synchronous writes form one logical state change, wrap them in `transaction()`.

```ts
import { scope, transaction } from "@epikodelabs/streamix";

const uiState = scope({
  firstName: "Jane",
  lastName: "Doe",
  fullName: (self: any) => `${self.firstName} ${self.lastName}`
});

transaction(() => {
  uiState.firstName = "John";
  uiState.lastName = "Smith";
});
```

Without the wrapper, each assignment is its own transition: `fullName` recomputes twice, and its subscribers observe the intermediate `"John Doe"` snapshot. Wrapped in `transaction()`, both writes commit together and `fullName` recomputes exactly once.

### Semantics Inside the Callback

* **Reads are always current.** Writes are visible through `.value` (and plain scope properties) immediately. A `derived()` read mid-transaction recomputes on demand from the values written so far — reading never blocks or defers.
* **Delivery is deferred.** Subscriber callbacks and dependent `derived()` recomputation wait until the outermost transaction commits.
* **Writes to the same atom collapse.** Multiple writes to one atom produce a single subscriber notification carrying the final value.
* **`previous` is captured once.** It keeps the value the atom had *before* the transaction started, not the value from the second-to-last write.
* **The return value passes through.** `transaction()` returns whatever the callback returns.

```ts
const a = atom(0);
const seen: Array<[number, number]> = [];
a.subscribe((current, previous) => seen.push([current, previous]));

transaction(() => {
  a.next(1);
  a.next(2);
  a.next(3);
  console.log(a.value); // 3 — reads see the latest write
});

console.log(seen);        // [[3, 0]] — one collapsed notification
console.log(a.previous);  // 0 — captured before the transaction began
```

### Nested Transactions Join the Outer Commit

An inner `transaction()` does not flush. Everything commits when the outermost callback returns, so helpers can open their own transactions without splitting the batch:

```ts
transaction(() => {
  a.set(1);
  transaction(() => {
    b.set(2);
  }); // nothing delivered here
}); // one commit: a and b land together
```

### Methods Do Not Auto-Batch

`method()` keeps a function imperative; it does not batch its writes. A method that assigns several properties still produces one transition per assignment:

```ts
// ❌ WRONG: two transitions — fullName recomputes twice
rename: method((self: any, first: string, last: string) => {
  self.firstName = first;
  self.lastName = last;
}),

// ✅ CORRECT: wrap multi-write method bodies in transaction()
rename: method((self: any, first: string, last: string) => {
  transaction(() => {
    self.firstName = first;
    self.lastName = last;
  });
}),
```

### Errors Commit, They Do Not Roll Back

Transactions are synchronous and have no rollback. If the callback throws, writes made before the throw are committed before the original error is rethrown. Validate inputs before writing, or plan for partial state in your error handling:

```ts
try {
  transaction(() => {
    profile.name = result.name;
    throw new Error("validation failed");
  });
} catch (err) {
  // profile.name keeps the value written before the throw
}
```

### Resolve Async Work First

The callback must be synchronous — `transaction()` rejects promise-returning callbacks with a `TypeError` (and the type signature flags them at compile time). Await the async part, then commit its results in one synchronous batch:

```ts
const result = await loadProfile();

transaction(() => {
  profile.name = result.name;
  profile.email = result.email;
});
```

### Writes from Subscribers During Commit

Subscriber callbacks run during the commit flush and may perform their own writes. Those writes are neither swallowed nor folded into the committed batch — they start a fresh transition after the flush, with `previous` updated correctly:

```ts
const a = atom(0);
const seen: Array<[number, number]> = [];

a.subscribe((current, previous) => {
  seen.push([current, previous]);
  if (current === 1) a.set(2); // write from within the commit flush
});

transaction(() => a.set(1));

console.log(seen); // [[1, 0], [2, 1]] — both transitions delivered
```

Analog/discrete semantics belong to sequences, not state containers. For a flow, choose delivery explicitly when needed:

```ts
const positions = flow(pointerPositions(), { mode: "analog" }); // latest pending value matters
const clicks = flow(clickEvents(), { mode: "discrete" });       // every event matters
```
