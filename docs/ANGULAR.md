# ✨ Consumption, Not Orchestration

RxJS is a phenomenal tool. Angular does use RxJS everywhere. It is battle-tested, expressive, and indispensable for **infrastructure-level reactivity**: application state, event buses, router events, forms, and long-lived shared streams.

But when RxJS is pushed into **component-local, sequential, user-driven async flows**, it stops being helpful — and often becomes actively harmful.

Streamix exists precisely in that gap. **Streamix is for code that reads like logic, not infrastructure.**

It lives **below Angular and beside RxJS**, not above either.
It does not compete with RxJS’s strengths — it addresses a category RxJS was never designed to optimize for.

---

## ✨ What Angular + RxJS Is Objectively Bad At

Angular didn’t merely *adopt* RxJS — it **forces it into places where it adds friction**.

This is not a matter of taste. It’s a structural mismatch.

---

## ✨ 1. Component-Local Flows Become Orchestration Puzzles

Most component logic looks like this:

* input → debounce
* cancel previous work
* perform async operation
* update view
* repeat until component is destroyed

These flows are:

* lifecycle-bound
* single-consumer
* strictly ordered
* finite

RxJS forces this shape into:

* Subjects
* teardown signals
* operator gymnastics
* mental simulation of time

What should be *linear logic* becomes a **distributed orchestration problem**.

This is not reactive dataflow —
it’s imperative control flow pretending to be reactive.

---

## ✨ 2. Subscriptions Leak Intent

RxJS answers one question extremely well:

> **“How do values flow?”**

But component logic asks a different question:

> **“When should I do the next thing?”**

That mismatch is the root pain.

```ts
this.search$
  .pipe(
    debounceTime(300),
    switchMap(q => this.api.search(q)),
    takeUntil(this.destroy$)
  )
  .subscribe(...)
```

This *looks* declarative, but it isn’t.

* sequencing is implicit
* cancellation is operator-dependent
* lifecycle is bolted on
* intent is fragmented across operators

This is **orchestration disguised as a pipeline**.

---

## ✨ 3. Lifecycle Management Is Bolted On, Not Intrinsic

Angular components are **scoped execution units**.

RxJS streams are **open-ended by default**.

To bridge that gap, Angular developers constantly patch:

* `takeUntilDestroyed`
* async pipe gymnastics
* manual teardown
* defensive unsubscription
* accidental shared subscriptions

This isn’t misuse — it’s **structural impedance mismatch**.

---

## ✨ Streamix’s Actual Niche

Streamix is for:

> **pull-driven, lifecycle-scoped, single-consumer async logic**

Especially inside components.

Not global state.
Not shared streams.
Not infrastructure.

**Control flow — not dataflow.**

---

## ✨ Where Streamix Wins Decisively

| Problem Type           | RxJS Fit | Streamix Fit |
| ---------------------- | -------- | ------------ |
| App-wide state         | ✅        | ✅            |
| HTTP APIs              | ✅        | ✅            |
| Forms, router          | ✅        | ❌            |
| Component logic        | ⚠️       | ✅            |
| Sequential async       | ⚠️       | ✅            |
| Cancellation semantics | ⚠️       | ✅            |
| Readability            | ⚠️       | ✅            |
| Debuggability          | ⚠️       | ✅            |

The table isn’t opinion — it’s about **execution shape**.

---

## ✨ The Mental Model Difference

### ✨ RxJS Model

> **“Set up a machine that reacts forever.”**

* push-based
* open-ended
* time-driven
* multi-consumer by default

Perfect for infrastructure.

---

### ✨ Streamix Model

> **“Consume values until I’m done.”**

* pull-based
* finite
* lifecycle-aligned
* single-consumer

Perfect for component logic.

This difference sounds subtle.

It is **massive**.

---

## ✨ Streamix’s Unique Strengths

### ✨ 1. Consumption Over Subscription

```ts
for await (const q of searchInput.pipe(debounce(300))) {
  const result = await api.search(q);
  render(result);
}
```

No teardown.
No subjects.
No stale closures.
No race conditions hidden in operators.

Execution is **explicit**.

---

### ✨ 2. Lifecycle Alignment With Angular

* Component destroyed → async iterator stops
* No phantom subscriptions
* No hidden multicasting
* No “who else is listening?”

Angular components are finite.
**Streamix embraces finiteness.**

---

### ✨ 3. Sequential Logic Stays Sequential

In RxJS:

* sequencing is emergent
* cancellation is implicit
* ordering depends on operators

In Streamix:

* ordering is guaranteed
* cancellation is structural
* flow reads top-to-bottom

Your code behaves the way it reads.

---

### ✨ 4. Better Debugging & Reasoning

Your tracing work makes this concrete:

* values have lineage
* cancellation has meaning
* dropped vs collapsed vs filtered are explicit
* no ghost emissions

RxJS hides causality.
**Streamix exposes it.**

---

## ✨ The Correct Positioning Statement

Streamix is **not** a reactive framework.

It is a **control-flow primitive for async logic**.

That’s why it fits Angular perfectly —
Angular already *is* the framework.

---

## ✨ The Signals Angle

Angular Signals change **state propagation**, not **async control flow**.

Even in a signals-first world:

* signals don’t debounce
* signals don’t cancel async work
* signals don’t sequence effects
* signals don’t model async iteration

Signals need something like Streamix —
**not the other way around.**

---

## ✨ Summary

If you want a one-liner that’s actually true:

> **RxJS manages streams of data.
> Streamix manages streams of work.**

Or sharper:

> **RxJS answers *“what reacts”*.
> Streamix answers *“what happens next”*.**

That’s the niche.

And it’s not small.
