# sx build integration

The build contract has five responsibilities:

```text
Angular component TypeScript
        ↓
TypeScript checker discovers DependencySource property paths
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
a Streamix source. A real builder supplies compile-time source metadata from its
component TypeScript checker through `isDependencySource(path)`.

Example authored template:

```html
<span>{{ count }}</span>
<button [disabled]="busy"></button>
```

When the checker proves `count` and `busy` are `DependencySource`s, the Angular
SSR/hydration fallback becomes:

```html
<span>{{ count.value }}</span>
<button [disabled]="busy.value"></button>
```

while the generated browser setup subscribes directly to `ctx.count` and
`ctx.busy`.

`compileSxComponent()` accepts either:

- `isDependencySource(path)` — preferred for a real TypeScript-aware builder;
- `dependencySourcePaths` — convenience metadata when the adapter already has
  the exact source-path set.

Ordinary Angular values are not rewritten.

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
- `createDependencySourcePathResolver()` — convenience source metadata adapter.

The source bridge is intentionally not a general TypeScript rewriter. A real
Angular CLI/Vite/esbuild adapter can replace only that discovery/insertion layer
while preserving the generated runtime contract above.
