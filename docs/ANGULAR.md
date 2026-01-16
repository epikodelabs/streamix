# ✨ Streamix + Angular

**Streamix** brings async generator-based reactive programming to TypeScript. It provides familiar operators like `map`, `filter`, `debounce`, and `switchMap`, but works with async iterables instead of Observables. This enables pull-based execution with automatic lifecycle management through native async/await syntax.

Angular applications have traditionally relied on RxJS for reactive programming. While RxJS provides a powerful foundation, its use at the component level can introduce ceremony that feels unnecessary for simple, local asynchronous flows.

Streamix complements RxJS in Angular applications. It's designed for scenarios where reactive logic stays within a component and is more naturally expressed as **consumption** rather than **subscription**.

## ✨ RxJS Remains Central

RxJS is a core dependency in Angular. Major parts of Angular's API—`HttpClient`, router events, forms, and framework integrations—are built on RxJS Observables. Most production Angular applications will continue to need RxJS.

Angular's reactivity model is evolving alongside this. With **Signals**, the framework now has a native primitive for state propagation and change detection. This creates a natural separation:

* **Framework-level reactivity** centers on Signals
* **Application-level asynchronous flow** can use different approaches

This allows developers to simplify component logic while keeping RxJS where the framework requires it.

## ✨ A Practical Example

Consider a search component. The typical RxJS implementation uses Subjects, explicit teardown, and careful operator selection:

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

This works well but requires manual subscription management and lifecycle coordination.

Streamix uses the same reactive operators with async generators:

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

The key differences:

* Cancellation happens automatically when the loop exits
* Cleanup is tied to component lifecycle
* Direct async/await integration
* No Subjects or manual teardown needed

## ✨ Complementary Approaches

Streamix fits naturally with Angular's evolution. Signals handle synchronous, framework-level reactivity. Streamix offers a straightforward model for component-level asynchronous flows. RxJS remains essential for framework integration and complex reactive scenarios.

Each tool serves its purpose. Choose based on the problem at hand.