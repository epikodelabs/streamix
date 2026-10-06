# App 6 — Rainbow Clicker

A compact Streamix + Angular compiler demo. Standard Angular template syntax
is compiled to direct DOM updates driven by the `model` scope: plain bindings
and the control flow blocks both update without change detection.

Streamix DOM streams drive the canvas rainbow animation and viewport resizing.
After the tenth click, seven canvas arcs grow into a full rainbow and the
compiled `@if` badge appears. The page keeps its natural composition and
scales as one unit only when needed to remain fully visible without scroll.

```bash
ng serve app6
```

The template stays on standard Angular syntax while the compiler subscribes to
the value-first `model` scope:

```html
<main [style.transform]="model.pageTransform">...</main>
<section [class.active]="model.isPartyTime">...</section>

<label>
  Name
  <input [(value)]="model.name">
</label>
<p class="greeting">{{ model.greeting }}</p>

@if (model.count > 0 && model.count % 5 !== 0) {
  <p class="hint">{{ 5 - model.count % 5 }} more to unlock the rainbow</p>
}

<ul>
  @for (milestone of model.milestones; track milestone.id) {
    <li>
      @if (milestone.done) { <s>{{ milestone.label }}</s> }
      @else { <span>{{ milestone.label }}</span> }
    </li>
  }
</ul>
```

```ts
readonly model = scope({ count: 0, /* derived values */ });
```

The compiled pieces, in order of appearance: a property and class binding that
read scope members, a two-way binding that writes the input value back through
`model.set('name', …)`, a compound `@if` expression over `model.count`, and a
keyed `@for` over a derived scope member whose rows contain a nested
`@if`/`@else` that re-evaluates per row.

Scope members are plain value-first reads in templates (`model.count`). The
atom behind one is available through the scope's public accessor —
`model.get('count')` — and `model.set('count', value)` writes through it.
