console.log(
  'LOADED STREAMIX ROUTER: route-module API 2026-07-25',
);

import { APP_BASE_HREF } from '@angular/common';
import {
  ApplicationRef,
  DestroyRef,
  EnvironmentInjector,
  EnvironmentProviders,
  Injectable,
  InjectionToken,
  Injector,
  Type,
  createComponent,
  createEnvironmentInjector,
  inject,
  makeEnvironmentProviders
} from '@angular/core';

import {
  ModuleRegistry,
  runWithInjector,
  unwrapDefault
} from './adapter-utils';
import { NamedNavigationTarget, NavigationTarget } from './navigation-types';
import { adaptRouteComponent, bindRouteInputs } from './route-adapter';
import {
  BeforeEnter,
  BeforeLeave,
  MaybePromise,
  RouteLoader,
  StreamixRoute,
  StreamixRouteModule,
  StreamixRouteProviders,
  StreamixRoutes
} from './route-types';
import {
  OUTLET_ACTIVATE_EVENT,
  OUTLET_ATTRIBUTE,
  OUTLET_DEACTIVATE_EVENT,
  dispatchOutletLifecycleEvent,
} from './router-events';
import { resolveRouterUrl, routerHref } from './router-url';
import {
  parseParamsRecord,
  parseSearchRecord,
  type ParamSchema,
  type SearchSchema,
} from './search-schema';
import {
  createRouter,
  type ActivatedRoute,
  type NavigationContext,
  type NavigationOptions,
  type PreloadingStrategy,
  type Route,
  type RouteComponent,
  type RouteRenderContext,
  type Router,
  type RouterState,
  type ScrollRestorationMode,
  type ViewTransitionsOption
} from './vanilla-router';

// --- Type-safe proxy types ---

type TypedNavigate<TRoutes extends StreamixRoutes> = {
  [K in TRoutes[number]['name'] & string]: (options?: { params?: any, search?: any }) => Promise<boolean>;
};

type TypedHref<TRoutes extends StreamixRoutes> = {
  [K in TRoutes[number]['name'] & string]: (options?: { params?: any, search?: any }) => string | null;
};

export interface StreamixRouterOptions {
  readonly baseHref?: string;
  readonly enableTracing?: boolean;
  readonly maxRedirects?: number;
  readonly onSameUrlNavigation?: 'ignore';
  readonly scrollRestoration?: ScrollRestorationMode;
  readonly preloading?: PreloadingStrategy;
  readonly viewTransitions?: ViewTransitionsOption;
}

export const STREAMIX_ROUTE =
  new InjectionToken<ActivatedRoute>('STREAMIX_ROUTE');

export const STREAMIX_ROUTE_CONTEXT =
  new InjectionToken<RouteRenderContext>('STREAMIX_ROUTE_CONTEXT');

interface RouterConfiguration extends StreamixRouterOptions {
  readonly routes: StreamixRoutes;
}

interface AdapterContext {
  readonly injector: EnvironmentInjector;
  readonly render: RenderComponent;
}

type RenderComponent = (
  component: Type<unknown>,
  injector: EnvironmentInjector,
  routeProviders?: StreamixRouteProviders,
) => RouteComponent;

const ROUTER_CONFIGURATION =
  new InjectionToken<RouterConfiguration>('STREAMIX_ROUTER_CONFIGURATION');

function execute<TContext, TResult>(
  injector: EnvironmentInjector,
  handler: (context: TContext) => MaybePromise<TResult>,
  context: TContext,
): Promise<TResult> {
  return runWithInjector(injector, handler, context);
}

function createAngularRenderer(appRef: ApplicationRef): RenderComponent {
  return (component, environmentInjector, routeProviders) =>
    (route, context) => {
      const host = document.createElement('streamix-view');
      const scopedInjector =
        routeProviders && routeProviders.length > 0
          ? createEnvironmentInjector(
              Array.from(routeProviders),
              environmentInjector,
              `StreamixRoute(${route.path})`,
            )
          : null;
      const activeEnvironmentInjector = scopedInjector ?? environmentInjector;
      const elementInjector = Injector.create({
        parent: activeEnvironmentInjector,
        providers: [
          { provide: STREAMIX_ROUTE, useValue: route },
          { provide: STREAMIX_ROUTE_CONTEXT, useValue: context },
        ],
      });

      const ref = createComponent(component, {
        hostElement: host,
        elementInjector,
        environmentInjector: activeEnvironmentInjector,
      });

      let attached = false;
      let disposed = false;

      try {
        bindRouteInputs(ref, component, route);
        appRef.attachView(ref.hostView);
        attached = true;
        ref.changeDetectorRef.detectChanges();
      } catch (error) {
        if (attached) {
          try {
            appRef.detachView(ref.hostView);
          } catch {}
        }
        ref.destroy();
        scopedInjector?.destroy();
        throw error;
      }

      return {
        node: host,
        component: ref.instance,

        dispose(): void {
          if (disposed) return;
          disposed = true;

          host.parentElement
            ?.closest<HTMLElement>(`[${OUTLET_ATTRIBUTE}]`)
            ?.dispatchEvent(new CustomEvent(OUTLET_DEACTIVATE_EVENT, { detail: ref.instance }));

          try {
            if (attached) {
              appRef.detachView(ref.hostView);
              attached = false;
            }
          } finally {
            try {
              ref.destroy();
            } finally {
              scopedInjector?.destroy();
              host.remove();
            }
          }
        },
      };
    };
}

function adaptRoutes(
  routes: StreamixRoutes,
  context: AdapterContext,
): Route[] {
  return routes.map((route) => adaptRoute(route, context));
}

function adaptRoute(route: StreamixRoute, context: AdapterContext): Route {
  return {
    name: route.name,
    path: route.path,
    redirectTo: route.redirectTo,
    data: route.data,
    preload: route.preload,
    viewTransition: route.viewTransition,
    load: async () => {
      const [component, children] = await Promise.all([
        route.loadComponent ? Promise.resolve(route.loadComponent()).then(unwrapDefault) : Promise.resolve(route.component),
        route.loadChildren ? Promise.resolve(route.loadChildren()).then(unwrapDefault) : Promise.resolve(route.children),
      ]);
      
      return {
        component: component
          ? adaptRouteComponent(component, context, route.providers)
          : undefined,
        routes: children ? adaptRoutes(children, context) : undefined,
        canActivate: adaptBeforeEnter(route.beforeEnter, context.injector),
        canDeactivate: adaptBeforeLeave(route.beforeLeave, context.injector),
        resolve: adaptLoaders(
          route.resolve,
          route.paramsSchema,
          route.searchSchema,
          context.injector,
        ),
      };
    },
  };
}

function adaptBeforeEnter(
  handlers: readonly BeforeEnter[] | undefined,
  injector: EnvironmentInjector,
): Route['canActivate'] {
  return handlers?.map(
    (handler) => async (context) => {
      const value = await execute(injector, handler, context);
      if (value instanceof URL) return value.href;
      if (value && typeof value === 'object' && 'redirectTo' in value) {
        return {
          ...value,
          redirectTo:
            value.redirectTo instanceof URL
              ? value.redirectTo.href
              : value.redirectTo,
        };
      }
      return value;
    },
  );
}

function adaptBeforeLeave(
  handlers: readonly BeforeLeave[] | undefined,
  injector: EnvironmentInjector,
): Route['canDeactivate'] {
  return handlers?.map(
    (handler) => async (context) => {
      const value = await execute(injector, handler, context);
      if (value instanceof URL) return value.href;
      if (value && typeof value === 'object' && 'redirectTo' in value) {
        return {
          ...value,
          redirectTo:
            value.redirectTo instanceof URL
              ? value.redirectTo.href
              : value.redirectTo,
        };
      }
      return value;
    },
  );
}

function createSearchResolver(
  schema: Record<string, SearchSchema<unknown>>,
): RouteLoader {
  return (context: NavigationContext) => parseSearchRecord(schema, context.url);
}

function createParamsResolver(
  schema: Record<string, ParamSchema<unknown>>,
): RouteLoader {
  return (context: NavigationContext) => parseParamsRecord(schema, context.params);
}

function adaptLoaders(
  loaders: StreamixRouteModule['resolve'] | undefined,
  paramsSchema: StreamixRoute['paramsSchema'],
  searchSchema: StreamixRoute['searchSchema'],
  injector: EnvironmentInjector,
): Route['resolve'] {
  if (!loaders && !paramsSchema && !searchSchema) return undefined;

  const adaptedLoaders = loaders
    ? Object.fromEntries(
        Object.entries(loaders).map(([key, loader]) => [
          key,
          (context: NavigationContext) => execute(injector, loader, context),
        ]),
      )
    : {};

  if (paramsSchema) {
    adaptedLoaders['__params'] = (context: NavigationContext) => execute(injector, createParamsResolver(paramsSchema), context);
  }
  if (searchSchema) {
    adaptedLoaders['__search'] = (context: NavigationContext) => execute(injector, createSearchResolver(searchSchema), context);
  }

  return adaptedLoaders;
}


const EMPTY_ROUTER_STATE: RouterState = Object.freeze({
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

function snapshotRouterState(state: RouterState): RouterState {
  return Object.freeze({
    current: state.current,
    pending: state.pending,
    phase: state.phase,
    error: state.error,
    path: state.path,
    params: state.params,
    query: state.query,
    data: state.data,
    historyState: state.historyState,
    routeConfig: state.routeConfig,
  });
}

@Injectable()
export class StreamixRouter<TRoutes extends StreamixRoutes = StreamixRoutes> {
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly configuration = inject(ROUTER_CONFIGURATION);
  private readonly appBaseHref =
    inject(APP_BASE_HREF, { optional: true }) ?? '/';

  private engine: Router | null = null;
  private currentState: RouterState = EMPTY_ROUTER_STATE;
  private outlet: HTMLElement | null = null;
  private modules = new ModuleRegistry();
  private readonly namedRouteMap = new Map<string, { route: StreamixRoute; fullPath: string }>();

  public readonly navigateTo: TypedNavigate<TRoutes>;
  public readonly hrefTo: TypedHref<TRoutes>;

  constructor() {
    this.destroyRef.onDestroy(() => this.dispose());
    this.collectAndValidateRoutes(this.configuration.routes);
    
    this.navigateTo = this.createNavigateToProxy();
    this.hrefTo = this.createHrefToProxy();
  }

  get active(): boolean {
    return this.engine !== null;
  }

  get state(): RouterState {
    return this.currentState;
  }

  get url(): string {
    const current = this.currentState.current;
    return current
      ? `${current.url.pathname}${current.url.search}${current.url.hash}`
      : '';
  }

  connect(outlet: HTMLElement): void {
    if (this.outlet === outlet) return;
    if (this.outlet) {
      throw new Error(
        'StreamixRouter is already connected to another root outlet.',
      );
    }

    const context: AdapterContext = {
      injector: this.injector,
      render: createAngularRenderer(this.appRef),
    };

    const engine = createRouter({
      routes: adaptRoutes(this.configuration.routes, context),
      outlet,
      baseHref: this.baseHref,
      enableTracing: this.configuration.enableTracing,
      maxRedirects: this.configuration.maxRedirects,
      onSameUrlNavigation: this.configuration.onSameUrlNavigation,
      scrollRestoration: this.configuration.scrollRestoration,
      preloading: this.configuration.preloading,
      viewTransitions: this.configuration.viewTransitions,
      onStateChange: (state) => {
        this.currentState = snapshotRouterState(state);
      },
      onOutletActivate: (target, component) => {
        dispatchOutletLifecycleEvent(target, OUTLET_ACTIVATE_EVENT, component);
      },
    });

    try {
      engine.start();
    } catch (error) {
      try {
        engine.dispose();
      } finally {
        // If modules were used for something, they would be disposed here.
      }
      throw error;
    }

    this.modules.dispose();
    this.outlet = outlet;
    this.engine = engine;
    this.currentState = snapshotRouterState(engine.state);
  }

  disconnect(outlet: HTMLElement): void {
    if (this.outlet === outlet) {
      this.dispose();
    }
  }

  navigate(
    target: NavigationTarget,
    options?: NavigationOptions,
  ): Promise<boolean> {
    const url = this.href(target);
    if (url === null) {
      console.error('[Router] Navigation failed: could not generate a URL for the target.', target);
      return Promise.resolve(false);
    }

    return this.requireEngine().navigate(url, options);
  }

  updateHistoryState(state: unknown): void {
    this.requireEngine().updateHistoryState(state);
  }

  preload(): Promise<void> {
    return this.requireEngine().preload();
  }

  href(target: NavigationTarget | null | undefined): string | null {
    if (target === null || target === undefined) {
      return null;
    }

    if (typeof target === 'string') {
      return routerHref(resolveRouterUrl(target, this.baseHref, window.location, 'href'));
    }
    if (target instanceof URL) {
      return routerHref(resolveRouterUrl(target, this.baseHref, window.location, 'href'));
    }

    // Handle PathNavigationTarget
    if ('path' in target) {
      const pathTarget = target.path instanceof URL ? target.path.href : target.path;
      return routerHref(resolveRouterUrl(pathTarget, this.baseHref, window.location, 'href'));
    }

    // Handle NamedNavigationTarget
    if ('name' in target) {
      return this.generateUrlFromNamedRoute(target);
    }

    return null;
  }

  dispose(): void {
    const engine = this.engine;
    const modules = this.modules;

    this.engine = null;
    this.currentState = EMPTY_ROUTER_STATE;
    this.outlet = null;
    this.modules = new ModuleRegistry();

    try {
      engine?.dispose();
    } finally {
      modules.dispose((error) =>
        console.error('[StreamixRouter] Module cleanup failed', error),
      );
    }
  }

  private get baseHref(): string {
    return this.configuration.baseHref ?? this.appBaseHref;
  }

  private requireEngine(): Router {
    const engine = this.engine;
    if (!engine) {
      throw new Error('StreamixRouter has no active outlet.');
    }
    return engine;
  }

  private createNavigateToProxy(): TypedNavigate<TRoutes> {
    return new Proxy({} as any, {
      get: (_target, prop: string) => {
        return (options: { params?: any, search?: any } = {}) => {
          return this.navigate({ name: prop, ...options });
        };
      },
    });
  }

  private createHrefToProxy(): TypedHref<TRoutes> {
    return new Proxy({} as any, {
      get: (_target, prop: string) => {
        return (options: { params?: any, search?: any } = {}) => {
          return this.href({ name: prop, ...options });
        };
      },
    });
  }

  private generateUrlFromNamedRoute(target: NamedNavigationTarget): string | null {
    const record = this.namedRouteMap.get(target.name);
    if (!record) {
      console.error(`[StreamixRouter] Route with name "${target.name}" not found.`);
      return null;
    }

    let path = record.fullPath;
    const params = target.params ?? {};

    for (const key in params) {
      if (Object.prototype.hasOwnProperty.call(params, key)) {
        const value = String((params as any)[key]);
        path = path.replace(`:${key}`, encodeURIComponent(value));
      }
    }

    if (target.search) {
      const search = new URLSearchParams(target.search as Record<string, string>).toString();
      if (search) {
        path += `?${search}`;
      }
    }

    return routerHref(resolveRouterUrl(path, this.baseHref, window.location, 'href'));
  }

  private collectAndValidateRoutes(routes: StreamixRoutes, prefix = '') {
    for (const route of routes) {
      const fullPath = [prefix, route.path].filter(Boolean).join('/');

      if (route.name) {
        if (this.namedRouteMap.has(route.name)) {
          throw new Error(
            `Duplicate route name "${route.name}". Route names must be globally unique.`
          );
        }
        this.namedRouteMap.set(route.name, { route, fullPath });
      }

      if (route.children) {
        this.collectAndValidateRoutes(route.children, fullPath);
      }

    }
  }
}

export function provideStreamixRouter(
  routes: StreamixRoutes,
  options: StreamixRouterOptions = {},
): EnvironmentProviders {
  return makeEnvironmentProviders([
    StreamixRouter,
    {
      provide: ROUTER_CONFIGURATION,
      useValue: {
        ...options,
        routes,
      } satisfies RouterConfiguration,
    },
  ]);
}
