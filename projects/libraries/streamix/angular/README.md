# Angular Adoption Layer

`@epikodelabs/streamix/angular` — runtime · `/angular/compiler` — template compiler · `/angular/builder` — Architect builder.

Streamix state is first-class in Angular templates. The compiler reads a
component's `scope(...)` fields and standalone atoms from its TypeScript
program, lowers the template positions it can prove, and lets the compiled
bindings write the DOM directly. **No Angular signals, no
`ChangeDetectorRef`, no zone coupling in the update path** — and anything it
cannot prove fails the build instead of rendering once and going stale.

---

## What it covers

| Concept | You write | What the layer does |
|---|---|---|
| Text interpolation | `{{ model.count }}` | direct text binding on Angular's own `Text` node |
| Reactive expressions | `{{ count * 2 }}`, `{{ a + b }}` | multi-source binding, evaluated once per frame |
| Property binding | `[disabled]="model.busy"` | DOM property write (safe-property allow-list) |
| Expression binding | `[class.active]="count > 3"` | compiled expression over several atoms |
| Attribute binding | `[attr.aria-label]="model.label"` | `setAttribute` for `aria-*`, `data-*`, `role`, `title`, `tabindex` |
| Class binding | `[class.active]="model.active"` | `classList.toggle` |
| Style binding | `[style.opacity]="model.opacity"` | `style.setProperty` for the safe style list |
| Two-way binding | `[(value)]="model.name"` | property binding + listener writing back through the atom |
| Events | `(click)="add($event)"` | `addEventListener`, Angular's binding removed |
| Event modifiers | `(click.stop.prevent)`, `(keyup.enter)` | guards in the generated listener |
| Conditions | `@if` / `@else if` / `@else` | compiled conditional block, direct DOM |
| Loops | `@for (row of model.rows; track row.id)` | keyed block: reuse, move, remove |
| Empty loops | `@empty { … }` | empty-state factory |
| Loop context | `$index` `$count` `$first` `$last` `$even` `$odd` | per-item context object |
| Switch | `@switch` / `@case` / `@default` | conditional block with identity matching |
| Nesting | `@for { @if { … } }` | nested blocks with their own factories and teardown |
| Template locals | `@let total = row.price * 2;` | inlined into the expressions that read it |
| Classic directives | `*ngIf`, `*ngFor` (single variable) | lowered like their block equivalents |
| Scopes | `model.count` in a template | resolved to `model.get('count')`, subscribed |
| Standalone atoms | `count` as a component field | resolved to the atom itself, subscribed |
| SSR | — | markers kept empty, Angular renders the fallbacks, no listeners |
| Hydration | — | Angular reuses the server nodes, the compiled view then takes over |
| Teardown | — | `DestroyRef` releases every subscription, listener, and block |
| Rebinding | `this.count = anotherAtom` | `__sxRefs` bridge rebuilds the setup synchronously |
| Zone apps | `provideSxZoneScheduling()` | renderer frames run outside `NgZone`; a missing provider warns once |
| Build | `angular.json` builder target | components compiled into a virtual tree at build time |

---

## What stays Angular-owned

The layer is deliberately conservative. These positions keep Angular's own
semantics, and a **reactive read in one of them is a build error**:

- component, directive, and pipe inputs — `<app-item [item]="model.item" />`,
  `{{ model.label | uppercase }}`;
- URL / resource / HTML sinks — `[href]`, `[src]`, `[innerHTML]`, `[srcdoc]`,
  `[attr.href]`, URL-bearing styles — so Angular's sanitizer keeps running;
- attribute interpolation — `title="{{ model.title }}"`;
- `[class]` and `[style]` object maps, and unit-qualified styles
  (`[style.width.px]`);
- `@defer`, `ng-template` regions, and root-level `@let`;
- `@case` values that are not literals — the compiled switch compares by
  identity, so cases must be strings, numbers, booleans, or `null`;
- animations, `window:`/`document:` listeners, unknown event names, and
  handlers that are not method calls;
- `*ngFor` with extra variables (`let i = index`).

The explicit `.value` form is the one deliberate escape hatch:
`[href]="url.value"` stays Angular-owned and is rendered by Angular, so the
sanitizer sees it.

---

## Source-transparent templates

Ordinary Angular syntax; the resolver is compile-time metadata from the
component's TypeScript program. The runtime never duck-types objects.

```html
<span>{{ count }}</span>
<button [disabled]="busy" [class.active]="active" [style.opacity]="opacity">
  Save
</button>
```

An expression whose reads are *all* reactive sources compiles:

```html
{{ count * 2 }}
@if (model.count > 3 && model.ready) { … }
@for (row of model.items.concat(model.extras); track row.id) { … }
```

An expression that mixes a reactive read with plain component state is a build
error naming the read:

```html
{{ count * multiplier }}   <!-- count is an atom, multiplier is plain state -->
```

Make every read reactive, or compute the value into a plain field and bind that.

### Scope values

Scopes stay value-first in component code; the atom behind a member comes from
the scope's accessor:

```ts
model.count            // number (value)
model.get('count')     // Atom<number>
model.set('count', 2)  // write through the atom
```

```html
<span>{{ model.count }}</span>
@if (model.count > 3) { … }
<input [(value)]="model.name">
@for (row of model.rows; track row.id) { … }
```

Plain members, derived members, and flow-backed members all read the same way.
Only *writable* members are accepted in `[(…)]`. A scope keeps its own atoms
awake, so a flow-backed member is already producing when the template renders it.

### Scoped atoms natively — via the builder

Nothing about a scope is special-cased in the template; the support comes from
the build. Point `angular.json` at the Streamix builder:

```json
{
  "build": {
    "builder": "@epikodelabs/streamix/angular/builder:application",
    "options": {
      "delegateTarget": "app6:application",
      "sourceRoot": "projects/apps/app6/src"
    }
  }
}
```

The builder then:

- compiles every component under `sourceRoot` that uses an inline template;
- reads each `scope({...})` field and its members from the component's
  TypeScript program, mapping `model.count` to `model.get('count')` and
  two-way writes to `model.set('count', …)`;
- discovers standalone atom fields the same way, and only accepts writable
  paths (`value` plus `set`/`next`) for two-way bindings;
- writes the transformed components into `.angular/streamix/<app>/src/…` and
  hands the build to `delegateTarget`.

### Native binding allow-lists

| Kind | Accepted |
|---|---|
| property | `alt` `checked` `className` `cols` `colSpan` `contentEditable` `disabled` `draggable` `height` `hidden` `htmlFor` `id` `max` `min` `multiple` `name` `open` `placeholder` `readOnly` `required` `rows` `rowSpan` `selected` `spellcheck` `step` `tabIndex` `textContent` `title` `type` `value` `width` |
| attribute | `aria-*`, `data-*`, `role`, `title`, `tabindex` |
| style | `display` `height` `opacity` `transform` `visibility` `width` |

### Events

Around forty-five native events (`click`, `input`, `change`, `submit`,
`keydown`/`keyup`, `focus`/`blur`, pointer, mouse, wheel, scroll, drag, touch,
`animationend`, `transitionend`, `load`, `error`) with these modifiers:

- `.stop`, `.prevent`, `.self`, `.once`, `.capture`;
- key filters — `.enter`, `.escape`, `.space`, `.tab`, `.backspace`,
  `.delete`, `.arrowup`, `.arrowdown`, `.arrowleft`, `.arrowright`, `.home`,
  `.end`, `.pageup`, `.pagedown`, `.alt`, `.shift`, `.control`, `.meta`.

Installing a listener removes Angular's binding in the same edit, so one click
runs one handler — including inside a compiled body, where the handler may read
the loop context:

```html
@for (row of model.rows; track row.id) {
  <button (click)="select(row.id)">{{ row.label }}</button>
}
```

### Two-way bindings

Writable atoms on native elements:

```html
<input [(value)]="model.name">
<input [(checked)]="model.notifications">
```

The property binding owns the read direction; the listener stores the DOM value
back through the atom (`scope.set` for Scope members). Only `value`, `checked`,
`selectedIndex`, and `valueAsNumber` are writable this way. A two-way binding
over plain Angular state is left untouched.

---

## SSR and hydration

Source-transparent syntax is rewritten only in the Angular fallback template:

```html
[disabled]="busy"          →  [disabled]="busy.value"
{{ count * 2 }}            →  {{ count.value * 2 }}
```

Server rendering keeps lowered block markers **empty** and renders everything
else through its Angular fallback; injecting block content into a marker the
client's template declares empty would make hydration mismatch and re-render
the subtree. The compiled view fills the marker right after mounting —
`afterNextRender()` on the client, the generated `ngAfterViewInit()` under
server rendering. Event listeners are never attached on the server.

For DOM reuse to engage on the client, the server half must register server
rendering — that is what serializes the `ng-state` script:

```ts
bootstrapApplication(AppComponent, {
  providers: [provideClientHydration(), provideServerRendering()],
});
```

## Sanitization boundary

The compiler never takes ownership of a binding whose value passes through
Angular security sanitization (`[href]`, `[src]`, `[innerHTML]`, `[srcdoc]`,
`[attr.href]`, URL-bearing styles). A reactive read there is a build error; the
explicit `.value` form stays Angular-owned so the sanitizer runs on every value.
The style writer refuses URL-bearing CSS properties at runtime as well.

## Zones

Direct bindings do not depend on `ChangeDetectionStrategy.OnPush`, and zoneless
applications need no integration at all. For Zone.js-backed applications:

```ts
bootstrapApplication(AppComponent, {
  providers: [provideZoneChangeDetection(), provideSxZoneScheduling()],
});
```

`provideSxZoneScheduling()` resolves `NgZone` once, in an environment
initializer, and schedules renderer frames outside it. Streamix never probes for
`NgZone`; if a global `Zone` exists and the provider was never installed, the
renderer warns once that every update is dragging a change-detection pass along.

## Compiled block semantics

- initial rendering is synchronous;
- emissions are frame-coalesced and the latest value wins;
- an expression over several sources evaluates at most once per frame;
- keyed views are reused and moved rather than recreated;
- duplicate keys are rejected before any DOM mutation;
- nested blocks re-evaluate when the loop item that owns them changes;
- teardown releases every subscription and removes every listener.

## Diagnostics

Two failures carry the fix in the message:

```text
Streamix cannot bind "model.item" here: Angular evaluates this template position
itself, so the compiled view could render it once and never update it. <reason>
Make every read reactive — bind an atom or a scope member — or read the value into
a plain component field and bind that instead.
```

The optional reason names the specific obstacle ("This expression mixes reactive
reads with component state…", "Attribute interpolation is evaluated by
Angular…", or the two-way rule). A compiled binding whose element indices would
shift — a structural directive or projected content appearing before it — is
rejected the same way instead of being addressed by a drifting path. The legacy
`*sx` microsyntax is a compile error pointing at `@if`/`@for`.

## Compiler/runtime model

Compiler output uses a preallocated binding table — one per component, one
shared scheduler registration:

```text
slot 0 -> text node       -> count
slot 1 -> property        -> busy
slot 2 -> class           -> active
slot 3 -> text expression -> [count, price]
slot 4 -> listener        -> click
```

Fields that hold reactive identities are registered in a `__sxRefs` bridge;
replacing one (`this.count = anotherAtom`) tears the setup down and rebuilds it
synchronously against the new source — no signal, no `ChangeDetectorRef`, no
change-detection pass.

Generated setup addresses the DOM through static `Element.children` paths. The
runtime instructions it uses are exported for hand-written setups:
`createBindingTable`, `ɵsxText`, `ɵsxTextNode`, `ɵsxTextExpression`,
`ɵsxTextExpressionNode`, `ɵsxProperty`, `ɵsxAttribute`, `ɵsxClass`, `ɵsxStyle`
(plus the `…Expression` and `…Map` variants), `ɵsxListener`,
`ɵcreateSxConditionalBlock`, `ɵcreateSxKeyedBlock`, `ɵcreateSxCompiledBlock`,
`ɵsxBlockAnchor`, `ɵsxReadLocal`, `ɵsxString`, `ɵsxRestoreBlockMarker`.

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
requires `typescript` (an optional peer) and is meant for virtual build output,
never for authored sources.

The builder ships as a secondary entry point of the package, compiled into
`dist/streamix/fesm2022` alongside the runtime and compiler, so an application
references `@epikodelabs/streamix/angular/builder:application` directly. Its
generator lives in `angular/builder/src/generate-project.ts`; wiring details
(option forwarding, the dev-server delegation chain, the rebuild hook) are in
the [builder README](./builder/README.md).

## Testing

```bash
npm test            # browser suite (testify, headless Chrome)
npm run test:node   # server-rendering suite (renderApplication in Node)
```

The SSR suite renders a fixture through `renderApplication` and asserts the
server contract; a browser spec boots the client over the committed server
document and asserts both halves — Angular reuses the server's nodes, and the
compiled view takes the markers over. The server HTML is a committed fixture;
regenerate it with `STREAMIX_UPDATE_FIXTURES=1 npm run test:node`.

## Benchmarks

The `benchmarks/` directory contains a real-browser runner covering raw DOM,
compiled scalar text, coalesced writes, and keyed reorders:

```bash
npm run bench:angular
```

Vite serves the directory and prints a URL; open it to run the benchmarks.
Results print as a table and as JSON. The runner is claim-free; comparisons
should use the same browser, production build, workload, and warmup counts.
