# ✨ Consumption, not orchestration

> **Streamix is for code that *reads like logic*, not infrastructure.**

RxJS is phenomenal at **infrastructure-level reactivity**.
It is *overkill* (and often harmful) for **local, sequential, user-driven async flows**.

Streamix lives **below Angular and beside RxJS**, not above it.

---

## ✨ What Angular + RxJS is objectively bad at

Angular forces RxJS into places where it adds friction:

### ✨ 1. Component-local flows become orchestration puzzles

Typical Angular component logic:

* input → debounce → cancel → async → update view
* lifecycle-bound
* single consumer
* strictly ordered

RxJS forces this into:

* Subjects
* teardown logic
* operator gymnastics
* mental simulation of time

This is **not reactive dataflow** — it’s **imperative logic pretending to be reactive**.

---

### ✨ 2. Subscriptions leak intent

RxJS answers:

> *“How do values flow?”*

But component logic asks:

> *“When should I do the next thing?”*

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

This is orchestration disguised as a pipeline.

---

### ✨ 3. Lifecycle management is bolted on, not intrinsic

Angular components are **scoped execution units**.

RxJS is **open-ended by default**.

So Angular developers constantly patch:

* `takeUntilDestroyed`
* `async` pipe gymnastics
* manual teardown
* accidental shared subscriptions

This is a *structural impedance mismatch*.

---

## ✨ Streamix’s actual niche (precise definition)

> **Streamix is for pull-driven, lifecycle-scoped, single-consumer async logic — especially inside components.**

### ✨ Where Streamix *wins decisively*

| Problem type           | RxJS fit | Streamix fit |
| ---------------------- | -------- | ------------ |
| App-wide state         | ✅       | ✅          |
| HTTP APIs              | ✅       | ✅          |
| Forms, router          | ✅       | ❌          |
| Component logic        | ⚠️       | ✅          |
| Sequential async       | ⚠️       | ✅          |
| Cancellation semantics | ⚠️       | ✅          |
| Readability            | ⚠️       | ✅          |
| Debuggability          | ⚠️       | ✅          |

---

## ✨ The mental model difference (this is the key)

### ✨ RxJS model

> *“Set up a machine that reacts forever.”*

### ✨ Streamix model

> *“Consume values until I’m done.”*

That sounds subtle — it’s **massive**.

---

## ✨ Streamix’s *unique* strengths (not marketing fluff)

### ✨ 1. **Consumption over subscription**

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

**Execution is explicit.**

---

### ✨ 2. **Lifecycle alignment with Angular**

* Component destroyed → async iterator stops
* No phantom subscriptions
* No hidden multicasting
* No “who else is listening?”

Angular components are *finite*.
Streamix embraces finiteness.

---

### ✨ 3. **Sequential logic stays sequential**

In RxJS:

* sequencing is *emergent*
* cancellation is *implicit*
* ordering is *operator-dependent*

In Streamix:

* ordering is guaranteed
* cancellation is structural
* flow is readable top-to-bottom

---

### ✨ 4. **Better debugging & reasoning**

Your tracing work proves this:

* values have lineage
* cancellation has meaning
* dropped vs collapsed vs filtered are explicit
* no ghost emissions

RxJS hides causality.
Streamix exposes it.

---

## ✨ The correct positioning statement

> **Streamix is not a reactive framework.
> It is a control-flow primitive for async logic.**

That’s why it fits Angular **perfectly** — Angular already *is* the framework.

---

## ✨ The Signals angle (important, but future-proof)

Angular Signals change *state propagation*, not *async control flow*.

Even in a signals-first world:

* signals don’t debounce
* signals don’t cancel async work
* signals don’t sequence effects
* signals don’t model async iteration

**Signals need something like Streamix**, not the other way around.

---

## ✨ Summary

If you want a one-liner that’s actually true:

> **RxJS manages streams of data.
> Streamix manages streams of *work*.**

Or even sharper:

> **RxJS answers “what reacts”.
> Streamix answers “what happens next”.**

That’s the niche — and it’s not small.
