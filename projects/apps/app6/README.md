# App 6 — Rainbow Clicker

A compact Streamix + Angular compiler demo. Standard Angular bindings are
lowered to direct Streamix subscriptions, while `SxDirective` owns the
structural celebration badge once the rainbow is unlocked.

Streamix DOM streams drive the canvas rainbow animation and viewport resizing.
After the tenth click, seven canvas arcs grow into a full rainbow and the
structural celebration badge appears. The page keeps its natural composition
and scales as one unit only when needed to remain fully visible without scroll.

```bash
ng serve app6
```

The template stays on standard Angular syntax while the compiler subscribes to
the value-first `model` scope:

```html
<main [style.transform]="model.pageTransform">...</main>
<section [class.active]="model.isPartyTime">...</section>
```

```ts
readonly model = scope({ count: 0, /* derived values */ });
```

The generated virtual component resolves `model.count` through
`model.refs.count` without exposing refs in authored templates.
