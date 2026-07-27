import {
  APP_BASE_HREF,
} from '@angular/common';

import {
  ApplicationRef,
  DestroyRef,
  EnvironmentInjector,
  Injectable,
  InjectionToken,
  inject,
  runInInjectionContext,
  type Provider,
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
  parseQueryRecord,
  serializeParams,
  serializeQuery,
  type InferParamType,
  type ParamSchemaRecord
} from './query-schema';

import {
  LoadedRoute,
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

function snapshotRouterState(state: RouterState): RouterState {
  return Object.freeze({
    current: state.current ?? null,
    pending: state.pending ?? false,
    phase: state.phase ?? null,
    error: state.error ?? null,
    path: state.path ?? '',
    params: state.params ? Object.freeze({ ...state.params }) : Object.freeze({}),
    query: state.query ? Object.freeze({ ...state.query }) : Object.freeze({}),
    data: state.data ? Object.freeze({ ...state.data }) : Object.freeze({}),
    historyState: state.historyState ?? null,
    routeConfig: state.routeConfig ?? null,
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

function adaptLoaders(
  route: StreamixRoute,
  injector:
    EnvironmentInjector,
): Route['resolve'] {
  const {
    resolve,
  } = route;

  if (!resolve) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(resolve)
      .map(
        ([key, loader]) => [
          key,
          (
            context:
              NavigationContext,
          ) =>
            execute(
              injector,
              loader,
              context,
            ),
        ],
      ),
  );
}

function adaptParamsParser(
  route: StreamixRoute,
  injector:
    EnvironmentInjector,
): Route['load'] extends
  () => MaybePromise<infer TLoaded>
    ? TLoaded extends {
        parseParams?:
          infer TParser;
      }
      ? TParser
      : never
    : never {
  const schema =
    route.paramsSchema;

  if (!schema) {
    return undefined as never;
  }

  return ((
    params:
      Readonly<
        Record<string, string>
      >,
  ) =>
    runInInjectionContext(
      injector,
      () =>
        Promise.resolve(
          parseParamsRecord(
            schema,
            params,
          ),
        ),
    )) as never;
}

function adaptQueryParser(
  route: StreamixRoute,
  injector:
    EnvironmentInjector,
): Route['load'] extends
  () => MaybePromise<unknown>
    ? LoadedRoute extends {
        parseParams?:
          infer TParser;
      }
      ? TParser
      : never
    : never {
  const schema =
    route.querySchema;

  if (!schema) {
    return undefined as never;
  }

  return ((
    url: URL,
  ) =>
    runInInjectionContext(
      injector,
      () =>
        Promise.resolve(
          parseQueryRecord(
            schema,
            url,
          ),
        ),
    )) as never;
}

async function resolveViews(
  layouts: readonly StreamixLayout[],
  route: StreamixRoute,
): Promise<readonly ResolvedRouteView[]> {
  const resolvedLayouts = await Promise.all(
    layouts.map(async (layout, index) => ({
      component: await loadComponent(layout),
      providers: (layout.providers ?? []).flat().filter(p => p),
      label: `StreamixLayout(${layout.path || index})`,
    })),
  );

  const page = await loadComponent(route);

  return Object.freeze([
    ...resolvedLayouts,
    {
      component: page,
      providers: (route.providers ?? []).flat().filter(p => p),
      label: `StreamixRoute(${route.path})`,
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
        outlet: route.outlet,
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

            parseParams:
              adaptParamsParser(
                route,
                injector,
              ),

            parseQuery:
              adaptQueryParser(
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
          params as unknown as InferParamType<ParamSchemaRecord>,
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
  private outlets = new Map<string, HTMLElement>();

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

  connect(name: string, outlet: HTMLElement): void {
    if (this.outlets.has(name)) {
      this.disconnect(name, this.outlets.get(name)!);
    }

    this.outlets.set(name, outlet);

    if (this.engine) {
      return;
    }

    const engine =
      createRouter({
        routes:
          adaptRoutes(
            this.configuration.routes,
            this.appRef,
            this.injector,
          ),
        render: (outletName, node) => {
          this.outlets.get(outletName)?.replaceChildren(node);
        },
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

    this.engine = engine;

    this.currentState =
      snapshotRouterState(
        engine.state,
      );
  }

  disconnect(name: string, outlet: HTMLElement): void {
    if (this.outlets.get(name) === outlet) {
      this.outlets.delete(name);
    }

    if (this.outlets.size === 0) {
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
    this.outlets.clear();

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

    const query =
      record.route.querySchema &&
      target.query
        ? serializeQuery(
            record.route
              .querySchema,
            target.query,
          )
        : '';

    return this.resolveHref(
      `${path}${query}`,
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

@Injectable()
class StreamixRouterImpl extends StreamixRouter<any> {
  constructor() {
    const config = inject(ROUTER_CONFIGURATION);
    super(config);
  }
}


export function provideStreamixRouter<const TRoutes extends StreamixRoutes>(
  routes: TRoutes,
  options: StreamixRouterOptions = {},
): Provider[] {
  const config: RouterConfiguration<TRoutes> = { ...options, routes };
  return [
    { provide: ROUTER_CONFIGURATION, useValue: config },
    StreamixRouterImpl,
    { provide: StreamixRouter, useExisting: StreamixRouterImpl },
  ];
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
  