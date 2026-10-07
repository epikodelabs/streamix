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
`label`, `active`, and `opacity` are Streamix `DependencySource`s, it emits
direct browser bindings while retaining the authored Angular syntax.

These are bare component fields. Angular templates do not automatically
destructure a Scope into the component context; use `model.count` (not
`count`) when the source belongs to a Scope.

Ordinary Angular values stay ordinary Angular bindings. Source transparency is
compile-time metadata-driven; the runtime never duck-types arbitrary objects.

Application templates use only standard Angular bindings. The compiler owns
the reactive subscriptions and direct DOM updates; `[sx.*]` bindings are not
part of the public template API.

Authored `.value` syntax remains supported too, but is no longer required for
bindings the build adapter can classify:

```html
<span>{{ count.value }}</span>
<button [disabled]="busy.value"></button>
```

### Scope values

Streamix scopes stay value-first in component code. The value is a plain
property read; the atom behind it comes from the scope's public accessor:

```ts
model.count            // number (value)
model.get('count')     // Atom<number>
model.set('count', 2)  // write through the atom
```

Templates stay value-first too:

```html
<span>{{ model.count }}</span>

<button
  [disabled]="model.busy"
  [attr.aria-label]="model.label"
  [class.active]="model.active"
  [style.opacity]="model.opacity">
  Save
</button>

<p>{{ model.count * model.price }}</p>
```

The TypeScript-aware resolver maps those value paths to their atom accessors
(`model.count` -> `model.get('count')`). The generated browser bindings
subscribe to the atom; the Angular SSR fallback reads `.value` from it.

### Control flow

Use Angular's native control flow—there is no Streamix structural directive:

```html
@if (model.ready) {
  <p>{{ model.message }}</p>
}

@for (item of model.items; track item.id) {
  <app-item [item]="item" />
}

@switch (model.status) {
  @case ('ready') { <p>Ready</p> }
}
```

When every read in the condition, iterable, or switch value is a
compile-time-resolved atom or Scope member, the compiler takes the block over:
Angular's template gets an empty marker element (`<span data-sx-block="0">`)
and the compiled view renders the branches itself, straight to the DOM. The
same applies to classic `*ngIf`/`*ngFor`. Expressions are compiled, not just
paths:

```html
@if (model.count > 3 && model.ready) { ... }
@for (row of model.items.concat(model.extras); track row.id) { ... }
```

Blocks nest, and `@let` works inside them:

```html
@for (row of model.items; track row.id) {
  @let total = row.price * row.quantity;
  <li>
    @if (row.done) { <s>{{ total }}</s> } @else { <span>{{ total }}</span> }
  </li>
}
```

Anything the compiler cannot prove — a body containing a component, directive,
or pipe, a condition that mixes atoms with ordinary component state, a
non-literal `@case` — is either left entirely to Angular or rejected at build
time with the read that could not be compiled. There is no partial handover.

### Events and two-way bindings

Native events compile to listeners the runtime owns:

```html
<button (click)="add($event)">Add</button>
<button (click.stop.prevent)="save()">Save</button>
<input (keyup.enter)="submit()">
```

Modifiers are reproduced: `.stop`, `.prevent`, `.self`, `.once`, `.capture`,
and key filters such as `.enter`. The Angular binding is removed from the
template in the same step, so a click runs exactly one handler. Component
outputs, animations, `window:`/`document:` targets, unknown event or modifier
names, and handlers that are not method calls stay Angular-owned untouched.

Two-way bindings compile for writable atoms on native elements:

```html
<input [(value)]="model.name">
<input [(checked)]="model.notifications">
```

The property binding owns the read direction and the listener writes the DOM
value back through the atom (`scope.set` for Scope members) — no change
detection in either direction. Only `value`, `checked`, `selectedIndex`, and
`valueAsNumber` are writable this way; URL/HTML sinks, `attr.*`, `style.*`,
derived scope members, and component elements are refused with a build error.

## Expressions

Source-transparent expressions are compiled wherever every read is a reactive
source:

```html
{{ count }}
{{ count * 2 }}
{{ count * price }}
{{ enabled ? 'On' : 'Off' }}
```

For Streamix sources these are normalized internally to `.value` reads for the
Angular SSR fallback and compiled to direct source/expression bindings in the
browser.

An expression that mixes a reactive read with ordinary component state is a
build error:

```html
{{ count * multiplier }}   <!-- count is an atom, multiplier is plain state -->
```

Angular would evaluate that once and never update it, so the compiler refuses
it and names the read. Make every read reactive — scope members work — or
compute the value into a plain field and bind that. The same rule covers
`@defer` triggers and bodies and root-level `@let` declarations, which are all
Angular-owned.

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

Server rendering keeps the lowered block markers **empty** and renders every
other binding through its Angular fallback. The client's template declares an
empty marker, so injecting block content into it during server rendering makes
hydration mismatch and Angular re-renders the subtree; the compiled view fills
the marker right after mounting instead (`afterNextRender()` on the client,
the generated `ngAfterViewInit()` under server rendering). Event listeners are
never attached while rendering on the server.

The browser setup subscribes to `busy` and `count` themselves, and
interpolation updates Angular's existing `Text` node rather than replacing
`element.textContent`, so the nodes hydration produced stay in place.

For DOM reuse to engage, the server half of the application must register
server rendering — that is what serializes the `ng-state` script the client
reads:

```ts
bootstrapApplication(AppComponent, {
  providers: [provideClientHydration(), provideServerRendering()],
});
```

`npm run test:node` renders a fixture through `renderApplication` and asserts
this contract; `hydration.spec.ts` boots the client over the committed server
document and asserts both halves — Angular reuses the server's nodes, and the
compiled view then takes the markers over.

## Angular sanitization boundary

Automatic direct lowering is intentionally conservative. The compiler never
takes ownership of a binding whose value normally passes through Angular
security sanitization, including URL/resource/HTML sinks such as:

```html
[href]="url"
[src]="image"
[innerHTML]="html"
[attr.href]="url"
[style.background-image]="background"
```

A reactive read in one of those positions is a build error, because Angular
would render it once and never update it. The explicit `.value` form stays
Angular-owned (`[href]="url.value"`) so Angular's sanitizer runs on every
value.

Source-transparent auto-lowering covers unambiguous safe DOM properties,
classes, `aria-*`/`data-*` plus a small safe attribute set, and a conservative
set of direct styles such as `opacity`, `width`, `height`, `display`, and
`visibility`.

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

`provideSxZoneScheduling()` installs an environment initializer that resolves
`NgZone` and configures the renderer once for that application. Without this
provider, Streamix runtime paths never resolve `NgZone`, even if Zone.js is
present on the page for another application or library. If a global `Zone`
exists and the provider was never installed, the renderer warns once — every
Streamix update would otherwise drag a global change-detection pass along.

```text
compiled binding
  source emission
  -> integer slot dirty
  -> shared renderer frame
  -> exact DOM write

zone-backed Angular + provideSxZoneScheduling()
  shared renderer frame
  -> scheduled through NgZone.runOutsideAngular(...)
```

## Compiled block semantics

A lowered `@if`/`@for`/`@switch` renders through the structural runtime:

- initial rendering is synchronous;
- emissions are frame-coalesced and the latest value wins;
- an expression over several sources re-evaluates at most once per frame;
- keyed collection views are reused and moved rather than recreated;
- collection context (`index`, `count`, `first`, `last`, `even`, `odd`) is
  available as `item`/`$index`-style locals, including `@empty`;
- nested blocks re-evaluate when the loop item that owns them changes;
- duplicate keys are rejected before DOM mutation;
- teardown releases every subscription and removes every listener.

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

The compiler also records top-level component fields that hold reactive source
identities. Replacing one of those plain fields is a Streamix notification path
in compiled views:

```ts
this.count = anotherAtom;
```

The generated `__sxRefs` bridge synchronously tears down the old Streamix setup
and recreates it against the new source. No Angular signal,
`ChangeDetectorRef`, template event, or Angular change-detection pass is used
for that rebind — the runtime never resolves `ChangeDetectorRef` and never
writes a signal.

Generated setup uses static `Element.children` paths. There are no
`querySelector()` calls in the compiled hot path; a lowered block is addressed
through its marker element, which the browser replaces with a comment anchor.

Dynamic element topology in the same static region — content projection, an
Angular-owned structural directive that shifts element indices — is rejected by
the static compiler rather than addressed by a path that would drift.

## Build integration

`@epikodelabs/streamix/angular/compiler` exposes:

```ts
compileSxComponent(...)
transformAngularComponentTemplate(...)
installSxLifecycleIntoComponentSource(...)
emitComponentSetup(...)
```

`installSxLifecycleIntoComponentSource` is a TypeScript AST transform: it
parses the component, merges an authored `ngAfterViewInit`, appends the
generated members and the hoisted setup function, and prints the file. It
requires `typescript` (declared as an optional peer) and is meant for the
virtual build output, never for authored sources.

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
    // e.g. model.count -> model.get('count')
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
to source-path map. Two-way bindings use the same idea through
`resolveReactiveWritable` / `writableSourcePaths` / `scopeWritablePaths`: only
paths a write can reach (an atom with `set`/`next`) may resolve.

This metadata is compile-time only. It is never emitted as a runtime source
classifier.

See the [builder README](./builder/README.md) for the build-tool contract.

## App builder (`@epikodelabs/streamix/angular/builder`)

The builder ships as a secondary entry point of this package, compiled into
`dist/streamix/fesm2022` alongside the runtime and the compiler, so an
application references it as `@epikodelabs/streamix/angular/builder:application`
in `angular.json`. It runs the generator in
`angular/builder/src/generate-project.ts`, which compiles every component under
the configured `sourceRoot` and writes the virtual results into
`.angular/streamix/<app>/src/` (generated output, not committed), then delegates
the actual build or serve to the standard Angular targets.

The app6 wiring in `angular.json` (trimmed to the Streamix-relevant parts):

```json
{
  "application": {
    "builder": "@angular/build:application",
    "options": {
      "fileReplacements": [
        {
          "replace": "projects/apps/app6/src/main.ts",
          "with": ".angular/streamix/app6/src/main.ts"
        }
      ]
    }
  },
  "build": {
    "builder": "@epikodelabs/streamix/angular/builder:application",
    "options": {
      "delegateTarget": "app6:application",
      "sourceRoot": "projects/apps/app6/src"
    }
  },
  "serve": {
    "builder": "@epikodelabs/streamix/angular/builder:application",
    "options": {
      "delegateTarget": "app6:dev-server",
      "sourceRoot": "projects/apps/app6/src"
    }
  },
  "dev-server": {
    "builder": "@angular/build:dev-server",
    "configurations": {
      "development": { "buildTarget": "app6:application:development" },
      "production": { "buildTarget": "app6:application:production" }
    }
  }
}
```

`fileReplacements` live on the `application` target itself so both build and
serve pick up the virtual component from one place.

### Why the wrapper sits around the dev-server

The dev-server never *executes* the builder of its `buildTarget`. It reads
that target's raw options, validates them against that target's builder
schema, and feeds them directly into the application builder internals. A
delegating builder used as the `buildTarget` therefore never runs: its
options reach the application builder without `tsConfig` or `optimization`
and crash option normalization with `The "path" argument must be of type
string. Received undefined`, while the missing `optimization` defaults to
`true` and produces the misleading `Prebundling has been configured but will
not be used because scripts optimization is enabled` warning.

The delegation chain must therefore be inverted for serving:
`serve` (wrapper) -> `dev-server` (real) -> `application` (real).

### Option forwarding

The wrapper forwards every option it receives except `delegateTarget`. Two
Architect/CLI behaviors shape that code:

- CLI schema validation materializes every schema-declared option as a key;
  unset ones carry `undefined`. Architect merges target options with a
  shallow spread, so an explicit `undefined` would clobber the delegate's
  configured `buildTarget`/`tsConfig`. The wrapper strips `undefined`/`null`.
- Array/object options materialize as empty containers (`allowedHosts: []`,
  `define: {}`), which the application builder's strict schema rejects as
  unknown options. Empty containers are stripped as well.

`builder/schema.json` declares the common dev-server and application builder
flags so the CLI accepts them (`ng serve app6 --port 4300`). Flags it does
not declare are rejected by the CLI up front, and flag/delegate mismatches
fail validation in the delegate target with the standard schema error.

The wrapper is an async-generator builder: it streams the delegate's outputs
back (so watch mode and the dev-server stay alive) and stops the delegate run
when it is itself torn down.

### Rebuild hook

While the delegate runs, the wrapper watches every file under `sourceRoot` and
re-runs the generator when one changes. Editing `app.component.ts` under
`ng serve` therefore flows through the full chain — regenerate the virtual
component, the dev-server rebuilds on its own (the virtual file is in its
module graph), HMR ships the update — with no restart. Regeneration runs
asynchronously and is coalesced per change set; a mid-edit save that fails
compilation keeps the previously generated component serving and logs a
warning, and the next successful save retries.

Inputs are watched via their directory (filtered by filename) so editors
that save by rename/replace do not invalidate the watcher.

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
