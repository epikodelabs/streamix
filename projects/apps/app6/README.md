# App 6 — Rainbow Clicker

A compact Streamix + Angular demo that exercises both Angular directives:

- `SxBindingsDirective` updates existing DOM text, properties, attributes,
  class maps, individual classes, style maps, and individual styles directly.
- `SxDirective` owns structural DOM and creates the celebration badge once the
  rainbow is unlocked.

Streamix DOM streams drive the canvas rainbow animation and viewport resizing.
After the tenth click, seven canvas arcs grow into a full rainbow and the
structural celebration badge appears. The page keeps its natural composition
and scales as one unit only when needed to remain fully visible without scroll.

```bash
ng serve app6
```

The demo intentionally exercises both dynamic maps and dotted bindings:

```html
<main [sx.style]="pageStyles">...</main>

<section
  class="number-box"
  [sx.class]="numberClasses"
  [sx.style.transform]="numberTransform">
  ...
</section>
```

```ts
readonly pageStyles = derived($ => ({
  transform: `scale(${$(this.pageScale)})`,
  transformOrigin: 'center center',
}));

readonly numberClasses = derived($ => ({
  active: $(this.isPartyTime),
  unlocked: $(this.count) >= 10,
}));
```

`[sx.class]` and `[sx.style]` diff their own keys and preserve unrelated static
classes/styles. Common cases still use explicit bindings such as
`[sx.disabled]`, `[sx.attr.aria-label]`, `[sx.class.active]`,
`[sx.style.transform]`, and `[sx.style.opacity]`.
