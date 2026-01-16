# ✨ Same Language, Different Execution

Streamix began as an exploration of reactive programming mechanics—initially reimplementing familiar operators to understand their behavior. As the design evolved, it converged on async generators as a clearer foundation for pull-based execution. The result is an async-first reactive system that preserves familiar operator semantics while aligning closely with JavaScript’s native `async` / `await`.

---

## ✨ A Shared Vocabulary

A typical reactive pipeline might look like this:

```ts
source.pipe(
  debounceTime(300),
  switchMap(fetchData)
)
```

The structure alone communicates the intent of the composition. These operator names have become an industry-wide mental model, and Streamix deliberately adopts that vocabulary.

This choice is pragmatic. When patterns consistently solve real problems, they become shared language. Just as `map` and `filter` appear across programming ecosystems, reactive operators have converged on a stable, recognizable lexicon.

Streamix uses that vocabulary to reduce cognitive overhead—not to replicate RxJS behavior, but to reuse concepts developers already understand.

---

## ✨ Different Under the Hood

While the operator names are familiar, the execution model is not.

RxJS established many of the conventions that define reactive programming today—operator composition, cancellation semantics, and error propagation. Streamix builds on that conceptual foundation while making different architectural choices.

**RxJS**

* Push-based execution (sources control emission timing)
* Scheduler-driven coordination
* Subscription-centric lifecycle
* Optimized for multicasting and framework integration
* ~50KB+ minified

**Streamix**

* Pull-based execution (consumers control pace)
* Built on async iterators and async generators
* Iterator-first consumption (`for await...of`)
* Optimized for linear, sequential async flows
* ~9KB minified

The surface API may resemble RxJS, but the mechanics—and the trade-offs—are fundamentally different.

---

## ✨ Choosing the Right Tool

RxJS is well-suited for complex reactive systems:

* Multiple subscribers
* Advanced scheduling requirements
* Deep framework integration (e.g. Angular)
* Long-lived shared event sources

Streamix targets a narrower scope:

* Local, component-level reactive logic
* Pull-based control aligned with `async` / `await`
* Smaller bundles
* Explicit, sequential async flows

Neither approach is universally better. Each is optimized for different constraints.

---

**Acknowledgments:** Inspired by reactive programming patterns popularized by RxJS and enabled by JavaScript’s async iterator and async generator specifications.
