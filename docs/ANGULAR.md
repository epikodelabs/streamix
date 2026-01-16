# ✨ Async Generators Meet Angular Components

**Streamix** brings async-generator–based reactive programming to TypeScript. It offers familiar operators, but operates on async iterables rather than Observables. This enables pull-based execution with lifecycle management handled naturally through `async`/`await`.

Angular applications have traditionally relied on RxJS for reactive programming. RxJS is powerful and essential to the framework, but at the component level it can introduce ceremony—Subjects, subscriptions, and explicit cleanup—even for simple, localized asynchronous flows.

At present, fully replacing RxJS in Angular is not feasible without modifying core framework components. The emergence of Signals, however, suggests a future where Angular’s reactivity is less tightly coupled to RxJS, potentially opening the door to broader integration of consumption-based reactive models.

## ✨ RxJS Remains Central

RxJS is a core Angular dependency. Major framework APIs—`HttpClient`, router events, forms—are built on RxJS Observables. Production applications will continue to need RxJS for framework integration.

Angular's reactivity is evolving with **Signals**, a native primitive for state propagation and change detection. This creates separation between:

* **Framework-level reactivity** (Signals)
* **Application-level asynchronous flow** (multiple approaches possible)

Developers can simplify component logic while keeping RxJS where the framework requires it.

## ✨ A Practical Example

A typical search component in RxJS:

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

This requires manual subscription management and lifecycle coordination.

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

* Automatic cancellation when the loop exits
* Lifecycle-bound cleanup
* Direct async/await integration
* No Subjects or manual teardown

## ✨ Complementary Approaches

Streamix aligns with Angular's evolution. Signals handle framework-level reactivity. Streamix provides a straightforward model for component-level async flows. RxJS remains essential for framework integration and complex scenarios.

Each tool serves its purpose. Choose based on the problem at hand.
