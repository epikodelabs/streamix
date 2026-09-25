# @epikodelabs/streamix/angular

Angular bindings for Streamix with compiler-owned direct reactive rendering.

Angular owns component structure, lifecycle, SSR and hydration. Streamix owns
reactive model state. When the compiler can prove a template expression reads a
`DependencySource`, browser updates go directly to the exact DOM target instead
of waiting for a component change-detection pass.

## Source-transparent templates

The preferred template syntax is normal Angular syntax:

```html
<span>{{ count }}</span>

<button
  [disabled]="busy"
  [attr.aria-label]="label"
  [class.active]="active"
  [style.opacity]="opacity">
  Save
</button>
```

When the build adapter's TypeScript checker reports that `count`, `busy`,
`label`, `active`, and `opacity` are Streamix `DependencySource`s, the browser
binding plan is equivalent to:

```html
<span [sx.text]="count"></span>

<button
  [sx.disabled]="busy"
  [sx.attr.aria-label]="label"
  [sx.class.active]="active"
  [sx.style.opacity]="opacity">
  Save
</button>
```

Ordinary Angular values stay ordinary Angular bindings. Source transparency is
compile-time metadata-driven; the runtime never duck-types arbitrary objects.

The low-level explicit `sx` syntax remains available when desired:

```html
<span [sx.text]="count"></span>
<input [sx.value]="name">
```

Authored `.value` syntax remains supported too, but is no longer required for
bindings the build adapter can classify:

```html
<span>{{ count.value }}</span>
<button [disabled]="busy.value"></button>
```

### Scope values

Streamix scopes stay value-first in component code:

```ts
model.count       // number
model.refs.count  // Writable<number>
```

Templates stay value-first too:

```html
<span>{{ model.count }}</span>
<button [disabled]="model.busy">Save</button>
<p>{{ model.count * model.price }}</p>
```

The TypeScript-aware resolver maps those value paths to their reactive backing
refs (`model.count` -> `model.refs.count`). The generated browser bindings
subscribe to `refs`; the Angular SSR/hydration fallback reads `.value` from the
ref internally. `refs` mirrors nested scope state recursively, so
`model.user.name` can map to `model.refs.user.name`.

## Expressions

Source-transparent interpolation extends to expressions:

```html
{{ count }}
{{ count * 2 }}
{{ count * price }}
{{ enabled ? 'On' : 'Off' }}
```

For Streamix sources these are normalized internally to `.value` reads for the
Angular SSR fallback and compiled to direct source/expression bindings in the
browser.

Hybrid expressions keep Angular semantics:

```html
{{ count * multiplier }}
```

If `count` is a Streamix source and `multiplier` is ordinary Angular state, the
compiler subscribes to `count` and coalesces one local Angular view invalidation.
Angular-owned changes to `multiplier` continue to behave normally.

## SSR and hydration

Source-transparent syntax is rewritten only in the Angular fallback template:

```html
[disabled]="busy"
{{ count * 2 }}
```

becomes, for Angular server rendering/hydration:

```html
[disabled]="busy.value"
{{ count.value * 2 }}
```

The generated browser setup still subscribes to `busy` and `count` themselves.
After hydration, `ɵinstallSxCompiledView()` installs those direct subscriptions
with `afterNextRender()`.

Interpolation updates Angular's existing `Text` node rather than replacing
`element.textContent`, preserving hydration node identity.

Explicit `[sx.*]` bindings are likewise rewritten to Angular-native `.value`
fallbacks on the server.

## Angular sanitization boundary

Automatic direct lowering is intentionally conservative. The compiler does not
take ownership of bindings whose values normally pass through Angular security
sanitization, including URL/resource/HTML sinks such as:

```html
[href]="url"
[src]="image"
[innerHTML]="html"
[attr.href]="url"
[style.background-image]="background"
```

Those remain Angular-owned even when their expression is a Streamix source.
For source-transparent syntax the fallback compiler still unwraps the source,
for example `[href]="url"` becomes Angular-owned `[href]="url.value"`; it
just does not install a direct DOM writer for that sink.

Known unsafe explicit direct bindings such as `[sx.href]` and
`[sx.style.background-image]` are rejected by the compiler rather than silently
bypassing Angular's sanitizer.

Source-transparent auto-lowering currently covers unambiguous safe DOM
properties, classes, `aria-*`/`data-*` plus a small safe attribute set, and a
conservative set of direct styles such as `opacity`, `width`, `height`,
`display`, and `visibility`.

## Change detection and zones

Direct bindings do not depend on `ChangeDetectionStrategy.OnPush`.

Zoneless applications require no zone integration and Streamix does not resolve
or call `NgZone` by default.

For an application explicitly configured to use Zone.js-backed Angular change
detection, opt into outside-zone renderer scheduling:

```ts
import { provideZoneChangeDetection } from '@angular/core';
import { provideSxZoneScheduling } from '@epikodelabs/streamix/angular';

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection(),
    provideSxZoneScheduling(),
  ],
});
```

`provideSxZoneScheduling()` is the configuration marker. Without it, the
Streamix Angular adapter never resolves `NgZone`, even if Zone.js is present on
the page for another application or library.

```text
pure Streamix binding
  source emission
  -> integer slot dirty
  -> shared renderer frame
  -> exact DOM write

zone-backed Angular + provideSxZoneScheduling()
  shared renderer frame
  -> scheduled through NgZone.runOutsideAngular(...)

hybrid binding
  Streamix emission
  -> shared renderer frame
  -> one local Angular view invalidation
```

## Structural `*sx`

`*sx` is the structural bridge for scalar values and keyed collections:

```html
<div *sx="user as user">
  {{ user.name }}
</div>

<li *sx="let item of items; trackBy: trackItem; let i = index">
  {{ i }} — {{ item.name }}
</li>
```

Runtime semantics:

- initial rendering is synchronous;
- emissions are frame-coalesced and the latest value wins;
- replacing a source unsubscribes the previous source and cancels stale work;
- `undefined` removes a scalar/collection view;
- keyed collection views are reused and moved rather than recreated;
- collection context (`index`, `count`, `first`, `last`, `even`, `odd`) is updated on reuse;
- duplicate keys are rejected before DOM mutation;
- host destruction releases subscriptions;
- only the embedded Angular view is refreshed, so an OnPush parent does not block updates.

## Compiler/runtime model

Compiler output uses a preallocated binding table:

```text
slot 0 -> text node       -> count
slot 1 -> property        -> busy
slot 2 -> class           -> active
slot 3 -> text expression -> [count, price]
```

One component table has one shared scheduler registration. Repeated source
emissions mark integer slots dirty; a frame flush visits only those slots.

Generated setup uses static `Element.children` paths. There are no `data-sx`
markers or `querySelector()` calls in the compiled hot path.

Dynamic element topology in the same static region—Angular structural
directives, built-in control-flow blocks, or content projection—is rejected by
the static compiler and belongs to the structural compiler path instead.

## Build integration

`@epikodelabs/streamix/angular/compiler` exposes:

```ts
compileSxComponent(...)
transformAngularComponentTemplate(...)
installSxLifecycleIntoComponentSource(...)
emitComponentModule(...)
```

Source-transparent syntax requires compile-time reactive-path metadata. A real
builder should supply `resolveReactiveSource(path)` from its component
TypeScript checker:

```ts
compileSxComponent({
  componentPath,
  template,
  resolveReactiveSource(path) {
    // Standalone atom/readable:
    if (componentTypeChecker.isDependencySource(path)) return path;

    // Value-first Scope member:
    return componentTypeChecker.scopeRefPath(path);
    // e.g. model.count -> model.refs.count
  },
});
```

Adapters with already-discovered metadata can use the convenience inputs:

```ts
compileSxComponent({
  componentPath,
  template,
  dependencySourcePaths: ['count', 'busy'],
  scopeValuePaths: {
    model: ['count', 'price', 'busy', 'user.name'],
  },
});
```

For unusual model layouts, `reactiveSourcePaths` accepts an explicit value-path
to source-path map. The legacy `isDependencySource` classifier remains accepted
for standalone sources, but cannot express value-first Scope members.

This metadata is compile-time only. It is never emitted as a runtime source
classifier.

See `src/compiler/BUILD-INTEGRATION.md` for the build-tool contract.

## Benchmarks

The `benchmarks/` directory contains a real-browser runner covering raw DOM,
compiled scalar text, coalesced writes, and keyed reorders.

From a workspace where Vite can resolve the Streamix packages:

```bash
npx vite ./angular/benchmarks
```

Results are printed with `console.table()` and as JSON. The runner is
intentionally claim-free; comparisons should use the same browser/process,
production build, workload, warmup/sample counts, and creation/destruction
policy.
