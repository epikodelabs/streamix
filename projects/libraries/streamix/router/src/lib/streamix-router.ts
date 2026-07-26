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
  StreamixLayout,
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

type RouteNames<TEntries extends readonly unknown[]> =
  TEntries[number] extends infer TEntry
    ? TEntry extends { readonly kind: 'route'; readonly name?: infer TName }
      ? Extract<TName, string>
      : TEntry extends { readonly kind: 'layout'; readonly entries: infer TNested extends readonly unknown[] }
        ? RouteNames<TNested>
        : never
    : never;

type TypedNavigate<TRoutes extends StreamixRoutes> = {
  [K in RouteNames<TRoutes>]: (options?: { params?: any, search?: any }) => Promise<boolean>;
};

type TypedHref<TRoutes extends StreamixRoutes> = {
  [K in RouteNames<TRoutes>]: (options?: { params?: any, search?: any }) => string | null;
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

interface CompiledRoute {
  readonly route: StreamixRoute;
  readonly path: string;
  readonly layouts: readonly StreamixLayout[];
}

function joinRoutePath(parent: string, child: string): string {
  const parentSegments = parent.split('/').filter(Boolean);
  const childSegments = child.split('/').filter(Boolean);
  const path = [...parentSegments, ...childSegments].join('/');
  return path ? `/${path}` : '/';
}

function compileRoutes(
  entries: StreamixRoutes,
  parentPath = '/',
  layouts: readonly StreamixLayout[] = [],
  output: CompiledRoute[] = [],
): readonly CompiledRoute[] {
  for (const entry of entries) {
    if (entry.kind === 'layout') {
      compileRoutes(
        entry.entries,
        joinRoutePath(parentPath, entry.path),
        [...layouts, entry],
        output,
      );
    } else {
      output.push({
        route: entry,
        path: joinRoutePath(parentPath, entry.path),
        layouts: Object.freeze([...layouts]),
      });
    }
  }
  return output;
}

function findNestedOutlet(node: Node): HTMLElement | null {
  if (!(node instanceof Element || node instanceof DocumentFragment)) return null;
  if (node instanceof HTMLElement && node.hasAttribute(OUTLET_ATTRIBUTE)) return node;
  return node.querySelector<HTMLElement>(`[${OUTLET_ATTRIBUTE}]`);
}

function composeRouteView(
  page: Type<unknown>,
  layouts: readonly { component: Type<unknown>; providers?: StreamixRouteProviders }[],
  context: AdapterContext,
  pageProviders?: StreamixRouteProviders,
): RouteComponent {
  const renderers = [
    ...layouts.map(item => adaptRouteComponent(item.component, context, item.providers)),
    adaptRouteComponent(page, context, pageProviders),
  ];

  return async (route, renderContext) => {
    const rendered: Array<Awaited<ReturnType<RouteComponent>>> = [];
    const normalized: Array<{ node: Node; component?: unknown; dispose?: () => void }> = [];
    try {
      for (const renderer of renderers) {
        const value = await renderer(route, renderContext);
        const item = value instanceof Node ? { node: value } : value;
        normalized.push(item);
      }
      for (let index = 0; index < normalized.length - 1; index++) {
        const parent = normalized[index];
        const child = normalized[index + 1];
        const outlet = findNestedOutlet(parent.node);
        if (!outlet) {
          throw new Error(`Layout component at index ${index} rendered no <streamix-outlet>.`);
        }
        outlet.replaceChildren(child.node);
        if (child.component !== undefined) {
          dispatchOutletLifecycleEvent(outlet, OUTLET_ACTIVATE_EVENT, child.component);
        }
      }
      const first = normalized[0];
      const last = normalized[normalized.length - 1];
      return {
        node: first.node,
        component: last.component,
        dispose(): void {
          for (let index = normalized.length - 1; index >= 0; index--) {
            normalized[index].dispose?.();
          }
        },
      };
    } catch (error) {
      for (let index = normalized.length - 1; index >= 0; index--) {
        try { normalized[index].dispose?.(); } catch {}
      }
      throw error;
    }
  };
}

async function resolveLayouts(layouts: readonly StreamixLayout[]): Promise<
  readonly { component: Type<unknown>; providers?: StreamixRouteProviders }[]
> {
  return Promise.all(layouts.map(async layout => {
    const component = layout.loadComponent
      ? unwrapDefault(await layout.loadComponent())
      : layout.component;
    if (!component) throw new Error('A layout must define component or loadComponent.');
    return { component, providers: layout.providers };
  }));
}

function adaptRoutes(entries: StreamixRoutes, context: AdapterContext): Route[] {
  return compileRoutes(entries).map(compiled => adaptRoute(compiled, context));
}

function adaptRoute(compiled: CompiledRoute, context: AdapterContext): Route {
  const { route, path, layouts } = compiled;
  return {
    name: route.name,
    path,
    redirectTo: route.redirectTo,
    data: route.data,
    preload: route.preload,
    viewTransition: route.viewTransition,
    load: async () => {
      const [component, resolvedLayouts] = await Promise.all([
        route.loadComponent
          ? Promise.resolve(route.loadComponent()).then(unwrapDefault)
          : Promise.resolve(route.component),
        resolveLayouts(layouts),
      ]);
      return {
        component: component
          ? composeRouteView(component, resolvedLayouts, context, route.providers)
          : undefined,
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
    (handler) => async (context): Promise<import('./vanilla-router').GuardResult> => {
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
      return value as boolean | string;
    },
  );
}

function adaptBeforeLeave(
  handlers: readonly BeforeLeave[] | undefined,
  injector: EnvironmentInjector,
): Route['canDeactivate'] {
  return handlers?.map(
    (handler) => async (context): Promise<import('./vanilla-router').GuardResult> => {
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
      return value as boolean | string;
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
  loaders: StreamixRoute['resolve'] | undefined,
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

  private collectAndValidateRoutes(entries: StreamixRoutes): void {
    for (const { route, path } of compileRoutes(entries)) {
      if (!path.startsWith('/')) {
        throw new Error(`Compiled route path "${path}" must be absolute.`);
      }
      if (!route.name) continue;
      if (this.namedRouteMap.has(route.name)) {
        throw new Error(`Duplicate route name "${route.name}". Route names must be globally unique.`);
      }
      this.namedRouteMap.set(route.name, { route, fullPath: path });
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
