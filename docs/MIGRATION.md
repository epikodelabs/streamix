# 🚀 Streamix Migration Guide: v2 → v3

This guide helps you move from **v2** to the current **v3** API on the `main` branch.

**v2** was a clean streaming toolkit centered on Subjects, `.pipe()`, and async iterables.  
**v3** keeps the strong async foundation but introduces a clearer model:

> **Atoms** for values • **Flows** for sequences • **Scopes** for ownership.

You don’t need to rewrite everything — just evolve your stateful code.

---

## 🔄 Key Changes

### v2 Style (Old)
```ts
const count = createBehaviorSubject(0);
const doubled = count.pipe(map(v => v * 2));

count.next(5);
doubled.subscribe(console.log);
```

### v3 Style (New)
```ts
const count = atom(0);
const doubled = derived(() => count.value * 2);

count.set(5);
console.log(doubled.value); // 10
```

For feature state, use **scopes**:

```ts
const app = scope({
  count: 0,
  doubled: (self: any) => self.count * 2,
});

app.count = 5;
app.dispose();
```

### Pipelines: Method Chaining → `pipe()` Function

v2 piped through a method on the source. v3 moves piping into a standalone function — **the source comes first, followed by any number of operators**:

```ts
// v2 (old)
const doubled = count.pipe(map(v => v * 2), filter(v => v > 10));

// v3 (new)
const doubled = pipe(count, map(v => v * 2), filter(v => v > 10));
```

What carries over and what changes:

* **Operators are unchanged.** `map`, `filter`, `switchMap`, `take`, and the rest keep their names and behavior — only the call shape moved.
* **The source can be an atom, a flow, or any async iterable** — not just subjects.
* **The result is an `Atom`.** You can still `subscribe(...)` and `for await ... of` it, and you additionally get a synchronous `.value` read.
* **Sources no longer have a `.pipe` method.** Every pipeline starts at the `pipe()` function.
* **Up to 16 operators keep full type inference**; beyond that the result falls back to `Atom<any>`. Split long chains or pre-group them with `compose()`.

For reusable chains, compose operators once and apply them to any source:

```ts
const searchPipeline = compose(
  debounce(300),
  distinctUntilChanged(),
  switchMap(search)
);

const results = pipe(query, searchPipeline);
```

---

## 📋 Quick Mapping

| v2                          | v3 Equivalent                  |
|-----------------------------|--------------------------------|
| `createBehaviorSubject`     | `atom(initial)`                |
| `createSubject`             | `atom()` or flow (for events)  |
| `.next(value)`              | unchanged — `.set(value)` added as an alias |
| `.pipe(...)` (method)       | `pipe(source, ...)`            |
| Computed streams            | `derived()`                    |
| Async resources             | `flow()`                       |
| Manual cleanup              | `scope()` + `.dispose()`       |
| Coroutines                  | `@epikodelabs/coroutines`      |
| Router                      | `@epikodelabs/waypoint`        |
| Forms                       | `@epikodelabs/forms`           |

---

## Main Migration Steps

1. **Replace Subjects with Atoms**  
   `createBehaviorSubject(0)` → `atom(0)`

2. **Keep Flows for Sequences**  
   Don’t convert working stream pipelines. Use `pipe()` (function style) instead of method chaining.

3. **Use `derived()` for Computed Values**

4. **Group State with Scopes** (recommended for features)

5. **Coroutines, Router, and Forms Are Now Separate Packages**  
   These areas were externalized and are compatible with streamix v3: concurrency moved to `@epikodelabs/coroutines` (workers, structured task ownership, channels, actors), routing to `@epikodelabs/waypoint`, and forms to `@epikodelabs/forms`. Install the one you need alongside streamix. For simple async resources, stay in core and use `flow()` — it gives you cancellation via `AbortSignal` and cleanup tied to atom disposal.

---

## 💡 Common Patterns

**Counter**
```ts
const counter = scope({
  count: 0,
  doubled: self => self.count * 2,
  increment: method((self: any) => {
    self.count += 1;
  }),
});
```

**Form**
```ts
const form = scope({
  email: "",
  password: "",
  isValid: self => self.email.includes("@") && self.password.length >= 8,
  submit: method((self: any) => {
    if (!self.isValid) return;
    // submit form
  }),
});
```

**Async Data**
```ts
const user = scope({
  userId: "",
  profile: (self: any) => {
    const userId = self.userId;

    return flow(async function* (signal) {
      if (!userId) {
        yield null;
        return;
      }

      const res = await fetch(`/api/users/${userId}`, { signal });
      yield await res.json();
    });
  },
});
```

---

## Final Tips

- **Atoms** = current value
- **Flows** = sequences or async resources
- **Scopes** = feature ownership + cleanup
- Keep existing stream pipelines — only migrate state

**Rule of thumb**: If it has a “current value”, make it an `atom`. If it’s a sequence of events, keep it as a `flow`.
