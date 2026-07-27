# Streamix Router

Streamix Router is a small, clean browser router for Angular.

It splits the work into two layers:

* **Vanilla router** → pure navigation engine with no Angular knowledge
* **Angular adapter** → turns components, layouts, inputs, providers, dependency injection, and outlets into something the vanilla router can use

### Core idea

You write nested layouts because they are natural and easy to understand.

The compiler flattens them into simple leaf routes.

The runtime router never walks nested child configurations. It only matches compiled flat paths and renders the associated outlet branches.

```text
You write nested routes + layouts
          ↓
Compiler flattens everything
          ↓
Vanilla router matches & navigates
          ↓
Angular renders components into their outlets
```

This keeps navigation fast and predictable while still supporting layouts, scoped providers, and multiple named outlets.

---

### How you declare routes

```ts
import {
  layout,
  route,
  lazyRoute,
  redirectRoute,
} from './streamix-router';

export const routes = [
  layout('', AppLayout, [
    route('', HomePage, {
      name: 'home',
    }),

    layout('admin', AdminLayout, [
      lazyRoute(
        'users/:id',
        () =>
          import('./user.page').then(
            module => module.UserPage
          ),
        {
          name: 'adminUser',
          paramsSchema: {
            id: s.number({ min: 1 }),
          },
          searchSchema: {
            tab: s.string('profile'),
          },
          beforeEnter: [requireAdmin],
          resolve: {
            user: loadUser,
          },
          providers: [UserStore],
        }
      ),
    ]),

    redirectRoute('account', '/settings'),

    route('settings', SettingsPage, {
      name: 'settings',
    }),
  ]),
] as const;
```

* `route()` → eager page
* `lazyRoute()` → lazy page
* `layout()` / `lazyLayout()` → structural wrapper, never matched by itself
* `redirectRoute()` → simple redirect

Layouts exist only for rendering hierarchy and providers.

The actual path matching always happens against the final compiled leaf route.

---

## Layouts in Streamix Router

Layouts let you share UI and providers across multiple pages without introducing nested runtime route matching.

* Put common chrome such as a header, sidebar, navigation bar, or admin shell in a layout once.
* Pages inside the layout automatically inherit the same rendering structure.
* Each layout can declare its own providers.
* Layout injectors are created and destroyed with the active route branch.
* Nested declarations are compiled into flat runtime routes.

The result is shared structure and scoped dependency injection while the router remains simple and fast.

---

## Router outlets

An outlet is a location where the Angular adapter renders an active route component.

The unnamed outlet is called the **primary outlet**.

Root template:

```html
<div data-router-outlet></div>
```

A layout normally contains one nested primary outlet:

```html
<header>Application header</header>

<main data-router-outlet></main>
```

The page matched by the current URL is rendered into that outlet.

For ordinary applications, the primary outlet may be the only outlet you need.

---

## Named outlets

Named outlets let one navigation render additional components into independent areas of the page.

Typical uses include:

* side panels
* inspectors
* modal layers
* contextual help
* secondary navigation
* persistent toolbars
* preview panes

A named outlet is declared with the `data-router-outlet` attribute and a name:

```html
<div class="application-shell">
  <main data-router-outlet></main>

  <aside data-router-outlet="sidebar"></aside>

  <section data-router-outlet="inspector"></section>
</div>
```

In this example:

* the unnamed outlet is the primary outlet
* `sidebar` is a named outlet
* `inspector` is another named outlet

Outlet names must be unique inside the same rendered layout branch.

---

### Declaring a route for a named outlet

Set the `outlet` option on a route:

```ts
export const routes = [
  layout('', AppLayout, [
    route('', HomePage, {
      name: 'home',
    }),

    route('projects/:id', ProjectPage, {
      name: 'project',
      paramsSchema: {
        id: s.number({ min: 1 }),
      },
    }),

    route('projects/:id', ProjectSidebar, {
      name: 'projectSidebar',
      outlet: 'sidebar',
      paramsSchema: {
        id: s.number({ min: 1 }),
      },
    }),
  ]),
] as const;
```

When `/projects/42` is active:

* `ProjectPage` is rendered into the primary outlet
* `ProjectSidebar` is rendered into the `sidebar` outlet

Both routes use the same browser path, but they target different outlets.

The combination of `path` and `outlet` identifies the rendering target.

---

### Primary outlet

The primary outlet may be written explicitly:

```ts
route('projects/:id', ProjectPage, {
  name: 'project',
  outlet: 'primary',
});
```

However, omitting `outlet` is equivalent and is normally preferred:

```ts
route('projects/:id', ProjectPage, {
  name: 'project',
});
```

These declarations have the same meaning.

---

### Named outlets inside layouts

Named outlets belong to the layout that renders them.

```ts
export const routes = [
  layout('', AppLayout, [
    layout('workspace', WorkspaceLayout, [
      route(':id', WorkspacePage, {
        name: 'workspace',
      }),

      route(':id', WorkspaceTools, {
        name: 'workspaceTools',
        outlet: 'tools',
      }),

      route(':id', WorkspaceInspector, {
        name: 'workspaceInspector',
        outlet: 'inspector',
      }),
    ]),
  ]),
] as const;
```

`WorkspaceLayout` can declare all three rendering locations:

```html
<div class="workspace">
  <nav data-router-outlet="tools"></nav>

  <main data-router-outlet></main>

  <aside data-router-outlet="inspector"></aside>
</div>
```

For `/workspace/42`, the router can render:

```text
WorkspaceLayout
├── tools      → WorkspaceTools
├── primary    → WorkspacePage
└── inspector  → WorkspaceInspector
```

The vanilla router still matches flat compiled routes.

The Angular adapter uses the compiled outlet metadata to render each component into the correct location.

---

### Outlet groups

Routes that share the same compiled path form an outlet group.

```ts
route('messages/:id', MessagePage, {
  name: 'message',
});

route('messages/:id', MessageList, {
  name: 'messageList',
  outlet: 'sidebar',
});

route('messages/:id', MessageDetails, {
  name: 'messageDetails',
  outlet: 'inspector',
});
```

The compiler groups these routes by:

```text
compiled path + layout branch
```

Within one group, each outlet may have at most one route.

This is valid:

```text
/messages/:id
├── primary
├── sidebar
└── inspector
```

This is invalid because two routes target the same outlet:

```ts
route('messages/:id', FirstSidebar, {
  outlet: 'sidebar',
});

route('messages/:id', SecondSidebar, {
  outlet: 'sidebar',
});
```

The route compiler reports duplicate path-and-outlet combinations during configuration.

---

### Independent named-outlet paths

A named outlet does not have to share the primary route's exact path.

```ts
export const routes = [
  layout('', AppLayout, [
    route('projects/:id', ProjectPage, {
      name: 'project',
    }),

    route('projects/:id/activity', ActivityPanel, {
      name: 'projectActivity',
      outlet: 'sidebar',
    }),
  ]),
] as const;
```

This allows the named outlet to have its own navigable state.

For example:

```ts
await router.navigateTo.projectActivity({
  params: {
    id: 42,
  },
});
```

How that state is represented in the URL depends on the router's outlet URL strategy.

For most applications, routes sharing the same path are the simplest model because the entire screen remains represented by one ordinary URL.

---

### Layout outlet rules

A layout may contain:

* zero or one primary nested outlet
* any number of uniquely named outlets

Example:

```html
<div class="shell">
  <header>Streamix</header>

  <main data-router-outlet></main>

  <aside data-router-outlet="sidebar"></aside>

  <div data-router-outlet="overlay"></div>
</div>
```

A layout must not contain two outlets with the same name:

```html
<!-- Invalid -->
<aside data-router-outlet="sidebar"></aside>
<section data-router-outlet="sidebar"></section>
```

A layout must also not contain multiple primary outlets:

```html
<!-- Invalid -->
<main data-router-outlet></main>
<section data-router-outlet></section>
```

Outlet validation happens when the rendered layout is connected.

---

### Empty named outlets

A named outlet does not need to have an active component for every URL.

```html
<main data-router-outlet></main>
<aside data-router-outlet="sidebar"></aside>
```

If the current route group does not contain a `sidebar` route, the sidebar outlet remains empty.

The layout itself stays mounted.

This makes optional panels straightforward:

```ts
route('dashboard', DashboardPage, {
  name: 'dashboard',
});

route('dashboard/settings', DashboardSettingsPage, {
  name: 'dashboardSettings',
});

route('dashboard/settings', SettingsHelpPanel, {
  name: 'settingsHelp',
  outlet: 'sidebar',
});
```

The sidebar is empty on `/dashboard` and populated on `/dashboard/settings`.

---

### Lazy named outlets

Named-outlet components can be lazy-loaded:

```ts
lazyRoute(
  'projects/:id',
  () =>
    import('./project-inspector.page').then(
      module => module.ProjectInspectorPage
    ),
  {
    name: 'projectInspector',
    outlet: 'inspector',
    paramsSchema: {
      id: s.number({ min: 1 }),
    },
  }
);
```

Lazy named-outlet routes follow the same loading, cancellation, caching, and preloading rules as primary routes.

A navigation is committed only after all required outlet branches are ready.

If a lazy named outlet fails to load, the navigation fails as a whole rather than leaving the screen partially updated.

---

### Providers in named outlets

Named-outlet routes may declare their own providers:

```ts
route('projects/:id', ProjectInspector, {
  name: 'projectInspector',
  outlet: 'inspector',
  providers: [
    ProjectInspectorStore,
  ],
});
```

The component can inject:

* application-level providers
* providers from parent layouts
* providers declared by its own route

Named outlets do not share page-level injectors with sibling outlets unless the provider is declared on a common parent layout.

For shared route-branch state, put the provider on the layout:

```ts
layout(
  'projects',
  ProjectLayout,
  [
    route(':id', ProjectPage, {
      name: 'project',
    }),

    route(':id', ProjectInspector, {
      name: 'projectInspector',
      outlet: 'inspector',
    }),
  ],
  {
    providers: [
      ProjectStore,
    ],
  }
);
```

Both outlet components can now inject the same `ProjectStore` instance.

---

### Guards and resolvers in named outlets

Named-outlet routes support the same guards and resolvers as primary routes:

```ts
route('projects/:id', ProjectInspector, {
  name: 'projectInspector',
  outlet: 'inspector',

  beforeEnter: [
    requireProjectAccess,
  ],

  resolve: {
    permissions: loadProjectPermissions,
  },
});
```

All participating outlet routes are prepared as part of the same navigation.

Resolvers run in parallel where possible.

The navigation is committed only when:

* guards have allowed the transition
* required lazy components have loaded
* resolvers have completed
* the navigation has not been cancelled

This prevents different outlets from displaying state from different navigations.

---

### Input binding in named outlets

Automatic input binding works exactly the same way for primary and named outlets.

```ts
@Component({
  standalone: true,
  template: `
    Project {{ id() }}
    Permission: {{ permissions()?.level }}
  `,
})
export class ProjectInspector {
  id = input.required<number>();
  permissions = input<ProjectPermissions>();
}
```

Route params, search values, static data, and resolved values are written into matching component inputs.

Each outlet receives values from its own compiled route.

---

### Navigating to named routes

Named outlets do not change the named-navigation API.

```ts
const router = inject(StreamixRouter);

await router.navigateTo.project({
  params: {
    id: 42,
  },
});

await router.navigateTo.projectInspector({
  params: {
    id: 42,
  },
});
```

Route names remain globally unique regardless of outlet.

This is invalid:

```ts
route('projects/:id', ProjectPage, {
  name: 'project',
});

route('projects/:id', ProjectSidebar, {
  name: 'project',
  outlet: 'sidebar',
});
```

Even though the outlets differ, the duplicate route name is rejected.

---

### Getting named-route hrefs

Href generation also works normally:

```ts
const projectHref =
  router.hrefTo.project({
    params: {
      id: 42,
    },
  });

const inspectorHref =
  router.hrefTo.projectInspector({
    params: {
      id: 42,
    },
  });
```

If several outlet routes share the same browser path, their generated hrefs may be identical:

```ts
projectHref === inspectorHref;
```

That is expected.

A route name identifies a compiled route definition. It does not necessarily imply a unique URL.

---

### Closing a named outlet

For URL-driven named outlets, closing the outlet means navigating to a route state where that outlet is not active.

For example:

```ts
await router.navigateTo.project({
  params: {
    id: 42,
  },
});
```

If the `project` route does not activate the `inspector` outlet, the current inspector component is destroyed and the outlet becomes empty.

This keeps outlet state deterministic and reproducible from navigation state.

Named outlets are not an imperative component portal. Components should be opened and closed through routing rather than by directly attaching them to outlet elements.

---

### Named outlets and redirects

Redirects do not render into outlets.

They only produce another navigation target:

```ts
redirectRoute(
  'projects/:id/details',
  '/projects/:id'
);
```

The target route determines which primary and named outlets become active.

A redirect route therefore cannot declare:

```ts
{
  outlet: 'sidebar'
}
```

---

### Named outlets and layouts

Layouts themselves are structural and are not assigned to named outlets through route matching.

A layout wraps the outlet routes compiled beneath it:

```ts
layout('projects', ProjectLayout, [
  route(':id', ProjectPage),
  route(':id', ProjectSidebar, {
    outlet: 'sidebar',
  }),
]);
```

The compiled rendering plan is conceptually:

```text
/projects/:id
└── ProjectLayout
    ├── primary → ProjectPage
    └── sidebar → ProjectSidebar
```

The runtime does not recursively match `ProjectLayout`.

It receives the already compiled rendering plan for the matched path.

---

## Angular setup

```ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideStreamixRouter(routes, {
      baseHref: '/',
      preloading: 'idle',
      scrollRestoration: 'restore',
      viewTransitions: true,
    }),
  ],
};
```

Available preloading modes:

```ts
'none' | 'eager' | 'idle'
```

Available scroll-restoration modes:

```ts
'preserve' | 'top' | 'restore'
```

Root template:

```html
<div data-router-outlet></div>
```

A layout with named outlets:

```html
<div class="layout">
  <main data-router-outlet></main>
  <aside data-router-outlet="sidebar"></aside>
  <div data-router-outlet="overlay"></div>
</div>
```

---

## Named navigation

```ts
const router = inject(StreamixRouter);

// Navigate
await router.navigateTo.adminUser({
  params: {
    id: 42,
  },
  search: {
    tab: 'permissions',
  },
});

// Generate an href
const href =
  router.hrefTo.adminUser({
    params: {
      id: 42,
    },
  });
```

Unknown route names are rejected by TypeScript.

Named routes may target either the primary outlet or a named outlet.

---

## Automatic input binding

Route values are automatically written into matching component inputs:

```ts
@Component({
  standalone: true,
  template: `
    User {{ id() }} – {{ tab() }}
  `,
})
export class UserPage {
  id = input.required<number>();
  tab = input('profile');
  user = input<User>();
}
```

Input sources, from lowest to highest priority:

1. raw path params
2. raw query params
3. parsed params from the parameter schema
4. parsed search values
5. static and resolved data

Later sources override earlier ones.

The same rules apply to components rendered into named outlets.

---

## Navigation consistency

All active outlets belong to one navigation transaction.

The router does not update the primary outlet first and named outlets later.

Instead, it:

1. matches the compiled route group
2. evaluates guards
3. loads lazy components
4. runs resolvers
5. creates the required injector branches
6. commits every outlet update together

If the navigation is cancelled, none of the new outlet components are committed.

This avoids mixed screens where one outlet displays the new route while another still displays the old route.

---

## View transitions

When View Transitions are enabled, primary and named outlet updates participate in the same navigation transition.

```ts
provideStreamixRouter(routes, {
  viewTransitions: true,
});
```

A route may still override the default behavior through its route metadata where supported.

Because all outlets are committed together, the browser captures one consistent before-and-after state.

---

## Validation

The route compiler validates:

* duplicate route names
* duplicate compiled primary paths
* duplicate `path + outlet` combinations
* invalid or empty outlet names
* conflicting outlet definitions in the same compiled branch
* redirects that declare rendering-only options
* layouts that produce ambiguous rendering branches

The Angular adapter validates rendered outlet elements:

* no duplicate primary outlet within one layout
* no duplicate named outlet within one layout
* required outlets exist for the active rendering plan
* outlet names match the compiled route definitions

These checks make outlet configuration errors fail early rather than producing silent rendering problems.

---

## Other features

* Flat runtime route matching
* Nested declarative layouts
* Primary and named outlets
* Atomic multi-outlet navigation
* Hierarchical providers
* Page and layout-scoped dependency injection
* Guards with `AbortSignal`
* `beforeEnter` and `beforeLeave`
* Parallel resolvers
* Parameter and search schemas
* `s.number()`
* `s.string()`
* `s.optional()`
* `s.array()`
* Automatic component input binding
* Navigation cancellation
* Lazy component loading
* Preloading
* Scroll restoration
* View Transitions
* History state
* Base-href support
* Duplicate name, path, and outlet validation

---

## Design principle

> Routes are compiled once.
> Navigation only operates on flat leaf routes.
> Outlets affect rendering, not path-matching complexity.

Named outlets do not reintroduce a recursive runtime router.

---

## Future Features

The following features are planned for future development, prioritized based on developer value and architectural impact.

### Recommended order

I would prioritize them like this:

1.  **Typed route references**
    High developer value with little runtime complexity.
2.  **Structured navigation diagnostics**
    Your router is already sophisticated enough that observability will become important.
3.  **Smarter explicit preloading**
    Relatively isolated and useful immediately.
4.  **SSR platform separation**
    Architecturally important, but it requires careful separation of browser APIs.
5.  **Hydration and partial hydration**
    Build this only after the SSR boundary is stable.
6.  **Advanced transition coordination**
    Visually valuable, but it should remain an optional layer above the core navigation state machine.

They are compiled rendering targets attached to flat leaf routes.

The vanilla router decides what navigation state is active.

The Angular adapter decides where each component in that state is rendered.
