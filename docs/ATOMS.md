# ⚛️ Meet `atom` — the Tiny Superpower Behind streamix

> One function. Endless possibilities.

Every great library has that one feature you reach for over and over.

In **streamix**, it's `atom`.

```ts
import { atom } from "@epikodelabs/streamix";

const count = atom(0);
```

That's it.

No providers.
No reducers.
No decorators.
No boilerplate.
No magic.

Just a tiny object that remembers its value—and happily tells the world when it changes.

---

## It's just state... but smarter

```ts
const count = atom(0);

console.log(count.value); // 0
console.log(count.previous); // undefined

count.next(5);

console.log(count.value); // 5
console.log(count.previous); // 0
```

The current value.

The previous value.

Always available.

You'd be surprised how often `.previous` saves you from writing extra code.

---

## Updating state feels natural

```ts
const theme = atom<"light" | "dark">("light");
const user = atom<User | null>(null);
const todos = atom<Todo[]>([]);

theme.next("dark");

todos.next([...todos.value, newTodo]);
```

Whether you're storing a number or your entire application state, the API stays exactly the same.

No special cases.

No new concepts to learn.

---

## Watching changes is refreshingly simple

```ts
const unsubscribe = count.subscribe((current, previous) => {
    console.log(`${previous} → ${current}`);
});

unsubscribe();
```

No ceremony.

Just subscribe.

When you're done, unsubscribe.

Easy.

---

## Small doesn't mean limited

Despite its size, `atom` already comes with some surprisingly useful features:

* ⚡ Tiny and fast
* 🕒 Previous value built in (`.previous`)
* 🚨 Error handling with `fail()` and `recover()`
* 🧹 Automatic cleanup inside `scope()`
* 🔗 Composes naturally into derived values, expressions, and async pipelines

It's the kind of primitive that quietly grows with your application.

---

## One atom becomes many

Before long you'll have something like this:

```ts
const firstName = atom("Ada");
const lastName = atom("Lovelace");
const online = atom(true);
const notifications = atom(5);
```

Each one is independent.

Each one is tiny.

Together they become your application's living state.

No global store required.

---

## The best API is the one you stop thinking about

After a while, you stop noticing `atom`.

You just write your application.

That's probably the biggest compliment a library can earn.

Simple enough to learn in a minute.

Powerful enough to build everything else on top.
