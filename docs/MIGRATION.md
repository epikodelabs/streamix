# 🚀 Streamix Migration Guide From v2

This guide helps existing streamix v2 users migrate to the current v3 API on the `main` branch.

The `v2` branch is a compact async-iterable streaming toolkit. Its public model is built around:

- pull-based streams,
- hot Subjects,
- method-style `.pipe(...)`,
- `for await...of`,
- `query()` for awaiting the next value,
- coroutine and actor add-ons.

v3 keeps the async-generator and async-iterator foundation, but changes the recommended application model:

> **Atoms for values. Flows for sequences. Scopes for ownership. Flow-backed atoms for async state.**

The goal is not to rewrite every stream pipeline. The goal is to move stateful application logic away from subject-style orchestration and toward atoms, derived values, flows, and scopes.

---

## 🔄 What changed?

### 📌 v2 style

In v2, applications were commonly organized around streams, subjects, subscriptions, and operators.

```ts
const count = createBehaviorSubject(0);

const doubled = count.pipe(
  map(value => value * 2)
);

const subscription = doubled.subscribe(value => {
  console.log(value);
});

count.next(5);

subscription();
```

Subjects were the imperative/hot source primitive:

```ts
const events = createSubject<{ type: string }>();

events.subscribe(event => {
  console.log(event.type);
});

events.next({ type: "ready" });
```

### ✨ v3 style

In v3, current state is represented directly as atoms and derived values.

```ts
const count = atom(0);
const doubled = derived(() => count.value * 2);

count.set(5);

console.log(doubled.value); // 10
```

For feature-level state, prefer scopes.

```ts
const app = scope({
  count: 0,
  doubled: self => self.count * 2,
});

app.count = 5;

console.log(app.doubled); // 10

app.dispose();
```

---

## 📋 Quick mapping

| v2 pattern | v3 direction |
| --- | --- |
| `createSubject<T>()` | `atom<T>()` for latest event state, or a flow/source for pure sequences |
| `createBehaviorSubject<T>(initial)` | `atom(initial)` |
| `createReplaySubject<T>(capacity)` | explicit history atom, `scan(...)`, or a flow-level replay helper where appropriate |
| `subject.next(value)` | `atom.set(value)` |
| `subject.complete()` | `atom.dispose()` or owning `scope.dispose()` |
| `subject.subscribe(...)` | `atom.subscribe(...)` or `iterate(atom)` |
| `stream.pipe(...)` | `pipe(source, ...)` |
| `stream.query()` | keep `query()` where available, or consume with `for await...of` |
| computed stream state | `derived(...)` |
| async resource state | `flow(...)` |
| manual subscription groups | `scope(...)` and `.dispose()` |
| worker task `.processTask(...)` | `.run(...)` |
| worker/resource `.finalize()` | `.dispose()` |

---

## 1. 🌊 Streams and flows are still here

Do not rewrite every stream pipeline just because you are migrating.

Streams/flows are still the right tool for:

- async sequence transformation,
- operator-heavy pipelines,
- pull-based consumption,
- `for await...of`,
- event or data streams that do not need to expose a current value.

### Before: v2 method-style pipe

```ts
const values = range(1, 20).pipe(
  filter(n => n % 2 === 0),
  map(n => n * 10),
  take(5)
);

for await (const value of values) {
  console.log(value);
}
```

### After: v3 function-style pipe

```ts
const values = pipe(
  range(1, 20),
  filter(n => n % 2 === 0),
  map(n => n * 10),
  take(5)
);

for await (const value of values) {
  console.log(value);
}
```

The main migration rule is:

> If it represents a current value, make it an atom. If it represents a sequence, keep it as a flow.

---

## 2. ⚛️ Replace BehaviorSubject-style state with `atom(initial)`

Use `atom(initial)` when the value has an initial state.

### Before

```ts
const count = createBehaviorSubject(0);

count.next(1);
console.log(count.value);
```

### After

```ts
const count = atom(0);

count.set(1);
console.log(count.value);
```

This is the most direct migration because both patterns represent a current value.

---

## 3. 🎯 Replace plain Subjects based on intent

A v2 `createSubject()` could mean two different things:

1. a hot event stream,
2. a mutable piece of application state.

In v3, choose based on the role.

### If it represents current state, use `atom<T>()`

```ts
const status = atom<string>();

status.set("ready");

console.log(status.value);
```

### If it represents a pure event sequence, keep it as a flow/source

```ts
const clicks = fromEvent(button, "click");

const clicksUntilSubmit = pipe(
  clicks,
  takeUntil(submit)
);
```

Do not force every event stream into an atom. Atoms are for values. Flows are for sequences.

---

## 4. 📜 Replace ReplaySubject-style history intentionally

A replay subject combines two responsibilities:

- it is a hot event source,
- it stores recent history.

In v3, model the history explicitly.

```ts
const messages = atom<string[]>([]);

function pushMessage(message: string) {
  messages.set([...messages.value, message].slice(-10));
}
```

Or keep history in a flow pipeline when it belongs to the sequence:

```ts
const recent = pipe(
  source,
  scan((items, item) => [...items, item].slice(-10), [] as Item[])
);
```

---

## 5. 🔄 Replace computed stream state with `derived()`

If a stream pipeline only exists to compute state from other state, it is usually a derived value in v3.

### Before

```ts
const firstName = createBehaviorSubject("Ada");
const lastName = createBehaviorSubject("Lovelace");

const fullName = combineLatest(firstName, lastName).pipe(
  map(([first, last]) => `${first} ${last}`)
);
```

### After

```ts
const firstName = atom("Ada");
const lastName = atom("Lovelace");

const fullName = derived(() => `${firstName.value} ${lastName.value}`);

console.log(fullName.value);
```

Inside a scope, this becomes smaller:

```ts
const user = scope({
  firstName: "Ada",
  lastName: "Lovelace",
  fullName: self => `${self.firstName} ${self.lastName}`,
});

console.log(user.fullName);
```

---

## 6. 🌳 Prefer scopes for feature-level state

Atoms are useful on their own, but scopes are the preferred way to model a feature, module, form, page, or component-like state tree.

### Before

```ts
const firstName = createBehaviorSubject("Ada");
const lastName = createBehaviorSubject("Lovelace");

const fullName = combineLatest(firstName, lastName).pipe(
  map(([first, last]) => `${first} ${last}`)
);

const subscriptions = [
  firstName.subscribe(...),
  lastName.subscribe(...),
  fullName.subscribe(...),
];

for (const unsubscribe of subscriptions) {
  unsubscribe();
}
```

### After

```ts
const profile = scope({
  firstName: "Ada",
  lastName: "Lovelace",
  fullName: self => `${self.firstName} ${self.lastName}`,

  rename(first: string, last: string) {
    this.firstName = first;
    this.lastName = last;
  },
});

profile.rename("Grace", "Hopper");

console.log(profile.fullName);

profile.dispose();
```

A scope owns its internal reactive values and cleanup. When the scope is disposed, the whole feature leaves together.

---

## 7. 🌐 Use `flow()` for async reactive state

Use `flow()` when async work should produce a current reactive value.

```ts
const userId = atom(1);

const user = flow(async function* () {
  const response = await fetch(`/api/users/${userId.value}`);
  yield await response.json();
});
```

Use flow for:

- fetching data,
- async resources,
- polling,
- async generator sources,
- values that should restart when their reactive inputs change.

If you need a long-lived async source that should not restart, avoid reading reactive dependencies inside the flow definition. Pass configuration explicitly instead.

---

## 8. 🔁 Use `iterate(atom)` when you need async iteration

Atoms expose current values, but they can still be consumed as async iterables.

```ts
const status = atom("idle");

for await (const value of iterate(status)) {
  console.log(value);
}
```

This is useful when migrating existing `for await...of` consumers gradually.

---

## 9. 🔎 Keep `query()` where it still expresses the intent

v2 used `query()` to await the next emitted value with automatic cleanup.

```ts
const firstTick = await interval(1000).pipe(take(1)).query();
```

In v3, you can still keep this style where the API supports it. For plain async iterables, `for await...of` is the universal fallback.

```ts
for await (const value of values) {
  console.log(value);
  break;
}
```

---

## 10. 🛠️ Update coroutine lifecycle names

Coroutine APIs now use shorter lifecycle names.

### Before

```ts
const worker = coroutine(task);

await worker.processTask(input);

worker.finalize();
```

### After

```ts
const worker = coroutine(task);

await worker.run(input);

worker.dispose();
```

Use `run()` for one task execution and `dispose()` for cleanup.

---

## 📍 Migration order

A safe migration path:

1. Keep existing stream pipelines that already work.
2. Convert `createBehaviorSubject(initial)` state to `atom(initial)`.
3. Review each `createSubject()` and decide whether it is state or a sequence.
4. Convert state-like Subjects to `atom<T>()`.
5. Keep event-like Subjects as flows/sources when they are really sequences.
6. Convert computed state pipelines to `derived()`.
7. Move feature-level atom groups into `scope()`.
8. Convert async resource state to `flow()`.
9. Replace method-style `.pipe(...)` with `pipe(source, ...)` when touching code.
10. Rename coroutine lifecycle calls from `processTask`/`finalize` to `run`/`dispose`.
11. Add `.dispose()` calls for scopes and long-lived resources.

---

## 💡 Common examples

### Counter

```ts
const counter = scope({
  count: 0,
  doubled: self => self.count * 2,

  increment() {
    this.count++;
  },
});

counter.increment();

console.log(counter.count);   // 1
console.log(counter.doubled); // 2
```

### Form state

```ts
const form = scope({
  firstName: "",
  lastName: "",
  email: "",

  fullName: self => `${self.firstName} ${self.lastName}`.trim(),
  isValid: self => self.email.includes("@") && self.fullName.length > 0,
});

form.firstName = "Ada";
form.lastName = "Lovelace";
form.email = "ada@example.com";

console.log(form.isValid); // true
```

### Async resource

```ts
const search = scope({
  query: "",

  results: flow(async function* () {
    if (!search.query) {
      yield [];
      return;
    }

    const response = await fetch(`/api/search?q=${encodeURIComponent(search.query)}`);
    yield await response.json();
  }),
});

search.query = "streamix";
```

---

## ❓ FAQ

### Do I have to remove all streams?

No. Streams/flows are still core to streamix. Use them for sequences. Use atoms and scopes for state.

### Are Subjects still recommended?

No for new stateful code. Existing subject-style code can be migrated gradually. Event-like sources can remain sequence-oriented, but state-like Subjects should move to atoms or scopes.

### Should every atom be inside a scope?

Not necessarily. Small standalone atoms are fine. For application features, scopes give better ownership, nesting, and cleanup.

### Should I use `derived()` or `flow()`?

Use `derived()` for synchronous computed state. Use `flow()` when the computed value comes from async work or an async generator.

### Should I use `subscribe()` or `iterate()`?

Use direct `.value` reads for current state. Use `subscribe()` for callbacks. Use `iterate(atom)` when you need `for await...of` interop.

---

## 🎯 Final rule of thumb

```txt
atom      = current value
derived   = computed current value
flow      = async current value or async sequence bridge
scope     = ownership and lifecycle
pipe      = async sequence transformation
coroutine = worker-backed execution
```
