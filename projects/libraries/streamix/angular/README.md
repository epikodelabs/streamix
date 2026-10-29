# Angular Adoption Layer

`@epikodelabs/streamix/angular` lets Angular components use Streamix state directly in their templates.

The idea is simple: write ordinary Angular templates, keep state in Streamix, and let the integration keep the view up to date.

```ts
model = scope({
  count: 0,
  busy: false,
  name: '',
  doubled: self => self.count * 2,
});
```

```html
<button (click)="model.count = model.count + 1">
  {{ model.count }} → {{ model.doubled }}
</button>

<input [(value)]="model.name">

<p [class.active]="model.count > 3">
  Hello, {{ model.name }}
</p>
```

You work with values in your component and template. Streamix handles the reactive connection behind the scenes.

## What feels natural

The Angular adoption layer supports the template patterns most applications use every day:

- text such as <code v-pre>{{ model.count }}</code>;
- simple expressions such as <code v-pre>{{ count * 2 }}</code>;
- native properties such as `[disabled]="model.busy"`;
- classes, styles, and safe attributes;
- events such as `(click)="save()"`;
- two-way input bindings such as `[(value)]="model.name"`;
- conditions with `@if`;
- lists with `@for`;
- nested conditions and lists.

You do not need a special template language or a manual subscription for each value. If Streamix can safely recognise the reactive state, it keeps that part of the template in sync.

## What your editor shows

Install @angular/language-service and configure Streamix as the Angular
language-service plugin in the project tsconfig:

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "@epikodelabs/streamix/angular/editor/tsserver" }
    ]
  }
}
```

It delegates to Angular's official language service after presenting inline
``@Component({ template: `...` })`` atom reads as current values. Thus
<code v-pre>{{ count * 2 }}</code> type-checks `count` as a number when `count = atom(1)`.
Restart the TypeScript server after changing this configuration.

The current editor companion intentionally covers inline templates only.
External `templateUrl` files still need explicit `.value` until an Angular
template-host virtual-file layer is added.

Scope members are typed as ordinary values, so scope-based templates stay clean
in the editor and in the build.

With the Streamix editor plugin active for **inline templates**, expressions
such as <code v-pre>{{ count * 2 }}</code> and `@if (count > 3)` are virtualized to `.value`
reads before Angular's language service checks them. Without this plugin,
Angular sees the raw atom type and may underline the expression. External
`templateUrl` files are not virtualized yet; use explicit `.value` there or
migrate the relevant template to inline form until external-template support
is implemented. Avoid `$any()` as a general workaround because it also hides
unrelated template type errors.

The editor also cannot see which scope members are writable, so it stays quiet on a two-way binding to a calculated member, such as `[(value)]="model.doubled"`. The build rejects that one, and the build's error is the authoritative one.

## Keep related state together

`scope(...)` is a useful home for the state that belongs to one feature.

```ts
user = scope({
  name: '',
  email: '',
  label: self => `${self.name} <${self.email}>`,
});
```

The scope can hold plain state, calculated values, asynchronous work, and cleanup under one owner. In templates, its members read like ordinary values:

```html
<span>{{ user.label }}</span>
<input [(value)]="user.name">
```

That means the template stays focused on what the UI should show, rather than on how reactivity is wired.

## Angular still owns the places where it should

Streamix is deliberately careful. Angular keeps control of component inputs, pipes, URLs, HTML, and other security-sensitive bindings. That keeps Angular’s normal safety checks in place.

If a template expression cannot be handled safely, the build explains why instead of silently rendering something that later stops updating. The usual fix is simple: keep the expression fully reactive, or calculate the value in the component first.

## Built for real application lifecycles

The integration cleans up its listeners and reactive work when an Angular component is destroyed. Angular-owned bindings render normally on the server. Lowered Streamix `@if` and `@for` blocks deliberately render empty hydration markers and populate in the browser after hydration, so do not use those blocks for SEO-critical or first-paint content.

For applications using Zone.js, Streamix can schedule its own view updates without turning every state change into unnecessary application-wide work.

## Getting started

To use Streamix-aware template features—direct atom reads, scope members, reactive expressions, compiled conditions, and compiled loops—change your project’s **build** target in `angular.json` to the Streamix builder.

The Streamix builder prepares supported components first, then delegates the rest of the application build to Angular. Your existing Angular build target remains the delegate target:

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

Without this builder, Streamix still works in Angular code, but templates do not receive the Streamix compiler support described above.

## Benchmarks

The renderer benchmarks run in a real browser. One command runs them headlessly and prints the results:

```bash
npm run bench:angular
```

To open the same suite as an interactive page instead:

```bash
npm run bench:angular:serve
```

Vite serves the page and prints a URL to open.

## The goal

Streamix for Angular is not a new component model. It is a way to use Streamix atoms, derived values, flows, and scopes in Angular without making template code feel like plumbing.

Write state as state. Write templates as templates. Let the integration connect them.

## Current compiler ownership boundaries

The compiler binds to static element paths when topology is fixed, and
instruments stable `data-sx-node` targets where Angular-owned control flow
can insert preceding sibling elements. Compiled bindings can therefore follow
`@if` or `@for` blocks without being shifted by dynamic sibling changes:

```html
@if (model.ready) { <p>Ready</p> }
<button (click)="save()">Save</button>
```

Reactive bindings **inside Angular-owned dynamic regions** still need the sx
structural compiler to own them; projected content and unrecognized directives
are not silently adopted.

Inside compiler-owned `@if` and `@for` bodies, the direct DOM compiler now
accepts safe native property bindings (`[title]`, `[disabled]`, etc.),
`[class.active]`, a conservative safe-style subset (`[style.width]`, etc.),
`[attr.title]` / `data-*` / `aria-*`, and attribute interpolation of these
safe attributes. Loop-local reads update when a keyed row's context changes;
reactive sources use normal binding-table subscriptions. A single block
binding can now combine a loop-local read and a reactive source, including
arithmetic, comparisons and conditional expressions:

```html
@for (row of model.items; track row.id) {
  <li [title]="row.name + model.suffix"
      [class.active]="row.enabled && model.active">
    {{ row.price * model.rate }}
  </li>
}
```

Such bindings evaluate initially, re-evaluate when the source emits, and
refresh against the new loop context when an existing keyed row is reused.
Nested `@if` conditions and surviving branch bindings are refreshed too.
Generated DOM bindings do not create an Angular view or re-enter change
detection. Arbitrary method calls, pipes, assignments, untracked component
fields, URL, HTML, resource and unsafe style sinks still fail rather than
bypassing Angular's expression semantics or sanitizer. This is not support
for mixing arbitrary Angular component state with Streamix; local paths must
be compiler-proven from the enclosing loop context.

**Template source ownership:** Static inline templates and literal
`templateUrl: './component.html'` files use the same compiler. External HTML
is read relative to its owning component; only the virtual build receives the
compiled inline template. The authored TS and HTML are left untouched. Dynamic
computed template metadata and external templates outside the configured source
root are rejected when compiler ownership is required.

**Multiple component classes:** Files containing more than one `@Component` class and Streamix reactive fields are rejected; place each reactive component in its own module so the generated lifecycle and bindings have one unambiguous owner.

**Accessor-backed fields:** `SourceReferenceCell` cannot intercept changes to accessor properties. Use a regular field for source replacement or explicitly rebind the source.

**Scheduler ownership:** `provideSxZoneScheduling()` configures the current
module-level Streamix renderer scheduler, so it is a page-wide setting, not a
per-Angular-app setting. Hosting multiple Angular applications with different
zones requires a dedicated scheduler per owner before that setup is supported.

**List keys:** compiled keyed blocks require unique keys. A collision is an
error rather than an implicit index-based fallback, which would disguise a
broken identity contract.

**Event writes:** Scope fields are value-first properties, so an event handler
may use `(click)="model.count = model.count + 1"`. A bare `count = atom(0)`
is a source object, not a writable template variable: `(click)="count = 1"`
would replace that object, so the compiler rejects it. Call `count.set(1)` in
a component method instead. The editor's implicit atom-write virtualization
helps type the expression but does not override this build-time safety rule.
