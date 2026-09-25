# @epikodelabs/streamix/angular

Direct reactive Angular bindings for Streamix.

```html
<span [sx.text]="count"></span>

<input [sx.value]="name">

<button
  [sx.disabled]="disabled"
  [sx.attr.aria-label]="label"
  [sx.class.active]="active"
  [sx.style.opacity]="opacity">
  Save
</button>
```

The `sx` binding namespace mirrors normal DOM concepts:

```text
[sx.text]             -> textContent
[sx.<property>]       -> DOM property
[sx.attr.<name>]      -> attribute
[sx.class.<name>]     -> class toggle
[sx.style.<property>] -> inline style
```

After setup, direct bindings do not mark or check Angular views.

```text
Streamix source emits
  -> latest value stored
  -> integer binding id marked dirty
  -> one shared animation-frame flush
  -> direct DOM write
```

Initial rendering is synchronous. Repeated emissions before a frame are
coalesced and the latest value wins.

## Structural rendering

`*sx` is the Angular structural `TemplateRef` bridge:

```html
<div *sx="user as user">
  {{ user.name }}
</div>
```

It is frame-coalesced and collection views are keyed/reused, but arbitrary
template bodies still render through Angular. The compiler renderer is the path
for lowering supported structural templates to direct DOM instructions.

## Runtime vs compiler

The directive runtime currently exposes a small set of common dotted bindings.
The compiler contract is intentionally broader: arbitrary `sx` property,
attribute, class, and style names can be lowered directly to the corresponding
low-level binding primitive without adding one Angular directive input per
name.

## Compiler binding tables

The compiled path removes Angular directive lifecycle work from hot bindings.

A template such as:

```html
<span [sx.text]="count"></span>

<button
  [sx.disabled]="disabled"
  [sx.class.active]="active">
  Save
</button>
```

is represented by a fixed binding plan:

```text
slot 0 -> text      -> count
slot 1 -> property  -> disabled
slot 2 -> class     -> active
```

and generated setup code is equivalent to:

```ts
const table = createBindingTable(3);

ɵsxText(table, 0, text0, ctx.count);
ɵsxProperty(table, 1, button0, 'disabled', ctx.disabled);
ɵsxClass(table, 2, button0, 'active', ctx.active);
```

One compiled view has one preallocated table and one scheduler registration,
regardless of the number of bindings in that table. Source emissions only mark
integer slots dirty; the frame flush visits those slots directly.

`@epikodelabs/streamix/angular/compiler` currently exposes the compiler-neutral
binding plan and deterministic emitter. It is intentionally separate from the
runtime. Wiring this plan to Angular's template parsing/transform pipeline is
the next compiler-integration step.

## Angular template parsing

The compiler entry point now parses real Angular templates through
`@angular/compiler` and extracts the public `sx` namespace into a stable binding
plan.

For:

```html
<span [sx.text]="count"></span>

<button
  [sx.disabled]="disabled"
  [sx.attr.aria-label]="label"
  [sx.class.active]="active">
  Save
</button>
```

the compiler produces:

```text
node0 / slot 0 -> text(count)
node1 / slot 1 -> property(disabled)
node1 / slot 2 -> attribute(aria-label)
node1 / slot 3 -> class(active)
```

The parser reads the exact source span for the public binding name so Angular's
normalization of property/attribute bindings does not erase the `sx` namespace.

This stage intentionally stops before modifying Angular-generated Ivy code.
The next integration layer can consume the plan during the application build
and inject the binding-table setup without making the runtime depend on private
Ivy instructions.

## Build transform

`@epikodelabs/streamix/angular/compiler` now exposes:

```ts
transformAngularComponentTemplate(template)
```

It removes `sx` bindings from Angular's normal binding system, emits stable
`data-sx` node markers, and generates the direct binding-table setup function.

This gives the build integration a concrete boundary without depending on
private Ivy instructions. The marker lookup is transitional: the final
performance path should replace it with direct generated node references.

## Compiled-view lifecycle

Generated component code now has a public-Angular lifecycle bridge:

```ts
private readonly ɵsx = ɵinstallSxCompiledView(
  this,
  ɵsetupSxBindings,
);
```

`ɵinstallSxCompiledView` waits until the component DOM exists with
`afterNextRender()`, installs the generated binding table once, and destroys it
through `DestroyRef`.

The compiler's `compileSxComponent()` returns the transformed template,
generated `*.sx.ts` setup module, lifecycle initializer, and binding count. This
is the deterministic core a builder adapter can consume without private Ivy
APIs.

## Direct node acquisition

The compiled static-template path no longer emits `data-sx` markers and no
longer calls `querySelector()` during component setup.

The Angular template parser computes element-only paths at build time, so:

```html
<section>
  <span [sx.text]="count"></span>
</section>
```

can generate:

```ts
const node0 = host.children[0] as Element;
const node1 = host.children[0].children[0] as Element;

ɵsxText(table, 0, node1, ctx.count);
```

The path uses `Element.children`, so whitespace/text nodes do not affect the
indices. `ng-container` is treated as transparent — its children join the
parent's element sequence. Any dynamic topology in the same template —
structural directives such as `*ngIf` (even as siblings without `sx` bindings),
built-in control-flow blocks, or content projection — is deliberately rejected
by this static compiler path; those need the upcoming compiled structural
renderer rather than an unstable DOM path.

## Compiled structural blocks

The compiler path now has direct structural runtimes for `sx`.

```html
<div *sx="user as user">
  {{ user }}
</div>
```

lowers toward a direct `SxValueBlock`, while:

```html
<li *sx="let hero of heroes; trackBy: trackHero">
  {{ hero }}
</li>
```

lowers toward a keyed `SxKeyedBlock`.

Structural records are DOM ranges anchored by comment nodes. Keyed collection
updates reuse and move those ranges directly. No Angular embedded view or
Angular change-detection pass is required for the compiled structural runtime.

The initial structural factory uses a small static HTML block factory. This is
a transition step only; the next compiler pass should emit block DOM creation
and nested binding tables directly.

## Direct structural DOM compilation

The transitional structural HTML factory is no longer part of generated code.

A block such as:

```html
<li *sx="let hero of heroes; trackBy: trackHero">
  Hello {{ hero.name }}
</li>
```

now lowers toward direct DOM instructions:

```ts
const el0 = document.createElement('li');
const text1 = document.createTextNode('');
el0.appendChild(text1);

return ɵcreateSxCompiledBlock(
  el0,
  el0,
  context => {
    text1.data =
      'Hello ' +
      ɵsxString(ɵsxReadLocal(context, 'hero.name'));
  },
  { hero, index },
);
```

There is no `innerHTML`, runtime template parsing, Angular embedded view, or
Angular change-detection pass in this structural creation/update path.

The first direct block compiler intentionally supports a narrow subset:
static elements/attributes/text and simple local/property interpolations.
Unsupported Angular bindings inside a structural block fail at build time.
They can be added deliberately rather than falling back to a slower hidden
runtime.

## Hardening and benchmarks

The renderer foundation now has correctness tests for:

- latest-value-wins coalescing;
- stale emissions after source rebind;
- keyed DOM identity across reorder;
- duplicate key diagnostics;
- exactly-once destruction of removed keyed records;
- binding-table cleanup after destroy;
- strict structural compiler diagnostics.

The benchmark harness contains raw-DOM, compiled scalar, coalesced-write, and
keyed-reorder workloads. It intentionally publishes no performance claims.
Million.js and Angular comparisons plug into the same `ExternalRendererAdapter`
contract so equivalent production workloads can be measured before any claim
is made.
