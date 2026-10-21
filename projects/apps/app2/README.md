# App 2 — Atoms & Scopes Wizard

A compact Streamix + Angular compiler demo. Standard Angular template syntax is
compiled to direct DOM updates driven by the flat `model` scope: two-way
inputs, the select, conditional panels, and scope-derived display values all
update without change detection.

```bash
ng serve app2
```

The template stays on standard Angular syntax while the compiler subscribes to
the value-first `model` scope:

```html
<input [(value)]="model.name" placeholder="Enter codename" />

<label class="toggle">
  <input type="checkbox" [(checked)]="model.notifications" />
</label>

<select [(value)]="model.country">
  @for (c of model.countries; track c) {
    <option [value]="c">{{ c }}</option>
  }
</select>

@if (model.activeTab === 'tree') { ... } @else { ... }
```

```ts
readonly model = scope<AppModel>({
  step: 0,
  name: '',
  completeness: self => { /* derived from the filled fields */ },
  stageTransform: self => `translateX(calc(-${self.step} * 100% / 3))`,
});
```

The compiled pieces: two-way bindings that write back through
`model.set('name', …)`, a keyed `@for` rendering the async-loaded zone list,
`@if`/`@else` panels for the sidebar tabs and the final wizard step, and
derived members (`completeness`, `stageTransform`, `snapshotText`) that
recompute as the fields change.

Scope members are plain value-first reads in templates (`model.count`). The
atom behind one is available through the scope's public accessor —
`model.get('count')` — and `model.set('count', value)` writes through it.
