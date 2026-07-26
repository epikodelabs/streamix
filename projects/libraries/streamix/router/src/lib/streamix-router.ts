import {
  APP_BASE_HREF,
} from '@angular/common';

import {
  ApplicationRef,
  DestroyRef,
  EnvironmentInjector,
  EnvironmentProviders,
  InjectionToken,
  Provider,
  inject,
  makeEnvironmentProviders,
  type Type,
} from '@angular/core';

import {
  runWithInjector,
  unwrapDefault,
} from './adapter-utils';

import type {
  NamedNavigationTarget,
  NavigationTarget,
} from './navigation-types';

import {
  compileRoutes,
  createRouteRegistry,
} from './route-compiler';

import {
  composeAngularRouteView,
  type ResolvedRouteView,
} from './route-renderer';

import type {
  BeforeEnter,
  BeforeLeave,
  MaybePromise,
  RouteLoader,
  StreamixLayout,
  StreamixLayoutOptions,
  StreamixRoute,
  StreamixRouteOptions,
  StreamixRoutes
} from './route-types';

import type {
  TypedHref,
  TypedNavigate,
} from './typed-routes';

import {
  OUTLET_ACTIVATE_EVENT,
  dispatchOutletLifecycleEvent,
} from './router-events';

import {
  resolveRouterUrl,
  routerHref,
} from './router-url';

import {
  parseParamsRecord,
  parseSearchRecord,
  serializeParams,
  serializeSearch,
  type ParamSchema,
  type SearchSchema
} from './search-schema';

import {
  createRouter,
  type ActivatedRoute,
  type NavigationContext,
  type NavigationOptions,
  type PreloadingStrategy,
  type Route,
  type RouteRenderContext,
  type Router,
  type RouterState,
  type ScrollRestorationMode,
  type ViewTransitionsOption,
} from './vanilla-router';

export interface StreamixRouterOptions {
  readonly baseHref?: string;
  readonly enableTracing?: boolean;
  readonly maxRedirects?: number;
  readonly onSameUrlNavigation?:
    'ignore';
  readonly scrollRestoration?:
    ScrollRestorationMode;
  readonly preloading?:
    PreloadingStrategy;
  readonly viewTransitions?:
    ViewTransitionsOption;
}

export const STREAMIX_ROUTE =
  new InjectionToken<ActivatedRoute>(
    'STREAMIX_ROUTE',
  );

export const STREAMIX_ROUTE_CONTEXT =
  new InjectionToken<RouteRenderContext>(
    'STREAMIX_ROUTE_CONTEXT',
  );

interface RouterConfiguration<
  TRoutes extends StreamixRoutes =
    StreamixRoutes,
> extends StreamixRouterOptions {
  readonly routes: TRoutes;
}

const ROUTER_CONFIGURATION =
  new InjectionToken<
    RouterConfiguration
  >(
    'STREAMIX_ROUTER_CONFIGURATION',
  );

const EMPTY_ROUTER_STATE:
  RouterState = Object.freeze({
    current: null,
    pending: false,
    phase: null,
    error: null,
    path: '',
    params: Object.freeze({}),
    query: Object.freeze({}),
    data: Object.freeze({}),
    historyState: null,
    routeConfig: null,
  });

const lazyComponents =
  new WeakMap<
    object,
    Promise<Type<unknown>>
  >();

function loadComponent(
  owner: {
    readonly component?:
      Type<unknown>;
    readonly loadComponent?:
      () => unknown;
  },
): Promise<Type<unknown>> {
  if (owner.component) {
    return Promise.resolve(
      owner.component,
    );
  }

  if (!owner.loadComponent) {
    return Promise.reject(
      new Error(
        'A route view must define component or loadComponent.',
      ),
    );
  }

  let pending =
    lazyComponents.get(owner);

  if (!pending) {
    pending =
      Promise.resolve(
        owner.loadComponent(),
      )
        .then(value =>
          unwrapDefault<Type<unknown>>(
            value as
              | Type<unknown>
              | { readonly default: Type<unknown> },
          ),
        )
        .then(component => {
          if (!component) {
            throw new Error(
              'Lazy component loader returned no component.',
            );
          }

          return component;
        })
        .catch(error => {
          lazyComponents.delete(
            owner,
          );

          throw error;
        });

    lazyComponents.set(
      owner,
      pending,
    );
  }

  return pending;
}

function snapshotRouterState(
  state: RouterState,
): RouterState {
  return Object.freeze({
    current: state.current,
    pending: state.pending,
    phase: state.phase,
    error: state.error,
    path: state.path,
    params: state.params,
    query: state.query,
    data: state.data,
    historyState:
      state.historyState,
    routeConfig:
      state.routeConfig,
  });
}

function execute<
  TContext,
  TResult,
>(
  injector:
    EnvironmentInjector,
  handler: (
    context: TContext,
  ) => MaybePromise<TResult>,
  context: TContext,
): Promise<TResult> {
  return runWithInjector(
    injector,
    handler,
    context,
  );
}

function adaptBeforeEnter(
  handlers:
    readonly BeforeEnter[] |
    undefined,
  injector:
    EnvironmentInjector,
): Route['canActivate'] {
  return handlers?.map(
    handler =>
      async context => {
        const value =
          await execute(
            injector,
            handler,
            context,
          );

        if (value instanceof URL) {
          return value.href;
        }

        if (
          value &&
          typeof value ===
            'object' &&
          'redirectTo' in value
        ) {
          return {
            ...value,
            redirectTo:
              value.redirectTo
                instanceof URL
                ? value.redirectTo
                    .href
                : value.redirectTo,
          };
        }

        return value as
          | boolean
          | string;
      },
  );
}

function adaptBeforeLeave(
  handlers:
    readonly BeforeLeave[] |
    undefined,
  injector:
    EnvironmentInjector,
): Route['canDeactivate'] {
  return handlers?.map(
    handler =>
      async context => {
        const value =
          await execute(
            injector,
            handler,
            context,
          );

        if (value instanceof URL) {
          return value.href;
        }

        if (
          value &&
          typeof value ===
            'object' &&
          'redirectTo' in value
        ) {
          return {
            ...value,
            redirectTo:
              value.redirectTo
                instanceof URL
                ? value.redirectTo
                    .href
                : value.redirectTo,
          };
        }

        return value as
          | boolean
          | string;
      },
  );
}

function createSearchResolver(
  schema:
    Record<
      string,
      SearchSchema<unknown>
    >,
): RouteLoader {
  return context =>
    parseSearchRecord(
      schema,
      context.url,
    );
}

function createParamsResolver(
  schema:
    Record<
      string,
      ParamSchema<unknown>
    >,
): RouteLoader {
  return context =>
    parseParamsRecord(
      schema,
      context.params,
    );
}

function adaptLoaders(
  route: StreamixRoute,
  injector:
    EnvironmentInjector,
): Route['resolve'] {
  const {
    resolve,
    paramsSchema,
    searchSchema,
  } = route;

  if (
    !resolve &&
    !paramsSchema &&
    !searchSchema
  ) {
    return undefined;
  }

  const adapted:
    Record<
      string,
      (
        context:
          NavigationContext,
      ) => Promise<unknown>
    > = {};

  for (
    const [key, loader]
    of Object.entries(
      resolve ?? {},
    )
  ) {
    adapted[key] =
      context =>
        execute(
          injector,
          loader,
          context,
        );
  }

  if (paramsSchema) {
    const resolver =
      createParamsResolver(
        paramsSchema,
      );

    adapted['__params'] =
      context =>
        execute(
          injector,
          resolver,
          context,
        );
  }

  if (searchSchema) {
    const resolver =
      createSearchResolver(
        searchSchema,
      );

    adapted['__search'] =
      context =>
        execute(
          injector,
          resolver,
          context,
        );
  }

  return adapted;
}

async function resolveViews(
  layouts:
    readonly StreamixLayout[],
  route:
    StreamixRoute,
): Promise<
  readonly ResolvedRouteView[]
> {
  const resolvedLayouts =
    await Promise.all(
      layouts.map(
        async (
          layout,
          index,
        ) => ({
          component:
            await loadComponent(
              layout,
            ),
          providers:
            layout.providers,
          label:
            `StreamixLayout(` +
            `${layout.path || index}` +
            `)`,
        }),
      ),
    );

  const page =
    await loadComponent(route);

  return Object.freeze([
    ...resolvedLayouts,
    {
      component: page,
      providers:
        route.providers,
      label:
        `StreamixRoute(` +
        `${route.path}` +
        `)`,
    },
  ]);
}

function adaptRoutes(
  entries: StreamixRoutes,
  appRef: ApplicationRef,
  injector:
    EnvironmentInjector,
): Route[] {
  return compileRoutes(entries)
    .map(
      ({
        route,
        path,
        redirectTo,
        layouts,
      }) => ({
        name: route.name,
        path,
        redirectTo,
        data: route.data,
        preload:
          route.preload,
        viewTransition:
          route.viewTransition,

        load: async () => {
          if (redirectTo) {
            return {};
          }

          const views =
            await resolveViews(
              layouts,
              route,
            );

          return {
            component:
              composeAngularRouteView(
                appRef,
                injector,
                {
                  routeToken:
                    STREAMIX_ROUTE,
                  contextToken:
                    STREAMIX_ROUTE_CONTEXT,
                },
                views,
              ),

            canActivate:
              adaptBeforeEnter(
                route.beforeEnter,
                injector,
              ),

            canDeactivate:
              adaptBeforeLeave(
                route.beforeLeave,
                injector,
              ),

            resolve:
              adaptLoaders(
                route,
                injector,
              ),
          };
        },
      }),
    );
}

function interpolateNamedPath(
  template: string,
  params:
    Readonly<
      Record<
        string,
        unknown
      >
    >,
  schema:
    StreamixRoute[
      'paramsSchema'
    ],
): string | null {
  const serialized =
    schema
      ? serializeParams(
          schema,
          params as Record<string, any>,
        )
      : Object.fromEntries(
          Object.entries(params)
            .filter(
              ([, value]) =>
                value !==
                  undefined &&
                value !== null,
            )
            .map(
              ([key, value]) => [
                key,
                String(value),
              ],
            ),
        );

  const missing =
    new Set<string>();

  const path =
    template.replace(
      /:([A-Za-z_][A-Za-z0-9_]*)/g,
      (
        _match,
        key: string,
      ) => {
        const value =
          serialized[key];

        if (
          value === undefined
        ) {
          missing.add(key);
          return `:${key}`;
        }

        return encodeURIComponent(
          value,
        );
      },
    );

  if (missing.size > 0) {
    return null;
  }

  return path;
}

export class StreamixRouter<
  TRoutes extends StreamixRoutes =
    any,
> {
  private readonly appRef: ApplicationRef;
  private readonly injector: EnvironmentInjector;
  private readonly destroyRef: DestroyRef;
  private readonly appBaseHref: string;
  private readonly registry: ReturnType<typeof createRouteRegistry>;
  private engine: Router | null = null;
  private currentState: RouterState = EMPTY_ROUTER_STATE;
  private outlet: HTMLElement | null = null;

  public readonly navigateTo: TypedNavigate<TRoutes>;
  public readonly hrefTo: TypedHref<TRoutes>;

  constructor(
    private readonly configuration: RouterConfiguration<TRoutes>,
  ) {
    this.appRef = inject(ApplicationRef);
    this.injector = inject(EnvironmentInjector);
    this.destroyRef = inject(DestroyRef);
    this.appBaseHref =
    inject(
      APP_BASE_HREF,
      {
        optional: true,
      },
    ) ?? '/';

    this.registry = createRouteRegistry(this.configuration.routes);
    this.navigateTo =
      this.createNavigateProxy();

    this.hrefTo =
      this.createHrefProxy();

    this.destroyRef.onDestroy(
      () => this.dispose(),
    );
  }

  get active(): boolean {
    return this.engine !== null;
  }

  get state(): RouterState {
    return this.currentState;
  }

  get url(): string {
    const current =
      this.currentState.current;

    return current
      ? current.url.pathname +
          current.url.search +
          current.url.hash
      : '';
  }

  connect(
    outlet: HTMLElement,
  ): void {
    if (
      this.outlet === outlet
    ) {
      return;
    }

    if (this.outlet) {
      throw new Error(
        'StreamixRouter is already connected to another root outlet.',
      );
    }

    const engine =
      createRouter({
        routes:
          adaptRoutes(
            this.configuration.routes,
            this.appRef,
            this.injector,
          ),

        outlet,
        baseHref:
          this.baseHref,

        enableTracing:
          this.configuration
            .enableTracing,

        maxRedirects:
          this.configuration
            .maxRedirects,

        onSameUrlNavigation:
          this.configuration
            .onSameUrlNavigation,

        scrollRestoration:
          this.configuration
            .scrollRestoration,

        preloading:
          this.configuration
            .preloading,

        viewTransitions:
          this.configuration
            .viewTransitions,

        onStateChange:
          state => {
            this.currentState =
              snapshotRouterState(
                state,
              );
          },

        onOutletActivate:
          (
            target,
            component,
          ) => {
            dispatchOutletLifecycleEvent(
              target,
              OUTLET_ACTIVATE_EVENT,
              component,
            );
          },
      });

    try {
      engine.start();
    } catch (error) {
      engine.dispose();
      throw error;
    }

    this.outlet = outlet;
    this.engine = engine;

    this.currentState =
      snapshotRouterState(
        engine.state,
      );
  }

  disconnect(
    outlet: HTMLElement,
  ): void {
    if (
      this.outlet === outlet
    ) {
      this.dispose();
    }
  }

  navigate(
    target: NavigationTarget,
    options?:
      NavigationOptions,
  ): Promise<boolean> {
    const href =
      this.href(target);

    if (href === null) {
      return Promise.resolve(
        false,
      );
    }

    return this
      .requireEngine()
      .navigate(
        href,
        options,
      );
  }

  href(
    target:
      NavigationTarget |
      null |
      undefined,
  ): string | null {
    if (
      target === null ||
      target === undefined
    ) {
      return null;
    }

    if (
      typeof target ===
      'string' ||
      target instanceof URL
    ) {
      return this.resolveHref(
        target,
      );
    }

    if ('path' in target) {
      return this.resolveHref(
        target.path,
      );
    }

    if ('name' in target) {
      return this
        .generateNamedHref(
          target,
        );
    }

    return null;
  }

  updateHistoryState(
    state: unknown,
  ): void {
    this.requireEngine()
      .updateHistoryState(
        state,
      );
  }

  preload(): Promise<void> {
    return this
      .requireEngine()
      .preload();
  }

  dispose(): void {
    const engine =
      this.engine;

    this.engine = null;
    this.outlet = null;

    engine?.dispose();

    this.currentState =
      EMPTY_ROUTER_STATE;
  }

  private get baseHref():
    string {
    return (
      this.configuration
        .baseHref ??
      this.appBaseHref
    );
  }

  private requireEngine():
    Router {
    if (!this.engine) {
      throw new Error(
        'StreamixRouter has no active outlet.',
      );
    }

    return this.engine;
  }

  private resolveHref(
    target: string | URL,
  ): string {
    return routerHref(
      resolveRouterUrl(
        target,
        this.baseHref,
        window.location,
        'href',
      ),
    );
  }

  private generateNamedHref(
    target:
      NamedNavigationTarget,
  ): string | null {
    const record =
      this.registry.namedRoutes
        .get(target.name);

    if (!record) {
      return null;
    }

    const path =
      interpolateNamedPath(
        record.fullPath,
        target.params ?? {},
        record.route
          .paramsSchema,
      );

    if (!path) {
      return null;
    }

    const search =
      record.route.searchSchema &&
      target.search
        ? serializeSearch(
            record.route
              .searchSchema,
            target.search,
          )
        : '';

    return this.resolveHref(
      `${path}${search}`,
    );
  }

  private createNavigateProxy():
    TypedNavigate<TRoutes> {
    return new Proxy(
      Object.create(null),
      {
        get: (
          _target,
          property,
        ) => {
          if (
            typeof property !==
              'string' ||
            property === 'then'
          ) {
            return undefined;
          }

          return (
            options:
              Record<
                string,
                unknown
              > = {},
          ) =>
            this.navigate({
              name: property,
              ...options,
            } as NamedNavigationTarget);
        },
      },
    ) as TypedNavigate<TRoutes>;
  }

  private createHrefProxy():
    TypedHref<TRoutes> {
    return new Proxy(
      Object.create(null),
      {
        get: (
          _target,
          property,
        ) => {
          if (
            typeof property !==
              'string' ||
            property === 'then'
          ) {
            return undefined;
          }

          return (
            options:
              Record<
                string,
                unknown
              > = {},
          ) =>
            this.href({
              name: property,
              ...options,
            } as NamedNavigationTarget);
        },
      },
    ) as TypedHref<TRoutes>;
  }
}

export function provideStreamixRouter<
  const TRoutes extends
    StreamixRoutes,
>(
  routes: TRoutes,
  options:
    StreamixRouterOptions = {},
): EnvironmentProviders {  
  const config: RouterConfiguration<TRoutes> = { ...options, routes };

  const providers: Provider[] = [
    {
      provide:
        ROUTER_CONFIGURATION,
      useValue:
        config,
    },
    {
      provide:
        StreamixRouter,
      useFactory:
        () =>
          new StreamixRouter<
            TRoutes
          >(
            inject(
              ROUTER_CONFIGURATION,
            ) as RouterConfiguration<TRoutes>,
          ),
    },
  ];

  return makeEnvironmentProviders(providers);
}

export {
  type StreamixLayoutOptions,
  type StreamixRouteOptions
};

  export {
    layout,
    lazyLayout, lazyRoute,
    redirectRoute, route
  } from './route-builders';
  