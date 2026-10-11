# Angular Adoption Layer

`@epikodelabs/streamix/angular` lets Angular templates read Streamix state as ordinary values while Streamix owns the reactive subscription.

```ts
model = scope({ count: 0, name: '', doubled: self => self.count * 2 });
```

```html
<button (click)="model.count = model.count + 1">
  {{ model.count }} / {{ model.doubled }}
</button>
<input [(value)]="model.name">
```

## Supported template forms

The compiler supports text interpolation, safe native property/class/style and attribute bindings, events, two-way bindings, and compiler-owned `@if` / `@for` blocks. Inside those blocks it accepts safe attribute forms (`[attr.title]`, `data-*`, `aria-*`, and attribute interpolation of these safe attributes), and a single binding can combine loop-local reads with reactive sources, including arithmetic, comparisons, and conditionals:

```html
@for (row of model.items; track row.id) {
  <li [title]="row.name + model.suffix"
      [class.active]="row.enabled && model.active">
    {{ row.price * model.rate }}
  </li>
}
```

Such bindings evaluate initially, re-evaluate when a source emits, and refresh against the new loop context when a keyed row is reused; nested `@if` conditions and surviving branch bindings refresh too. The compiler keeps Angular in control of pipes, URLs, HTML, resource sinks, and other security-sensitive or ambiguous expressions — arbitrary method calls, assignments, untracked component fields, and unsafe sinks fail the build rather than silently becoming non-reactive.

Scope fields are value-first, so event handlers write them directly, as in `model.count = model.count + 1`. A bare atom field is a source object, not a writable template variable: `(click)="count = 1"` would replace that object and is rejected — call `count.set(1)` in a component method instead.

## Editor setup

Install `@angular/language-service` and configure the Streamix language-service plugin:

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "@epikodelabs/streamix/angular/editor/tsserver" }
    ]
  }
}
```

For inline templates, the plugin exposes atom reads as their current values to Angular's language service, so `{{ count * 2 }}` and `@if (count > 3)` type check without `$any()`. Restart the TypeScript server after changing the configuration. External `templateUrl` files are not virtualized yet; use explicit `.value` there or keep the affected template inline.

The compiler is authoritative for write safety. In particular, a two-way binding to a calculated scope member is rejected even if the editor cannot prove it is read-only.

## SSR, topology, and lifecycle limits

Angular-owned bindings render normally on the server. Lowered Streamix `@if` and `@for` blocks render empty hydration markers on the server and populate in the browser after hydration. Do not use those lowered blocks for SEO-critical or first-paint content.

The direct-DOM compiler requires static topology. A non-reactive Angular `@if`, `@for`, or `*ngIf` before a compiled binding is a build error; projection is also outside its ownership boundary. Keep the binding before the dynamic region, move it inside a compiler-owned Streamix block, or leave it Angular-owned.

Updates are frame-coalesced, with a timeout fallback for hidden tabs. The integration cleans up its listeners and reactive work when a component is destroyed. For Zone.js applications, `provideSxZoneScheduling()` schedules view updates without turning every state change into application-wide work; it configures a module-level, page-wide scheduler, not a per-application one.

A few structural rules keep generated bindings unambiguous: a file with more than one `@Component` class owning Streamix reactive fields is rejected — give each reactive component its own module; accessor-backed fields cannot be intercepted, so use a regular field for source replacement; and list keys in compiled keyed blocks must be unique — a collision is an error, not an implicit index fallback.

## Subscription ownership and teardown

Compiler-owned bindings live in a per-view binding table. Each static reactive
source used by an interpolation, safe native binding, or supported
compiler-owned block is subscribed by that table and remains live while Angular
keeps its view alive. Angular's `DestroyRef` tears down the table when the view
is destroyed: scheduled work is cancelled and every source unsubscribe runs
exactly once. If a compiler-owned slot is rebound, its previous listeners are
removed before the new source listeners are installed.

This is automatic for supported template syntax. Do not add a second manual
subscription to keep a compiled binding alive. Timers, service callbacks,
projected content, and rejected dynamic regions are explicit boundaries whose
cleanup remains application-owned.

### What is possible

- Text interpolation and safe native property, class, style, and attribute
  bindings can read Streamix sources.
- Supported events and two-way bindings can update writable scope fields.
- Compiler-owned `@if` and keyed `@for` blocks subscribe in active branches or
  rows and release those subscriptions when the branch or row is removed.
- A binding may combine reactive sources with loop-local values, arithmetic,
  comparisons, and conditionals when the dependency path is compiler-proven.

### What is not implicit

- Arbitrary method calls, assignments, component-field reads, pipes, URLs,
  HTML/resource sinks, and unsafe DOM sinks are not adopted as reactive
  bindings.
- Projection and non-reactive structural regions ahead of a compiled binding
  are outside the direct-DOM compiler's ownership boundary.
- A bare atom is not a writable Angular template variable; use a component
  method such as `count.set(value)` instead of assigning to `count`.

## Builder setup

Use the Streamix builder to enable compiler-aware templates, while delegating the application build to Angular:

```json
{
  "build": {
    "builder": "@epikodelabs/streamix/angular/builder:application",
    "options": {
      "delegateTarget": "your-app:application",
      "sourceRoot": "projects/your-app/src"
    }
  }
}
```

Static inline templates and literal `templateUrl` files are compiled in a virtual build tree; authored files are not modified. Without the builder, Streamix still works in Angular code, but templates do not receive compiler support.

## Benchmarks

The renderer benchmarks run in a real browser: headlessly with `npm run bench:angular`, or as an interactive page with `npm run bench:angular:serve`.
