# sx build integration

The build contract has five responsibilities:

```text
Angular component TypeScript
        ↓
TypeScript checker resolves value paths to reactive source paths
        ↓
Angular component template
        ↓
parse / classify Streamix bindings
        ↓
┌────────────────────────────────────┬──────────────────────────────┐
│ Angular SSR/hydration fallback     │ generated *.sx.ts module    │
│                                    │                              │
│ source-transparent reads rewritten │ createBindingTable(N)        │
│ to `.value`                        │ ɵsx* direct instructions     │
│ explicit [sx.*] rewritten to       │ static element paths         │
│ Angular-native `.value` bindings   │                              │
└────────────────────────────────────┴──────────────────────────────┘
        ↓
component source lifecycle insertion
        ↓
__sxRefs = ɵinstallSxSourceReferences(this, [...])
        ↓
ɵinstallSxCompiledView(this, ɵsetupSxBindings, {
  sourceReferences: __sxRefs,
})
        ↓
afterNextRender() (browser only)
        ↓
install direct binding table
        ↓
DestroyRef.onDestroy() -> teardown.destroy()
```

## Source transparency

The template compiler must not decide at runtime whether an arbitrary object is
a Streamix source. A real builder supplies compile-time path metadata through
`resolveReactiveSource(path)`. The resolver returns the DependencySource path
backing the authored value path.

Example authored template:

```html
<span>{{ count }}</span>
<button [disabled]="busy"></button>
```

When the checker resolves `count` and `busy` to themselves as standalone
DependencySources, the Angular SSR/hydration fallback becomes:

```html
<span>{{ count.value }}</span>
<button [disabled]="busy.value"></button>
```

while the generated browser setup subscribes directly to `ctx.count` and
`ctx.busy`.

A value-first Scope uses the same contract:

```html
{{ model.count * model.price }}
```

can resolve to dependencies `model.refs.count` and `model.refs.price`. The
Angular fallback reads `model.refs.count.value` / `model.refs.price.value`,
while authored component and template code remains `model.count` / `model.price`.

`compileSxComponent()` accepts:

- `resolveReactiveSource(path)` — preferred TypeScript-aware resolver;
- `dependencySourcePaths` — standalone source convenience metadata;
- `scopeValuePaths` — exact value-first Scope members, mapped through `refs`;
- `reactiveSourcePaths` — explicit value-path -> source-path mappings.

For example, `model.count` may resolve to `model.refs.count`, while `count` may
resolve to `count`. Ordinary Angular values return `undefined` and are not
rewritten. The legacy `isDependencySource(path)` classifier is still accepted
for standalone sources.

## Source-reference replacement

The compiler also derives the top-level component fields whose **identity** is
consumed by generated Streamix bindings. For example:

```ts
class CounterComponent {
  count = atom(1);

  replace(next: Writable<number>) {
    this.count = next;
  }
}
```

with:

```html
<span>{{ count }}</span>
```

emits a component-local `__sxRefs` registry through
`ɵinstallSxSourceReferences(this, ["count"])`. The compiled view subscribes to
that registry. Streamix installs a narrow instance accessor for the
compiler-selected plain field, and a different source identity synchronously:

```text
this.count = next
  -> destroy old Streamix binding table
  -> unsubscribe old source / invalidate queued renderer work
  -> create the generated setup against the new source
  -> render the new source's current value
```

This path does **not** use Angular signals, `ChangeDetectorRef`, a template
event, or an Angular change-detection pass. It is compiler-owned source
reference reactivity, not general object observation. Only top-level fields
selected from the generated binding plan are observed.

Value changes inside the source still use the normal Streamix subscription and
renderer scheduler. Replacing a value-first Scope root similarly rebuilds the
bindings that resolve through its `refs` mirror.

Structural `*sx` participates in the same bridge without requiring direct DOM
lowering. For a simple source field such as:

```html
<span *sx="source as value">{{ value }}</span>
```

the build transform adds the compiler-only microsyntax link:

```html
<span *sx="source as value; sourceRef: __sxRefs.source">{{ value }}</span>
```

Angular desugars that link to `sxSourceRef`. The directive subscribes to the
component-local reference cell, so `this.source = next` calls the directive's
rebind path directly and synchronously. Authored templates never contain or
manage `__sxRefs` themselves.

Complex structural source expressions are intentionally not instrumented by
this bridge yet; the first pass is limited to simple top-level component fields
whose identity can be observed unambiguously.

## Sanitization boundary

Automatic lowering is limited to bindings that are safe to write directly.
URL/resource/HTML sinks remain Angular-owned so Angular's sanitizer stays in the
path. Examples intentionally not auto-lowered:

```html
[href]="url"
[src]="image"
[innerHTML]="html"
[attr.href]="url"
[style.background-image]="background"
```

When one of these paths is a compile-time-proven Streamix source, source
transparency still rewrites the Angular binding to `.value` (for example
`[href]="url.value"`), but no direct DOM writer is generated. Angular remains
responsible for sanitization and rendering of that sink.

Known sanitizer-sensitive explicit direct bindings such as `[sx.href]` are
rejected by the compiler.

## Why the Angular fallback remains

`afterNextRender()` is intentionally a browser rendering hook. The server still
needs to produce the authored initial value, and hydration must see compatible
DOM.

Therefore compiler-owned source-transparent bindings receive `.value`
fallbacks in the Angular template. Authored `.value` bindings already are valid
fallbacks and remain unchanged. Explicit `sx` bindings are rewritten to their
Angular equivalent.

Interpolations use dedicated text-node instructions. They mutate Angular's
existing bound `Text` node instead of replacing `element.textContent`, so node
identity remains valid if Angular later checks the view.

## Zone contract

Zone usage is configuration-controlled, not inferred.

Zoneless Angular is the default path: `NgZone` is not resolved or called.

Pure compiled Streamix views do not resolve `ChangeDetectorRef`. The lifecycle
bridge opts into it only when the binding plan contains a hybrid
`angular-invalidate` slot whose expression remains Angular-owned.

A Zone.js-backed application opts into outside-zone scheduling with:

```ts
providers: [
  provideZoneChangeDetection(),
  provideSxZoneScheduling(),
]
```

`provideSxZoneScheduling()` installs the Streamix environment initializer that
resolves `NgZone` for a zone-backed application. No directive or compiled view
probes for `NgZone`. This avoids using `NgZone.isInAngularZone()` as a proxy for
application configuration and avoids treating global Zone.js presence as
evidence that the current Angular app is zone-backed.

## Static node paths

The compiler emits `Element.children` paths computed from the authored static
template. Whitespace text nodes do not affect indices and `ng-container` is
transparent.

Dynamic topology—structural directives, built-in control-flow blocks, or
content projection—is rejected by this static path and must be handled by the
compiled structural renderer.

## Builder-facing API

- `compileSxComponent()` — per-component transform payload;
- `transformAngularComponentTemplate()` — low-level template/fallback transform;
- `emitComponentModule()` — generated direct-binding module;
- `emitSourceReferenceInitializer()` — generated component reference registry;
- `installSxLifecycleIntoComponentSource()` — conservative class-source bridge;
- `createDependencySourcePathResolver()` — standalone source metadata adapter.
- `createScopeValuePathResolver()` — value-first Scope -> recursive `refs` mapping.
- `createReactiveSourcePathResolver()` — explicit value/source path mapping.

The source bridge is intentionally not a general TypeScript rewriter. A real
Angular CLI/Vite/esbuild adapter can replace only that discovery/insertion layer
while preserving the generated runtime contract above.
