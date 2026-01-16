# ✨ Same Language, Different Execution

Streamix began as a learning exercise—rebuilding RxJS operators to understand how reactive programming works under the hood. What started as imitation gradually evolved into something distinct. By adopting async generators as the core abstraction, it became an async-first reactive system with familiar operators, pull-based execution, and seamless integration with JavaScript's async/await.

## ✨ A Shared Vocabulary

A typical reactive pipeline might look like this:

```ts
source.pipe(
  debounceTime(300),
  switchMap(fetchData)
)
```

Even without knowing the implementation details, the structure communicates the core ideas of reactive composition. These operator names have become part of the industry’s shared mental model—and Streamix deliberately speaks that same language.

This is not accidental. Shared vocabulary lowers the cost of adoption. When patterns prove useful across ecosystems, they naturally become common terms. Just as `map` and `filter` appear in nearly every programming language, reactive operators have converged on a stable, recognizable lexicon.

RxJS helped establish that vocabulary. Streamix builds on it—not to mirror behavior, but to avoid forcing developers to relearn concepts that already work.

---

## ✨ Different Under the Hood

Although the operator names look familiar, the execution model behind them is fundamentally different.

**RxJS**

* Push-based execution (the source controls when values flow)
* Scheduler-driven coordination
* Subscription-centric lifecycle
* Optimized for fan-out, multicasting, and framework integration
* ~50KB+ minified

**Streamix**

* Pull-based execution (the consumer controls when values are requested)
* Built on async iterators and async generators
* Iterator-first consumption (`for await...of`)
* Optimized for linear, sequential async flows
* ~9KB minified

In other words, the *API surface looks similar*, but the mechanics—and the trade-offs—are not.

---

## ✨ Choosing the Right Tool

RxJS excels at complex, highly dynamic reactive systems:

* Multiple subscribers
* Rich scheduling strategies
* Deep integration with frameworks like Angular
* Long-lived, shared event sources

Streamix targets a different space. It’s a strong fit when:

* Bundle size matters
* Reactive logic is scoped and local
* Pull-based semantics align better with your mental model
* You want async flows to read like ordinary `async` / `await` code

Neither approach is universally better. They are optimized for different constraints.

---

## ✨ Building on a Proven Foundation

RxJS demonstrated how powerful and expressive reactive composition can be. It established conventions around cancellation, error propagation, and operator chaining that are now widely understood.

Streamix takes that proven vocabulary and applies it to a different execution strategy:

* Pull-driven flow control
* Async-iterator-based lifecycles
* Native alignment with modern JavaScript
* A deliberately smaller and simpler core

This is not about replacing RxJS. It’s about offering an alternative when its strengths are more than you need—or when its execution model isn’t the best fit.

---

## ✨ In Summary

Streamix uses a familiar reactive vocabulary because it’s effective and widely understood.
What changes is *how* that vocabulary is executed.

The result is a library that prioritizes:

* Pull-based semantics
* Async/await-native control flow
* Smaller bundles
* Simpler, more explicit execution

Both RxJS and Streamix solve real problems.
The right choice depends on the shape of your application—not on ideology.

<p align="center">
  <strong>Streamix: familiar reactive language, async-iterator execution.</strong><br><br>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">Install from NPM</a> ·
  <a href="https://github.com/epikodelabs/streamix">Star on GitHub</a> ·
  <a href="https://epikodelabs.github.io/streamix">Read the Docs</a>
</p>

**Acknowledgments:** Inspired by reactive programming patterns popularized by RxJS and enabled by JavaScript’s async iterator and async generator specifications.
