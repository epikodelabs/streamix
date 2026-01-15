# ✨ Streamix + Angular

Angular applications have traditionally relied on RxJS, even when the underlying problem is relatively simple. While RxJS provides a powerful and expressive foundation, its use at the component level often introduces additional ceremony that is unnecessary for local, sequential asynchronous flows.

Streamix is not intended to replace RxJS within an Angular application. Instead, it serves as a complementary tool for cases where reactive logic is confined to a component and is easier to reason about as **consumption** rather than **subscription**.

It is important to note that RxJS remains a core dependency when Angular is used extensively. Significant portions of Angular’s public API—including `HttpClient`, router events, forms, and other framework-level integrations—are still built on RxJS Observables. As a result, RxJS continues to be required for most non-trivial Angular applications.

At the same time, Angular’s reactivity model is evolving. With the introduction of **Signals**, Angular is establishing a framework-native reactive primitive for state propagation and change detection. This shift marks a clearer separation between:

* **framework-level reactivity**, increasingly centered on Signals, and
* **application-level asynchronous flow**, where multiple abstractions can coexist.

This distinction allows developers to reduce direct exposure to RxJS in component logic while retaining it where it is structurally required.

A simple search component illustrates this separation. Using RxJS typically involves Subjects, explicit teardown logic, and careful operator selection:

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

While effective, this approach requires manual subscription management and lifecycle signaling that can obscure intent.

Streamix preserves familiar reactive operators while replacing Observables with async generators and pull-based execution:

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

In this model:

* cancellation is implicit and lifecycle-bound
* cleanup occurs automatically on component destruction
* async/await can be used directly
* Subjects and explicit teardown logic are unnecessary

Viewed in this context, Streamix aligns naturally with Angular’s direction: Signals handle synchronous, framework-level reactivity, while Streamix provides a lightweight, explicit model for asynchronous flow—without attempting to displace RxJS where it remains essential.
