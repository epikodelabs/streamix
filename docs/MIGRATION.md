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
  doubled: self => self.count * 2,
});

app.count = 5;
app.dispose();
```

---

## 📋 Quick Mapping

| v2                          | v3 Equivalent                  |
|-----------------------------|--------------------------------|
| `createBehaviorSubject`     | `atom(initial)`                |
| `createSubject`             | `atom()` or flow (for events)  |
| `.next(value)`              | `.set(value)`                  |
| `.pipe(...)` (method)       | `pipe(source, ...)`            |
| Computed streams            | `derived()`                    |
| Async resources             | `flow()`                       |
| Manual cleanup              | `scope()` + `.dispose()`       |

---

## Main Migration Steps

1. **Replace Subjects with Atoms**  
   `createBehaviorSubject(0)` → `atom(0)`

2. **Keep Flows for Sequences**  
   Don’t convert working stream pipelines. Use `pipe()` (function style) instead of method chaining.

3. **Use `derived()` for Computed Values**

4. **Group State with Scopes** (recommended for features)

5. **Update Coroutines**  
   `processTask()` → `run()`  
   `finalize()` → `dispose()`

---

## 💡 Common Patterns

**Counter**
```ts
const counter = scope({
  count: 0,
  doubled: self => self.count * 2,
}, self => ({
  increment() {
    self.count += 1;
  },
}));
```

**Form**
```ts
const form = scope({
  email: "",
  password: "",
  isValid: self => self.email.includes("@") && self.password.length >= 8,
}, self => ({
  submit() {
    if (!self.isValid) return;
    // submit form
  },
}));
```

**Async Data**
```ts
const user = scope({
  userId: "",
  profile: self => {
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
