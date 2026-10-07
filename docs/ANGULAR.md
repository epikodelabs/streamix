# 🚀 Streamix and the Angular Ecosystem

Streamix isn't a lightweight wrapper around Angular primitives. It brings its own **comprehensive** implementation of reactive state (atoms + derived), scoped lifecycles, and async resources.

This creates **intentional overlap** with parts of Angular. Instead of blending in seamlessly, Streamix serves as a capable alternative you can use *instead of* certain Angular tools when it fits better.

### ⚡ Short Verdict

Streamix works as a regular TypeScript library inside an Angular workspace — and
the subpackage ships a compiler plus an Architect builder that compile standard
Angular templates (`@if`, `@for`, bindings, events, two-way) into direct-DOM
updates driven by atoms. No signals and no `ChangeDetectorRef` are involved in
those updates.

Because Streamix overlaps with Angular's own solutions (Signals, DestroyRef,
DI, etc.), you still need clear boundaries: Streamix owns reactive state, and
the compiled view owns the DOM it can prove.

### 🔄 Key Overlaps with Angular

| Concern                  | Angular Solution              | Streamix Alternative          | Fit |
|--------------------------|-------------------------------|-------------------------------|-----|
| Reactive state           | Signals + RxJS                | Atoms, derived, flow          | Overlapping |
| Template updates         | Signals + change detection    | Compiled direct-DOM bindings  | Subpackage, opt-in |
| Lifecycle & cleanup      | DestroyRef, OnDestroy         | Scopes + explicit disposal    | Manual bridge needed |
| Async resources          | RxJS + switchMap              | flow() with auto-cancel       | Strong alternative |
| Feature-scoped state     | Services + Signals            | Scopes                        | Excellent alternative |

## 🧩 Using It in Angular Today

### Feature state in a service

Scopes pair naturally with Angular services. State reads are synchronous, so any consumer can query the current value on demand:

```ts
import { Injectable } from '@angular/core';
import { method, scope } from '@epikodelabs/streamix';

@Injectable({ providedIn: 'root' })
export class TaskStore {
  private readonly store = scope({
    filter: 'all' as 'all' | 'active' | 'done',
    tasks: [] as Array<{ text: string; done: boolean }>,
    visible: (self: any) => {
      if (self.filter === 'all') return self.tasks;
      return self.tasks.filter(t => t.done === (self.filter === 'done'));
    },
    setFilter: method((self: any, filter: 'all' | 'active' | 'done') => {
      self.filter = filter;
    }),
  });

  get visible() { return this.store.visible; }
  get tasks() { return this.store.tasks; }

  setFilter(filter: 'all' | 'active' | 'done') { this.store.setFilter(filter); }
}
```

### Using scopes in templates

The subpackage ships a compiler and a builder that compile standard Angular
templates into direct-DOM updates — no signals, no `ChangeDetectorRef`. If
your build runs the `@epikodelabs/streamix/angular/builder`, the same scope
reads update the DOM directly:

```ts
import { Component, DestroyRef } from '@angular/core';
import { method, scope } from '@epikodelabs/streamix';

@Component({
  selector: 'task-panel',
  template: `
    <button (click)="add()">Add ({{ model.tasks.length }})</button>
    <ul>
      @for (task of model.tasks; track task.text) {
        <li>{{ task.text }}</li>
      }
    </ul>
  `,
})
export class TaskPanel {
  readonly model = scope({
    tasks: [] as Array<{ text: string; done: boolean }>,
    add: method((self: any) => {
      self.tasks = [...self.tasks, { text: `Task ${self.tasks.length + 1}`, done: false }];
    }),
  });

  constructor(destroyRef: DestroyRef) {
    destroyRef.onDestroy(() => this.model.dispose());
  }

  add() { this.model.add(); }
}
```

Without the builder, the same scope works as ordinary Angular state: read the
values you need into component fields. See the
[Angular subpackage README](https://github.com/epikodelabs/streamix/blob/main/projects/libraries/streamix/angular/README.md)
for the compiled surface (control flow, expressions, events, two-way bindings)
and the build integration.

The scope is disposed with the component — no leaked subscriptions.

### ✅ Current Compatibility

**What works well:**
- Builds cleanly with `ng-packagr` 📦
- Full TypeScript + ESM support 💪
- Usable directly in Angular components & services
- Good tree-shaking (`sideEffects: false`)

**What needs care:**
- Scope disposal is explicit (call `scope.dispose()`, or wire it to `DestroyRef`)
- The compiled path owns control-flow DOM; a reactive read the compiler cannot
  prove is a build error rather than a silent fallback
- Own networking layer (parallel to Angular's)

## 🌍 Ecosystem Packages

The former companion areas live in separate packages now, all compatible with streamix v3:

| Package | Purpose |
|---------|---------|
| `@epikodelabs/coroutines` | Workers, structured task ownership, channels, actors |
| `@epikodelabs/waypoint` | Server-authorized routing for Angular |
| `@epikodelabs/forms` | Reactive form engine for TypeScript |

If you need routing or forms, choose between Angular's native tools and these ecosystem packages — core streamix stays out of that business.

## 🎯 Realistic Positioning

Streamix is **not** meant to replace Angular's router, forms, or HttpClient. Leave those to Angular's native tools.

**Where Streamix shines as an alternative:**
- Component & feature-level reactive state ✨
- Scoped async workflows with clean lifecycles
- Sequential `for await` orchestration
- When you want a unified, simple atom-based model instead of mixing Signals + RxJS

**Bottom line:**

Streamix is a mature, comprehensive reactive state system that **partially overlaps** with Angular's realm. You don't need to adapt it — it's already full-featured and ready to use.

Use it where its model feels more productive, and keep Angular's tools for the areas they own best. Clear boundaries = smooth sailing! 🛤️
