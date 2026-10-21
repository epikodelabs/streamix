# App 6 — Rainbow Clicker

A compact Streamix + React compiler demo. Direct JSX reads of the `model`
scope are compiled to concurrent-safe subscriptions: text bindings, the
two-way input, and conditional content all update without manual React state.

Streamix DOM streams drive the canvas rainbow animation and viewport resizing.
After the fifth click, seven canvas arcs grow into a full rainbow and the
compiled badge appears. The page keeps its natural composition and scales as
one unit only when needed to remain fully visible without scroll.
The scale binding is applied to the main page and recomputed when its content,
viewport, or inspector size changes. An expanded inspector leaves the complete
page visible above it. Demo button styles stay within `#app` so they cannot
affect inspector controls.

```bash
ng serve app6
```

The page reads the value-first `model` scope directly in TSX:

```tsx
<main style={{ transform: model.pageTransform }}>
  <section className={model.isPartyTime ? "number-box active" : "number-box"}>...</section>

  <label>
    Name
    <input value={model.name} onChange={event => model.name = event.target.value}>
  </label>
  <p className="greeting">{model.greeting}</p>

  {model.count > 0 && model.count % 5 !== 0 ? (
    <p className="hint">{5 - model.count % 5} more to unlock the rainbow</p>
  ) : null}

  <ul>
    {model.milestones.map(milestone => (
      <li key={milestone.id}>
        {milestone.done ? <s>{milestone.label}</s> : <span>{milestone.label}</span>}
      </li>
    ))}
  </ul>
</main>
```

```ts
const model = scope({ count: 0, /* derived values */ });
```

The compiled pieces, in order of appearance: a style and class binding that
read scope members, a two-way input that writes the value back through
`model.set('name', …)`, a compound condition over `model.count`, and a keyed
list over a derived scope member whose rows contain a per-row conditional.

Scope members are plain value-first reads in JSX (`model.count`). The atom
behind one is available through the scope's public accessor —
`model.get('count')` — and `model.set('count', value)` writes through it.
