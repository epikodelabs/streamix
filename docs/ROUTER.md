# Streamix Router

A small browser router with an Angular rendering adapter.

Streamix Router separates route execution from framework rendering:

- **`vanilla-router.ts`** owns URL recognition, navigation, history, guards, resolvers, cancellation, preloading, scrolling, and view transitions.
- **`streamix-router.ts`** adapts Angular components, dependency injection, component inputs, layouts, and named navigation.
- **Route builders** preserve route declarations as typed configuration.
- **Layouts** are compiled into leaf routes. The runtime router never traverses nested child configurations during navigation.

```text
Route declaration
      ↓
Route compiler
      ↓
Flat leaf routes
      ↓
Vanilla router
      ↓
Angular route renderer
```

## Features

- Eager and lazy Angular components
- Nested layouts without nested runtime route matching
- Hierarchical route providers
- Named navigation and href generation
- Path parameter and search schemas
- Route guards and resolvers
- Automatic Angular input binding
- Navigation cancellation with `AbortSignal`
- Redirects
- Base-href support
- History state
- Scroll restoration
- Route preloading
- View Transitions API support
- Activation and deactivation events
- Duplicate route-name and route-pattern validation

---

## Route model

There are two declaration types:

- **Route** — a navigable leaf that renders a page component or redirects.
- **Layout** — a structural component containing more routes or layouts.

A layout is not independently matched by the runtime router. The compiler combines its path with every nested leaf route.

```ts
import {
  layout,
  lazyRoute,
  redirectRoute,
  route,
} from './streamix-router';

export const routes = [
  layout(
    '',
    AppLayout,
    [
      route('', HomePage, {
        name: 'home',
      }),

      layout(
        'admin',
        AdminLayout,
        [
          lazyRoute(
            'users/:id',
            () =>
              import('./users/user.page')
                .then(module => module.UserPage),
            {
              name: 'adminUser',
            },
          ),
        ] as const,
      ),

      redirectRoute(
        'account',
        '/settings',
      ),

      route(
        'settings',
        SettingsPage,
        {
          name: 'settings',
        },
      ),
    ] as const,
  ),
] as const;
```

The compiler produces leaf routes similar to:

```text
/
└─ AppLayout
   ├─ HomePage                   /
   ├─ AdminLayout
   │  └─ UserPage               /admin/users/:id
   └─ SettingsPage              /settings
```

Only the leaf paths are passed to the vanilla router.

---

## Angular setup

Register the routes during application bootstrap:

```ts
import {
  ApplicationConfig,
} from '@angular/core';

import {
  provideStreamixRouter,
} from './streamix-router';

import {
  routes,
} from './app.routes';

export const appConfig:
  ApplicationConfig = {
  providers: [
    provideStreamixRouter(
      routes,
      {
        baseHref: '/',
        preloading: 'idle',
        scrollRestoration:
          'restore',
        viewTransitions: true,
      },
    ),
  ],
};
```

The root template needs a router outlet:

```html
<div data-router-outlet></div>
```

A layout component also needs exactly one nested outlet:

```ts
import {
  Component,
} from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-layout',
  template: `
    <header>
      Streamix
    </header>

    <main data-router-outlet></main>
  `,
})
export class AppLayout {}
```

A rendered layout with zero nested outlets cannot host its child view. A rendered layout with more than one outlet is rejected because the renderer cannot determine which outlet owns the next layer.

---

## Route builders

### `route()`

Declares an eager page component.

```ts
route(
  'projects/:projectId',
  ProjectPage,
  {
    name: 'project',
  },
);
```

### `lazyRoute()`

Declares a lazily loaded page component.

```ts
lazyRoute(
  'reports',
  () =>
    import('./reports.page')
      .then(module =>
        module.ReportsPage
      ),
  {
    name: 'reports',
    preload: true,
  },
);
```

A default export is also accepted:

```ts
lazyRoute(
  'help',
  () =>
    import('./help.page'),
);
```

The lazy loader must resolve to an Angular component class or an object whose `default` property is the component.

### `redirectRoute()`

Declares a redirect-only leaf:

```ts
redirectRoute(
  'account',
  '/settings',
);
```

Relative redirects are resolved against the containing layout path:

```ts
layout(
  'admin',
  AdminLayout,
  [
    redirectRoute(
      '',
      'dashboard',
    ),

    route(
      'dashboard',
      DashboardPage,
    ),
  ] as const,
);
```

### `layout()`

Declares an eager layout:

```ts
layout(
  'admin',
  AdminLayout,
  [
    route(
      'users',
      UsersPage,
    ),
  ] as const,
);
```

### `lazyLayout()`

Declares a lazy layout while keeping its route entries statically known:

```ts
lazyLayout(
  'workspace',
  () =>
    import('./workspace.layout')
      .then(module =>
        module.WorkspaceLayout
      ),
  [
    route(
      'overview',
      OverviewPage,
    ),
  ] as const,
);
```

---

## Route options

A page route can define:

```ts
route(
  'projects/:projectId',
  ProjectPage,
  {
    name: 'project',

    preload: true,

    viewTransition: true,

    data: {
      area: 'projects',
    },

    paramsSchema: {
      projectId:
        s.number({
          min: 1,
        }),
    },

    searchSchema: {
      tab:
        s.string('overview'),

      page:
        s.number({
          default: 1,
          min: 1,
        }),

      filters:
        s.array(),

      draft:
        s.optional(
          s.boolean(),
        ),
    },

    providers: [
      ProjectStore,
    ],

    beforeEnter: [
      projectAccessGuard,
    ],

    beforeLeave: [
      unsavedChangesGuard,
    ],

    resolve: {
      project:
        loadProject,
    },
  },
);
```

Layouts support:

```ts
layout(
  'admin',
  AdminLayout,
  entries,
  {
    preload: true,

    providers: [
      AdminSession,
    ],
  },
);
```

---

## Named navigation

Give a route a globally unique `name`:

```ts
route(
  'projects/:projectId',
  ProjectPage,
  {
    name: 'project',
  },
);
```

Then navigate without hardcoding its path:

```ts
import {
  inject,
} from '@angular/core';

const router =
  inject(StreamixRouter);

await router.navigateTo.project({
  params: {
    projectId: 42,
  },
});
```

Generate an href without navigating:

```ts
const href =
  router.hrefTo.project({
    params: {
      projectId: 42,
    },
  });
```

Named helpers are generated from the configured route tree, so unknown route names are rejected by TypeScript.

The current runtime also validates and serializes route parameters and search values using the declared schemas.

---

## Direct navigation

The router also accepts direct targets:

```ts
await router.navigate(
  '/settings',
);

await router.navigate(
  {
    path: '/settings',
  },
);

await router.navigate(
  {
    name: 'project',
    params: {
      projectId: 42,
    },
  },
);
```

Navigation options:

```ts
await router.navigate(
  '/settings',
  {
    replace: true,

    state: {
      source: 'account-menu',
    },
  },
);
```

`navigate()` resolves to:

- `true` when navigation succeeds;
- `false` when navigation is blocked, cancelled, superseded, or cannot produce a URL.

---

## URL generation

```ts
router.href('/settings');

router.href({
  path: '/settings',
});

router.href({
  name: 'project',
  params: {
    projectId: 42,
  },
});
```

`href()` returns `null` when a named route does not exist or a required path parameter is missing.

The same URL-resolution rules are used before and after the router connects to an outlet.

---

## Parameter schemas

Path parameters arrive from the URL as strings. A parameter schema parses them before they are bound to the component or exposed through resolved route data.

```ts
route(
  'users/:id',
  UserPage,
  {
    paramsSchema: {
      id:
        s.number({
          min: 1,
        }),
    },
  },
);
```

Available schemas:

```ts
s.string(defaultValue?)

s.number({
  default?,
  min?,
  max?,
})

s.boolean(defaultValue?)

s.date(defaultValue?)

s.optional(schema)
```

Example:

```ts
paramsSchema: {
  id:
    s.number({
      min: 1,
    }),

  revision:
    s.optional(
      s.number({
        min: 1,
      }),
    ),
}
```

---

## Search schemas

Search schemas parse and serialize query-string values:

```ts
searchSchema: {
  query:
    s.optional(
      s.string(),
    ),

  page:
    s.number({
      default: 1,
      min: 1,
    }),

  archived:
    s.optional(
      s.boolean(),
    ),

  tags:
    s.array(),

  date:
    s.optional(
      s.date(),
    ),
}
```

Example URL:

```text
/projects/42?page=2&archived=true&tags=router&tags=angular
```

Supported search values:

- `string`
- `number`
- `boolean`
- `readonly string[]`
- `Date`
- optional versions of each schema

Arrays are encoded using repeated query parameters:

```text
?tags=router&tags=angular
```

Dates are encoded as ISO strings.

Values equal to their schema defaults are omitted during serialization.

---

## Automatic component input binding

The Angular adapter binds route values to matching component inputs.

Sources are merged in this order:

```text
raw path params
raw query params
parsed params
parsed search values
static and resolved route data
```

Later sources override earlier sources.

```ts
import {
  Component,
  input,
} from '@angular/core';

@Component({
  standalone: true,
  template: `
    Project {{ projectId() }}
  `,
})
export class ProjectPage {
  readonly projectId =
    input.required<number>();

  readonly tab =
    input('overview');

  readonly project =
    input<Project>();
}
```

With:

```ts
route(
  'projects/:projectId',
  ProjectPage,
  {
    paramsSchema: {
      projectId:
        s.number(),
    },

    searchSchema: {
      tab:
        s.string(
          'overview',
        ),
    },

    resolve: {
      project:
        loadProject,
    },
  },
);
```

the router binds `projectId`, `tab`, and `project` automatically.

The router only writes declared Angular inputs. Extra route values are ignored.

---

## Guards

### `beforeEnter`

Runs before the route is activated:

```ts
const requireSession:
  BeforeEnter =
  async context => {
    const session =
      inject(Session);

    return session.active
      ? true
      : {
          redirectTo:
            '/sign-in',

          replace: true,
        };
  };
```

Register it:

```ts
route(
  'account',
  AccountPage,
  {
    beforeEnter: [
      requireSession,
    ],
  },
);
```

### `beforeLeave`

Runs before leaving the active route:

```ts
const confirmLeave:
  BeforeLeave =
  context => {
    const editor =
      inject(EditorState);

    return editor.dirty
      ? window.confirm(
          'Discard changes?',
        )
      : true;
  };
```

Possible guard results:

```ts
true
false
'/redirect'
new URL(...)
{
  redirectTo: '/redirect',
  replace: true,
}
```

Guards run inside the Angular environment injector, so they may use `inject()`.

Every guard receives an `AbortSignal` through its navigation context. Long-running work should stop when the signal is aborted.

---

## Resolvers

Resolvers run after activation guards and before rendering:

```ts
const loadProject:
  RouteLoader<Project> =
  async context => {
    const api =
      inject(ProjectApi);

    return api.get(
      Number(
        context.params[
          'projectId'
        ],
      ),
      {
        signal:
          context.signal,
      },
    );
  };
```

Register resolvers by key:

```ts
resolve: {
  project:
    loadProject,

  permissions:
    loadPermissions,
}
```

Resolver results are merged with static `data` and are available to component input binding.

All resolvers for a route execute concurrently.

---

## Route providers

Pages and layouts may declare Angular providers:

```ts
layout(
  '',
  AppLayout,
  [
    layout(
      'admin',
      AdminLayout,
      [
        route(
          'users',
          UsersPage,
          {
            providers: [
              UsersStore,
            ],
          },
        ),
      ] as const,
      {
        providers: [
          AdminSession,
        ],
      },
    ),
  ] as const,
  {
    providers: [
      AppShellState,
    ],
  },
);
```

The renderer creates a hierarchical injector chain:

```text
Application injector
└─ AppLayout injector
   └─ AdminLayout injector
      └─ UsersPage injector
```

This means:

- a page can inject providers from every containing layout;
- an inner layout or page can override an outer provider;
- providers are scoped to the rendered route branch;
- route-scoped injectors are destroyed with their component layer.

Do not place `null`, `undefined`, or `false` inside a provider array.

Use conditional spreading instead:

```ts
providers: [
  ...enabled
    ? [provideFeature()]
    : [],
]
```

not:

```ts
providers: [
  enabled
    ? provideFeature()
    : null,
]
```

---

## Injector and component disposal

Each rendered level owns its component and, when providers exist, its child environment injector.

Disposal happens from the innermost page outward:

```text
page component
page injector
inner layout component
inner layout injector
outer layout component
outer layout injector
```

This preserves the dependency hierarchy during teardown.

The route render context also exposes:

```ts
interface RouteRenderContext {
  readonly signal:
    AbortSignal;

  readonly destroySignal:
    AbortSignal;
}
```

- `signal` is aborted when the current navigation is cancelled.
- `destroySignal` is aborted when the rendered view is removed.

---

## Router state

```ts
const state =
  router.state;
```

The state contains:

```ts
interface RouterState {
  readonly current:
    ActivatedRoute | null;

  readonly pending:
    boolean;

  readonly phase:
    | 'recognizing'
    | 'guarding'
    | 'resolving'
    | 'loading'
    | null;

  readonly error:
    unknown;

  readonly path:
    string;

  readonly params:
    Readonly<
      Record<
        string,
        string
      >
    >;

  readonly query:
    Readonly<
      Record<
        string,
        string
      >
    >;

  readonly data:
    Readonly<
      Record<
        string,
        unknown
      >
    >;

  readonly historyState:
    unknown;

  readonly routeConfig:
    Route | null;
}
```

Other useful properties:

```ts
router.active;
router.url;
```

`router.url` includes pathname, search, and hash.

---

## History state

Store state in the active browser history entry:

```ts
router.updateHistoryState({
  selectedTab: 'activity',
});
```

Read it from:

```ts
router.state.historyState;
```

or inside guards and resolvers:

```ts
context.historyState;
```

---

## Preloading

Global strategies:

```ts
provideStreamixRouter(
  routes,
  {
    preloading: 'none',
  },
);
```

Available values:

- **`none`** — do not preload.
- **`eager`** — queue preloading immediately after startup.
- **`idle`** — use `requestIdleCallback`, with a timer fallback.

Routes and layouts may opt out:

```ts
{
  preload: false,
}
```

Manually trigger preloading:

```ts
await router.preload();
```

Lazy load promises are cached. A failed lazy load is removed from the cache so a later navigation may retry it.

---

## Scroll restoration

```ts
provideStreamixRouter(
  routes,
  {
    scrollRestoration:
      'restore',
  },
);
```

Modes:

- **`preserve`** — do not change scroll position.
- **`top`** — scroll successful navigations to the top.
- **`restore`** — restore saved positions for back/forward navigation and otherwise scroll to the top.

---

## View transitions

Enable transitions globally:

```ts
provideStreamixRouter(
  routes,
  {
    viewTransitions: true,
  },
);
```

Or decide per navigation:

```ts
provideStreamixRouter(
  routes,
  {
    viewTransitions:
      context =>
        context.phase ===
          'success',
  },
);
```

A route can override the global setting:

```ts
route(
  'editor',
  EditorPage,
  {
    viewTransition: false,
  },
);
```

When `document.startViewTransition` is unavailable, rendering proceeds normally.

---

## Base href

```ts
provideStreamixRouter(
  routes,
  {
    baseHref: '/app',
  },
);
```

The router also reads Angular's `APP_BASE_HREF` when `baseHref` is not supplied directly.

With:

```ts
baseHref: '/app'
```

the route:

```ts
route(
  'settings',
  SettingsPage,
);
```

produces:

```text
/app/settings
```

Navigation outside the configured base is rejected.

---

## Redirects

Static route redirect:

```ts
redirectRoute(
  'old/:id',
  '/projects/:id',
);
```

Parameters are interpolated from the matched route.

Guard redirect:

```ts
return {
  redirectTo:
    '/sign-in',

  replace: true,
};
```

The router limits redirect chains using `maxRedirects`:

```ts
provideStreamixRouter(
  routes,
  {
    maxRedirects: 10,
  },
);
```

---

## Navigation cancellation

Starting a new navigation aborts the previous pending navigation.

The cancellation signal is propagated to:

- guards;
- resolvers;
- the route render context.

Example:

```ts
const loadData:
  RouteLoader =
  async context => {
    const response =
      await fetch(
        '/api/data',
        {
          signal:
            context.signal,
        },
      );

    return response.json();
  };
```

Aborted navigation does not render an error page.

---

## Outlet lifecycle events

The router dispatches DOM events:

```ts
'vanilla-router-activate'
'vanilla-router-deactivate'
'vanilla-router-locationchange'
```

Listen on an outlet:

```ts
const outlet =
  document.querySelector(
    '[data-router-outlet]',
  );

outlet?.addEventListener(
  'vanilla-router-activate',
  event => {
    const component =
      (
        event as
          CustomEvent
      ).detail;
  },
);
```

The event detail contains the activated or deactivated component instance.

---

## Router lifecycle

The Angular router adapter supports:

```ts
router.connect(outlet);
router.disconnect(outlet);
router.dispose();
```

Normally an outlet directive connects and disconnects the router automatically.

A router can only be connected to one root outlet at a time. Calling `connect()` with a different outlet while already connected throws.

`DestroyRef` automatically disposes the router when its Angular provider scope is destroyed.

---

## Vanilla router

The framework-agnostic router can be used directly:

```ts
import {
  createRouter,
} from './vanilla-router';

const router =
  createRouter({
    outlet:
      document.getElementById(
        'app',
      ),

    routes: [
      {
        path: '/',

        load: async () => ({
          component: () => {
            const heading =
              document.createElement(
                'h1',
              );

            heading.textContent =
              'Home';

            return heading;
          },
        }),
      },
    ],

    preloading: 'idle',

    scrollRestoration:
      'restore',
  });

router.start();
```

Navigate:

```ts
await router.navigate(
  '/settings',
);

await router.replace(
  '/sign-in',
);

router.back();
router.forward();
```

Create an href or anchor:

```ts
router.href('/settings');

const link =
  router.createLink(
    '/settings',
    'Settings',
  );
```

Dispose:

```ts
router.dispose();
```

The vanilla router knows nothing about Angular components or Angular dependency injection. Its route component contract returns a DOM node or a rendered-node descriptor:

```ts
interface RenderedRouteNode {
  readonly node:
    Node;

  readonly component?:
    unknown;

  readonly dispose?:
    () => void;
}
```

---

## Error handling

The vanilla router renders default pages for:

- unmatched routes;
- route loading or rendering failures.

Custom handlers may be supplied to `createRouter()`:

```ts
createRouter({
  routes,
  outlet,

  renderNotFound(
    outlet,
    url,
  ) {
    outlet.textContent =
      `Not found: ${url.pathname}`;
  },

  renderError(
    outlet,
    error,
  ) {
    outlet.textContent =
      error instanceof Error
        ? error.message
        : 'Navigation failed';
  },
});
```

The current error is also available through:

```ts
router.state.error;
```

---

## Route validation

The route compiler rejects:

- duplicate compiled paths;
- conflicting parameterized patterns;
- duplicate route names.

These declarations conflict:

```ts
route(
  'users/:id',
  UserPage,
);

route(
  'users/:name',
  UserByNamePage,
);
```

Both normalize to the same matching pattern:

```text
/users/:
```

Route names must be globally unique across every layout branch.

---

## Recommended file responsibilities

```text
adapter-utils.ts
  Angular injection helpers and lazy default unwrapping

route-adapter.ts
  Angular component input binding

route-builders.ts
  Typed route/layout declaration helpers

route-compiler.ts
  Layout flattening, path joining, redirects, registry validation

route-renderer.ts
  Angular components, nested outlets, hierarchical injectors, disposal

router-events.ts
  Outlet and location DOM events

router-url.ts
  Base-href and URL normalization

search-schema.ts
  Parameter/search parsing, inference, and serialization

streamix-router.ts
  Angular-facing router service and provider

vanilla-router.ts
  Framework-independent navigation engine
```

---

## Complete example

```ts
import {
  Component,
  inject,
  input,
} from '@angular/core';

import {
  BeforeEnter,
  RouteLoader,
  StreamixRouter,
  layout,
  lazyRoute,
  provideStreamixRouter,
  route,
  s,
} from './streamix-router';

@Component({
  standalone: true,
  template: `
    <nav>
      Streamix
    </nav>

    <main data-router-outlet></main>
  `,
})
class AppLayout {}

@Component({
  standalone: true,
  template: `
    <aside>
      Admin
    </aside>

    <section data-router-outlet></section>
  `,
})
class AdminLayout {}

@Component({
  standalone: true,
  template: `
    <h1>
      User {{ id() }}
    </h1>

    <p>
      Tab: {{ tab() }}
    </p>
  `,
})
class UserPage {
  readonly id =
    input.required<number>();

  readonly tab =
    input('profile');
}

const requireAdmin:
  BeforeEnter =
  () => {
    const session =
      inject(Session);

    return session.admin
      ? true
      : '/sign-in';
  };

const loadUser:
  RouteLoader =
  async context => {
    const api =
      inject(UserApi);

    return api.getUser(
      Number(
        context.params['id'],
      ),
      context.signal,
    );
  };

export const routes = [
  layout(
    '',
    AppLayout,
    [
      layout(
        'admin',
        AdminLayout,
        [
          lazyRoute(
            'users/:id',
            () =>
              import('./user.page')
                .then(module =>
                  module.UserPage
                ),
            {
              name: 'adminUser',

              paramsSchema: {
                id:
                  s.number({
                    min: 1,
                  }),
              },

              searchSchema: {
                tab:
                  s.string(
                    'profile',
                  ),

                expanded:
                  s.optional(
                    s.boolean(),
                  ),
              },

              beforeEnter: [
                requireAdmin,
              ],

              resolve: {
                user:
                  loadUser,
              },

              providers: [
                UserStore,
              ],
            },
          ),
        ] as const,
        {
          providers: [
            AdminSession,
          ],
        },
      ),
    ] as const,
  ),
] as const;

export const providers = [
  provideStreamixRouter(
    routes,
    {
      preloading: 'idle',

      scrollRestoration:
        'restore',

      viewTransitions: true,
    },
  ),
];

export async function openUser(
  router:
    StreamixRouter<
      typeof routes
    >,
): Promise<boolean> {
  return router
    .navigateTo
    .adminUser({
      params: {
        id: 42,
      },

      search: {
        tab: 'permissions',
        expanded: true,
      },
    });
}
```

---

## Design principle

> Routes are compiled once. Navigation operates on compiled leaf routes.

Layouts describe rendering and provider hierarchy. The vanilla router receives a flat list of concrete URLs, keeping recognition, loading, and navigation predictable.
