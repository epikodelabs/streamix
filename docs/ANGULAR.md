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

The compiler supports text interpolation, safe native property/class/style and attribute bindings, events, two-way bindings, and compiler-owned `@if` / `@for` blocks. It keeps Angular in control of pipes, URLs, HTML, resource sinks, and other security-sensitive or ambiguous expressions. Unsupported expressions fail the build rather than silently becoming non-reactive.

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

Updates are frame-coalesced, with a timeout fallback for hidden tabs. List keys in compiled keyed blocks must be unique.

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

Static inline templates and literal `templateUrl` files are compiled in a virtual build tree; authored files are not modified. See the package [README](https://github.com/epikodelabs/streamix/blob/main/projects/libraries/streamix/angular/README.md) for the complete binding matrix and scheduler guidance.
