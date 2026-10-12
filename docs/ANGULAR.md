# Getting started with Streamix and Angular

Streamix compiles supported Angular template bindings into direct DOM updates
backed by Streamix subscriptions. Angular still owns components, dependency
injection, and ordinary Angular template features.

## 1. Install

Install Streamix beside the Angular packages your application already uses:

```sh
npm install @epikodelabs/streamix @angular/core @angular/common
npm install -D typescript @angular/cli @angular/language-service
```

Streamix requires Angular 20 or newer and TypeScript 5.5 or newer. The
compiled-template runtime, the builder, and the editor plugin ship in the same
package; there is nothing else to install.

## 2. Configure the builder

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

### Zone.js applications

If the application uses Zone.js, add the Streamix scheduler provider once so
compiled bindings update frames outside Angular's zone:

```ts
import { provideSxZoneScheduling } from '@epikodelabs/streamix/angular';

export const appConfig = {
  providers: [provideSxZoneScheduling()],
};
```

Zoneless applications need no provider. A Zone.js application that skips this
provider still works; the scheduler warns once at startup so the setting is
never missed silently.

## 3. Create an atom

Declare an atom as a normal component field. Supported template bindings read
its current value; class code still sees the source object.

```ts
import { Component } from '@angular/core';
import { atom, derived, scope } from '@epikodelabs/streamix';

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

Derived values remain ordinary Streamix sources in class code and are read as
values in an adopted template:

```ts
readonly quantity = atom(2);
readonly price = atom(8);
readonly total = derived($ => $(this.quantity) * $(this.price));
```

```html
<output>{{ total }}</output>
```

Do not assign to `status` in a template: that replaces the atom field. Update
an atom in a component method with `set()` or `next()`.

```html
<!-- Wrong: replaces the atom rather than writing its value. -->
<button (click)="status = 'Saved'">Save</button>

<!-- Correct: call the component method that writes the atom. -->
<button (click)="save()">Save</button>
```

## 4. Group fields with a scope

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

## 5. Use reactive template bindings

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

### What is generated

The compiler preserves the component field and emits a per-view binding table.
Conceptually, an interpolation becomes a source subscription plus a DOM writer:

```ts
// Authored component field
readonly status = atom('Draft');

// Conceptual generated setup
table.bind(0, ctx.status, value => text.data = String(value));
```

The setup is compiler output, not an API to hand-author. Angular's `DestroyRef`
destroys it with the component; source replacement triggers a clean rebind.

## Know the boundaries

Streamix adopts static template topology. Keep a reactive binding before a
non-reactive Angular structural region, move it into a compiler-owned Streamix
block, or leave that region Angular-owned.

Untracked component fields, arbitrary calls, ambiguous assignments, pipes,
URL/HTML/resource sinks, projection, and other dynamic regions are explicit
boundaries. The compiler rejects reactive reads it cannot own instead of
rendering stale values. Loop locals must be declared; a misspelling fails
compilation rather than producing `undefined`.

```html
<!-- Wrong: typo is not a declared @for local. The build fails. -->
@for (row of model.items; track row.id) { {{ typo.name }} }

<!-- Correct: row is the declared local. -->
@for (row of model.items; track row.id) { {{ row.name }} }
```

Do not add a manual subscription just to keep a compiled binding alive. The
binding table owns subscriptions. Timers, services, projected content, and
rejected regions remain application-owned and use normal Streamix APIs.

### Supported and explicit cases

| Use case | Use |
| --- | --- |
| Interpolation or safe native binding | Atom or scope field in the template |
| Writable template field | Scope-field assignment or supported two-way binding |
| Bare atom update | Component method calling `set()` / `next()` |
| Keyed reactive list | Compiler-owned `@for` with declared locals |
| Pipe, URL/HTML sink, projection, or untracked field | Angular-owned or explicit application code |
| Service callback or timer | Normal Streamix API from TypeScript |

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

### Troubleshooting

- A template is not adopted: confirm the Streamix builder is the active target
  and the template is inline or a literal `templateUrl` under `sourceRoot`.
- A binding is rejected: move it into a supported static region, remove the
  pipe/call/unsafe sink, or keep that region Angular-owned.
- A list expression fails: declare and use the actual `@for` local name; do
  not rely on an undeclared identifier becoming `undefined`.
- The editor accepts something the build rejects: restart TypeScript if needed,
  but treat the build compiler as authoritative for ownership and write safety.

## DevTools

`StreamixDevtools` is an opt-in panel showing subscriptions, writes, and
cleanup from the compiled binding table — the same shared trace the React and
Vue panels render:

```ts
import { Component } from '@angular/core';
import { StreamixDevtools } from '@epikodelabs/streamix/angular';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [StreamixDevtools],
  template: `
    <streamix-devtools></streamix-devtools>
    <!-- rest of the application -->
  `,
})
export class AppShellComponent {}
```

The panel renders outside Angular change detection — it builds its own DOM and
updates on store notifications — and renders nothing in production builds
(`import.meta.env.DEV`) or on the server.

## Where to go from here

[Atoms and Scopes](./ATOMS.md) covers the core model these templates consume:
derived values, flows, transactions, operators, and the full scope API.
