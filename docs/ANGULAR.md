# ✨ Pull-Based Reactivity in a Signals-Era Angular

Angular's reactivity model is evolving. With **Signals**, the framework now has a native mechanism for state propagation and change detection. Meanwhile, RxJS remains deeply integrated into Angular's core APIs—`HttpClient`, router events, and forms are all built on Observables.

This creates a natural separation:

* **Framework-level reactivity** → Signals, RxJS (where required)
* **Component-level async flow** → room for alternatives

Streamix fits into this gap. It offers a pull-based, async-generator approach for localized asynchronous flows inside components—where subscription-centric patterns often feel heavier than necessary.

---

## ✨ What Is Streamix?

Streamix began as an exploration of reactive programming mechanics—reimplementing familiar operators to understand their behavior. It converged on async generators as a foundation for pull-based execution.

The result is an async-first reactive system that preserves familiar operator semantics while aligning with JavaScript's native `async`/`await`.

### ✨ A Shared Vocabulary

A typical reactive pipeline:

```ts
source.pipe(
  debounceTime(300),
  switchMap(fetchData)
)
```

These operator names have become industry standard. Streamix deliberately adopts this vocabulary—not to replicate RxJS behavior, but to reuse concepts developers already understand.

### ✨ Different Execution Model

While the operator names are familiar, the execution differs:

**RxJS:**
* Push-based (sources control timing)
* Scheduler-driven coordination
* Subscription-centric lifecycle
* Optimized for multicasting and framework integration
* ~50KB+ minified

**Streamix:**
* Pull-based (consumers control pace)
* Built on async generators
* Iterator-first (`for await...of`)
* Optimized for sequential async flows
* ~9KB minified

---

## ✨ A Practical Comparison

A typical RxJS-based search component:

```ts
this.searchControl.valueChanges
  .pipe(
    debounceTime(300),
    filter(q => q.length > 2),
    switchMap(q => this.searchService.search(q)),
    takeUntil(this.destroy$)
  )
  .subscribe(results => this.results$.next(results));
```

This requires explicit subscription management, teardown logic, and lifecycle coordination.

With Streamix:

```ts
const stream = fromEvent(input, 'input').pipe(
  debounce(300),
  filter(q => q.length > 2),
  switchMap(q => this.searchService.search(q))
);

for await (const results of stream) {
  this.results = results;
}
```

Key differences:

* Cancellation happens automatically when the loop exits
* Cleanup is tied to execution scope
* Reads like ordinary `async`/`await`
* No Subjects or manual teardown

---

## ✨ When to Choose Which

**RxJS excels when:**
* Multiple subscribers needed
* Advanced scheduling required
* Deep framework integration
* Shared, long-lived event sources

**Streamix targets:**
* Local, component-level async logic
* Sequential, pull-driven flows
* Explicit execution boundaries
* Smaller runtime footprint

---

## ✨ Complementary Approaches

Streamix doesn't compete with Angular's direction—it complements it. Signals handle framework-level state. RxJS remains essential where the framework requires it. Streamix provides a simpler model for consuming asynchronous streams where subscription patterns add unnecessary ceremony.

Each tool has its place. Choose based on where reactivity lives in your architecture.

---

**Acknowledgments:** Inspired by reactive programming patterns popularized by RxJS and enabled by JavaScript's async iterator and generator specifications.
