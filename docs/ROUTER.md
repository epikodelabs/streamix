# Streamix Router

Streamix Router is a small, clean browser router for Angular.

It splits the work into two layers:

- **Vanilla router** → pure navigation engine (no Angular knowledge)
- **Angular adapter** → turns your components, layouts, inputs, providers and DI into something the vanilla router can use

### Core idea
You write nested layouts (feels natural).  
The compiler flattens them into simple leaf routes.  
The runtime router never walks nested children — it only sees flat paths.  
This keeps everything fast and predictable.

```
You write nested routes + layouts
          ↓
Compiler flattens everything
          ↓
Vanilla router matches & navigates
          ↓
Angular renders the right components + injectors
```

---

### How you declare routes

```ts
import { layout, route, lazyRoute, redirectRoute } from './streamix-router';

export const routes = [
  layout('', AppLayout, [
    route('', HomePage, { name: 'home' }),

    layout('admin', AdminLayout, [
      lazyRoute('users/:id', () => import('./user.page').then(m => m.UserPage), {
        name: 'adminUser',
        paramsSchema: { id: s.number({ min: 1 }) },
        searchSchema: { tab: s.string('profile') },
        beforeEnter: [requireAdmin],
        resolve: { user: loadUser },
        providers: [UserStore],
      }),
    ]),

    redirectRoute('account', '/settings'),
    route('settings', SettingsPage, { name: 'settings' }),
  ]),
] as const;
```

- `route()` → eager page
- `lazyRoute()` → lazy page
- `layout()` / `lazyLayout()` → structural wrapper (never matched by itself)
- `redirectRoute()` → simple redirect

Layouts only exist for rendering hierarchy + providers.  
The actual matching always happens on the final flat path.

**Layouts in Streamix Router**

Layouts let you share UI and providers across multiple pages without nested route matching.

- Put common chrome (header, sidebar, admin shell…) in a layout once.
- Pages inside it automatically inherit the same structure.
- Each layout can declare its own providers → hierarchical injectors that are created and destroyed with the route branch.
- You still write nested declarations, but the runtime only ever matches flat leaf routes.

Result: clean shared structure + scoped DI, while the router stays simple and fast.

---

### Angular setup

```ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideStreamixRouter(routes, {
      baseHref: '/',
      preloading: 'idle',          // 'none' | 'eager' | 'idle'
      scrollRestoration: 'restore', // 'preserve' | 'top' | 'restore'
      viewTransitions: true,
    }),
  ],
};
```

Root template:
```html
<div data-router-outlet></div>
```

Every layout must contain **exactly one** nested outlet:
```html
<main data-router-outlet></main>
```

---

### Named navigation (type-safe)

```ts
const router = inject(StreamixRouter);

// Navigate
await router.navigateTo.adminUser({
  params: { id: 42 },
  search: { tab: 'permissions' },
});

// Just get the href
const href = router.hrefTo.adminUser({ params: { id: 42 } });
```

Unknown route names are rejected by TypeScript.

---

### Automatic input binding

Route values are automatically written into matching component inputs:

```ts
@Component({ standalone: true, template: `User {{ id() }} – {{ tab() }}` })
export class UserPage {
  id = input.required<number>();
  tab = input('profile');
  user = input<User>();
}
```

Sources (later ones win):
1. raw path params  
2. raw query params  
3. parsed params (from schema)  
4. parsed search  
5. static + resolved data

---

### Other goodies

- Hierarchical providers (page can inject from any parent layout)
- Guards (`beforeEnter` / `beforeLeave`) with AbortSignal
- Resolvers that run in parallel
- Parameter & search schemas (`s.number()`, `s.string()`, `s.optional()`, `s.array()`…)
- Navigation cancellation
- Preloading, scroll restoration, View Transitions
- History state
- Base-href support
- Duplicate name / path validation

---

### Design principle

> Routes are compiled once.  
> Navigation only ever operates on flat leaf routes.
