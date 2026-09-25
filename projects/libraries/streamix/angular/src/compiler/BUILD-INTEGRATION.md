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
ɵinstallSxCompiledView(this, ɵsetupSxBindings)
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

A Zone.js-backed application opts into outside-zone scheduling with:

```ts
providers: [
  provideZoneChangeDetection(),
  provideSxZoneScheduling(),
]
```

`provideSxZoneScheduling()` is the Streamix-side configuration marker. This
avoids using `NgZone.isInAngularZone()` as a proxy for application
configuration and avoids treating global Zone.js presence as evidence that the
current Angular app is zone-backed.

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
- `installSxLifecycleIntoComponentSource()` — conservative class-source bridge;
- `createDependencySourcePathResolver()` — standalone source metadata adapter.
- `createScopeValuePathResolver()` — value-first Scope -> recursive `refs` mapping.
- `createReactiveSourcePathResolver()` — explicit value/source path mapping.

The source bridge is intentionally not a general TypeScript rewriter. A real
Angular CLI/Vite/esbuild adapter can replace only that discovery/insertion layer
while preserving the generated runtime contract above.
