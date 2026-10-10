# Angular Adoption Layer

`@epikodelabs/streamix/angular` lets Angular components use Streamix state directly in their templates.

The idea is simple: write ordinary Angular templates, keep state in Streamix, and let the integration keep the view up to date.

```ts
model = scope({
  count: 0,
  busy: false,
  name: '',
  doubled: self => self.count * 2,
});
```

```html
<button (click)="model.count = model.count + 1">
  {{ model.count }} → {{ model.doubled }}
</button>

<input [(value)]="model.name">

<p [class.active]="model.count > 3">
  Hello, {{ model.name }}
</p>
```

You work with values in your component and template. Streamix handles the reactive connection behind the scenes.

## What feels natural

The Angular adoption layer supports the template patterns most applications use every day:

- text such as `{{ model.count }}`;
- simple expressions such as `{{ count * 2 }}`;
- native properties such as `[disabled]="model.busy"`;
- classes, styles, and safe attributes;
- events such as `(click)="save()"`;
- two-way input bindings such as `[(value)]="model.name"`;
- conditions with `@if`;
- lists with `@for`;
- nested conditions and lists.

You do not need a special template language or a manual subscription for each value. If Streamix can safely recognise the reactive state, it keeps that part of the template in sync.

## What your editor shows

Template type-checking runs against exactly what you wrote. Scope members are typed as ordinary values, so scope-based templates stay clean in the editor and in the build.

One case is expected, and worth recognising when you meet it: putting a **bare atom straight into an expression** — `{{ count * 2 }}`, `@if (count > 3)`, `@for (row of rows; …)` — compiles, but your editor will underline it. What you are holding there is the atom, not the number or the list, and the editor is right to say so. A lone `{{ count }}` is fine; interpolation accepts any type.

If you see those squiggles, there are three ways to clear them:

- keep the state in a scope and read it as `model.count` — the recommended shape anyway;
- or write the value explicitly — `count.value` — which the editor accepts;
- or wrap the atom read itself in Angular's `$any(...)` cast — `{{ $any(count) * 2 }}`, `@if ($any(count) > 3)`, `@for (row of $any(rows); …)`. The editor stops checking the cast, and the build sees through it and still compiles the expression reactively. Wrap the *read*, not the whole expression: `$any(count * 2)` only silences the outer operation, and the inner `count * 2` is still checked.

The editor also cannot see which scope members are writable, so it stays quiet on a two-way binding to a calculated member, such as `[(value)]="model.doubled"`. The build rejects that one, and the build's error is the authoritative one.

## Keep related state together

`scope(...)` is a useful home for the state that belongs to one feature.

```ts
user = scope({
  name: '',
  email: '',
  label: self => `${self.name} <${self.email}>`,
});
```

The scope can hold plain state, calculated values, asynchronous work, and cleanup under one owner. In templates, its members read like ordinary values:

```html
<span>{{ user.label }}</span>
<input [(value)]="user.name">
```

That means the template stays focused on what the UI should show, rather than on how reactivity is wired.

## Angular still owns the places where it should

Streamix is deliberately careful. Angular keeps control of component inputs, pipes, URLs, HTML, and other security-sensitive bindings. That keeps Angular’s normal safety checks in place.

If a template expression cannot be handled safely, the build explains why instead of silently rendering something that later stops updating. The usual fix is simple: keep the expression fully reactive, or calculate the value in the component first.

## Built for real application lifecycles

The integration cleans up its listeners and reactive work when an Angular component is destroyed. It also works with server rendering and hydration: Angular renders the initial page, then Streamix takes over the reactive parts in the browser.

For applications using Zone.js, Streamix can schedule its own view updates without turning every state change into unnecessary application-wide work.

## Getting started

To use Streamix-aware template features—direct atom reads, scope members, reactive expressions, compiled conditions, and compiled loops—change your project’s **build** target in `angular.json` to the Streamix builder.

The Streamix builder prepares supported components first, then delegates the rest of the application build to Angular. Your existing Angular build target remains the delegate target:

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

Without this builder, Streamix still works in Angular code, but templates do not receive the Streamix compiler support described above.

## Benchmarks

The renderer benchmarks run in a real browser. One command runs them headlessly and prints the results:

```bash
npm run bench:angular
```

To open the same suite as an interactive page instead:

```bash
npm run bench:angular:serve
```

Vite serves the page and prints a URL to open.

## The goal

Streamix for Angular is not a new component model. It is a way to use Streamix atoms, derived values, flows, and scopes in Angular without making template code feel like plumbing.

Write state as state. Write templates as templates. Let the integration connect them.
