# 🚀 Streamix and the Angular Ecosystem

Streamix isn't a lightweight wrapper around Angular primitives. It brings its own **comprehensive** implementation of reactive state (atoms + derived), scoped lifecycles, and async resources.

This creates **intentional overlap** with parts of Angular. Instead of blending in seamlessly, Streamix serves as a capable alternative you can use *instead of* certain Angular tools when it fits better.

### ⚡ Short Verdict

Streamix works great today as a regular TypeScript library inside an Angular workspace. You can import and use it in components and services without any build headaches.

However, it's **not** a first-class Angular-native integration. Because it overlaps with Angular's own solutions (Signals, DestroyRef, DI, etc.), you need clear boundaries.

### 🔄 Key Overlaps with Angular

| Concern                  | Angular Solution              | Streamix Alternative          | Fit |
|--------------------------|-------------------------------|-------------------------------|-----|
| Reactive state           | Signals + RxJS                | Atoms, derived, flow          | Overlapping |
| Lifecycle & cleanup      | DestroyRef, OnDestroy         | Scopes + auto-disposal        | Manual bridge needed |
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

### Bridging into templates

There is no official Signal interop yet, so bridge atoms into signals yourself. `subscribeTo(key, callback)` gives you a direct subscription to any scope member, and `DestroyRef` ties scope disposal to the component lifecycle:

```ts
import { Component, DestroyRef, signal } from '@angular/core';
import { method, scope } from '@epikodelabs/streamix';

@Component({
  selector: 'task-panel',
  template: `
    <button (click)="add()">Add ({{ tasks().length }})</button>
    <ul><li *ngFor="let task of tasks()">{{ task.text }}</li></ul>
  `,
})
export class TaskPanel {
  private readonly store = scope({
    tasks: [] as Array<{ text: string; done: boolean }>,
    add: method((self: any) => {
      self.tasks = [...self.tasks, { text: `Task ${self.tasks.length + 1}`, done: false }];
    }),
  });

  readonly tasks = signal(this.store.tasks);

  constructor(destroyRef: DestroyRef) {
    this.store.subscribeTo('tasks', tasks => this.tasks.set(tasks));
    destroyRef.onDestroy(() => this.store.dispose());
  }

  add() { this.store.add(); }
}
```

The subscription lives as long as the scope, and the scope is disposed with the component — no leaked listeners.

### ✅ Current Compatibility

**What works well:**
- Builds cleanly with `ng-packagr` 📦
- Full TypeScript + ESM support 💪
- Usable directly in Angular components & services
- Good tree-shaking (`sideEffects: false`)

**What needs care:**
- No automatic `DestroyRef` integration (call `scope.dispose()` yourself for now)
- No official Signal interop yet — bridge atoms into signals manually
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
