# Getting started with Streamix and Angular

Streamix compiles supported Angular template bindings into direct DOM updates
backed by Streamix subscriptions. Angular still owns components, dependency
injection, and ordinary Angular template features.

## 1. Configure the builder

The builder creates a virtual compiled source tree and delegates to your normal
Angular target. Authored files are never modified.

```json
{
  "build": {
    "builder": "@epikodelabs/streamix/angular/builder:application",
    "options": {
      "delegateTarget": "your-app:application",
      "sourceRoot": "projects/your-app/src"
    }
  }
}
```

It compiles static inline templates and literal `templateUrl` files. Without
the builder, Streamix code works normally but templates are not adopted.

## 2. Create an atom

Declare an atom as a normal component field. Supported template bindings read
its current value; class code still sees the source object.

```ts
import { Component } from '@angular/core';
import { atom } from '@epikodelabs/streamix';

@Component({
  standalone: true,
  template: `<p>{{ status }}</p><button (click)="save()">Save</button>`,
})
export class SaveButtonComponent {
  readonly status = atom('Draft');

  save(): void {
    this.status.set('Saved');
  }
}
```

Do not assign to `status` in a template: that replaces the atom field. Update
an atom in a component method with `set()` or `next()`.

## 3. Group fields with a scope

Use a scope for related writable fields. Template reads see field values and
supported assignments become Streamix writes.

```ts
readonly profile = scope({ name: 'Ada', subscribed: true });
```

```html
<input [(value)]="profile.name">
<button (click)="profile.subscribed = !profile.subscribed">
  Toggle subscription
</button>
```

Keep reactive sources as ordinary component fields. The compiler cannot safely
observe replacement through accessor-backed fields.

## 4. Use reactive template bindings

The compiler adopts interpolation; safe native property, attribute, class, and
style bindings; supported DOM events and two-way bindings; and compiler-owned
`@if` and keyed `@for` blocks.

```html
@for (row of model.items; track row.id) {
  <li [title]="row.name + model.suffix"
      [class.active]="row.enabled && model.active">
    {{ row.price * model.rate }}
  </li>
}
```

Every compiler-proven source is subscribed by a per-view binding table. It
writes the initial value, coalesces later emissions into frames, and removes
all listeners when Angular destroys the view. Replacing a source field tears
down old bindings before installing new ones.

## Know the boundaries

Streamix adopts static template topology. Keep a reactive binding before a
non-reactive Angular structural region, move it into a compiler-owned Streamix
block, or leave that region Angular-owned.

Untracked component fields, arbitrary calls, ambiguous assignments, pipes,
URL/HTML/resource sinks, projection, and other dynamic regions are explicit
boundaries. The compiler rejects reactive reads it cannot own instead of
rendering stale values. Loop locals must be declared; a misspelling fails
compilation rather than producing `undefined`.

Do not add a manual subscription just to keep a compiled binding alive. The
binding table owns subscriptions. Timers, services, projected content, and
rejected regions remain application-owned and use normal Streamix APIs.

## SSR and editor support

Lowered Streamix `@if` and `@for` blocks render hydration markers on the server
and populate after browser hydration. Keep SEO-critical first-paint content in
ordinary Angular-rendered regions.

Install `@angular/language-service` and configure the Streamix editor plugin:

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "@epikodelabs/streamix/angular/editor/tsserver" }
    ]
  }
}
```

Restart the TypeScript server after changing plugin settings. The editor helps
with inline atom reads; the build compiler remains authoritative for template
ownership and write safety.
