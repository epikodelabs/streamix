import { APP_BASE_HREF } from '@angular/common';
import {
  ApplicationRef,
  ChangeDetectorRef,
  DestroyRef,
  Directive,
  ElementRef,
  EnvironmentInjector,
  EnvironmentProviders,
  EventEmitter,
  Injectable,
  InjectionToken,
  Injector,
  Input,
  ModuleWithProviders,
  NgModule,
  Output,
  Provider,
  Type,
  createComponent,
  createEnvironmentInjector,
  createNgModule,
  inject,
  makeEnvironmentProviders,
} from '@angular/core';

import {
  ModuleRegistry,
  runWithInjector,
  unwrapDefault,
  watchRouterLocation,
} from './adapter-utils';
import {
  parseParamsRecord,
  parseSearchRecord,
  type ParamSchema,
  type SearchSchema,
} from './search-schema';
import { resolveRouterUrl, routerHref } from './router-url';
import {
  OUTLET_ACTIVATE_EVENT,
  OUTLET_DEACTIVATE_EVENT,
  dispatchOutletLifecycleEvent,
} from './router-events';
import {
  createTypedRouter,
  type TypedHref,
  type TypedNavigate,
  type TypedNavigateOptions,
  type TypedHrefOptions,
} from './typed-routes';
import {
  type PreloadingStrategy,
  type ScrollRestorationMode,
  type ViewTransitionsOption,
  type ActivatedRoute,
  type DeactivationContext,
  type NavigationContext,
  type NavigationOptions,
  type Route,
  type RouteComponent,
  type RouteRenderContext,
  type Router,
  type RouterState,
  createRouter,
} from './vanilla-router';
import { adaptRouteComponent, bindRouteInputs } from './route-adapter';

export type MaybePromise<T> = T | PromiseLike<T>;
export type Lazy<T> = () => MaybePromise<T | { default: T }>;

export type RouteRedirect = {
  readonly redirectTo: string | URL;
  readonly replace?: boolean;
};

export type BeforeEnter = (
  context: NavigationContext,
) => MaybePromise<boolean | string | URL | RouteRedirect>;

export type BeforeLeave = (
  context: DeactivationContext,
) => MaybePromise<boolean | string | URL | RouteRedirect>;

export type RouteLoader<T = unknown> = (
  context: NavigationContext,
) => MaybePromise<T>;

export type RouteLoaders = Readonly<Record<string, RouteLoader>>;
export type StreamixRouteProviders = readonly (Provider | EnvironmentProviders)[];

export interface StreamixRoute {
  readonly path: string;
  readonly redirectTo?: string;
  readonly component?: Type<unknown>;
  readonly loadComponent?: Lazy<Type<unknown>>;
  readonly children?: StreamixRoutes;
  readonly loadChildren?: Lazy<StreamixRoutes | Type<unknown>>;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly preload?: boolean;
  readonly viewTransition?: boolean;
  readonly paramsSchema?: Record<string, ParamSchema<unknown>>;
  readonly searchSchema?: Record<string, SearchSchema<unknown>>;
  readonly beforeEnter?: readonly BeforeEnter[];
  readonly beforeLeave?: readonly BeforeLeave[];
  readonly load?: RouteLoaders;
  readonly providers?: StreamixRouteProviders;
}

export type StreamixRoutes = readonly StreamixRoute[];

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
  readonly modules: ModuleRegistry;
}

type RenderComponent = (
  component: Type<unknown>,
  injector: EnvironmentInjector,
  routeProviders?: StreamixRouteProviders,
) => RouteComponent;

const ROUTER_CONFIGURATION =
  new InjectionToken<RouterConfiguration>('STREAMIX_ROUTER_CONFIGURATION');

const STREAMIX_MODULE_ROUTES =
  new InjectionToken<readonly StreamixRoutes[]>('STREAMIX_MODULE_ROUTES');

const OUTLET_ATTRIBUTE = 'data-router-outlet';

function isRouteArray(
  value: StreamixRoutes | Type<unknown>,
): value is StreamixRoutes {
  return Array.isArray(value);
}

function execute<TContext, TResult>(
  injector: EnvironmentInjector,
  handler: (context: TContext) => MaybePromise<TResult>,
  context: TContext,
): Promise<TResult> {
  return runWithInjector(injector, handler, context);
}

function emitOutletEvent(
  host: HTMLElement,
  type: typeof OUTLET_ACTIVATE_EVENT | typeof OUTLET_DEACTIVATE_EVENT,
  component: unknown,
): void {
  host.parentElement
    ?.closest<HTMLElement>(`[${OUTLET_ATTRIBUTE}]`)
    ?.dispatchEvent(new CustomEvent(type, { detail: component }));
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

          emitOutletEvent(host, OUTLET_DEACTIVATE_EVENT, ref.instance);

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
    path: route.path,
    redirectTo: route.redirectTo,
    data: route.data,
    preload: route.preload,
    viewTransition: route.viewTransition,
    canActivate: adaptBeforeEnter(route.beforeEnter, context.injector),
    canDeactivate: adaptBeforeLeave(route.beforeLeave, context.injector),
    resolve: adaptLoaders(route, context.injector),
    children: route.children ? adaptRoutes(route.children, context) : undefined,
    loadComponent: adaptRouteComponent(route, context),
    loadChildren: adaptChildren(route.loadChildren, context),
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
  route: Pick<StreamixRoute, 'load' | 'paramsSchema' | 'searchSchema'>,
  injector: EnvironmentInjector,
): Route['resolve'] {
  const loaders = route.load;
  const paramsSchema = route.paramsSchema;
  const searchSchema = route.searchSchema;

  if (!loaders && !paramsSchema && !searchSchema) return undefined;

  const mergedLoaders = {
    ...loaders,
    ...(paramsSchema ? { __params: createParamsResolver(paramsSchema) } : {}),
    ...(searchSchema ? { __search: createSearchResolver(searchSchema) } : {}),
  };

  return Object.fromEntries(
    Object.entries(mergedLoaders).map(([key, loader]) => [
      key,
      (context: NavigationContext) => execute(injector, loader, context),
    ]),
  );
}

function adaptChildren(
  loader: StreamixRoute['loadChildren'],
  context: AdapterContext,
): Route['loadChildren'] {
  if (!loader) return undefined;

  let loaded: Promise<Route[]> | undefined;

  return () => {
    loaded ??= loadChildren(loader, context).catch((error) => {
      loaded = undefined;
      throw error;
    });
    return loaded;
  };
}

async function loadChildren(
  loader: NonNullable<StreamixRoute['loadChildren']>,
  context: AdapterContext,
): Promise<Route[]> {
  const value = unwrapDefault(await loader());

  if (isRouteArray(value)) {
    return adaptRoutes(value, context);
  }

  return loadModuleRoutes(value, context);
}

function loadModuleRoutes(
  moduleType: Type<unknown>,
  parent: AdapterContext,
): Route[] {
  const moduleRef = createNgModule(moduleType, parent.injector);

  try {
    const routeGroups = moduleRef.injector.get(STREAMIX_MODULE_ROUTES, []);
    const routes = routeGroups.flat();

    if (routes.length === 0) {
      throw new Error('Lazy Streamix module has no registered routes.');
    }

    const context: AdapterContext = {
      injector: moduleRef.injector as EnvironmentInjector,
      render: parent.render,
      modules: parent.modules,
    };

    const adapted = adaptRoutes(routes, context);
    parent.modules.add(moduleRef);

    return adapted;
  } catch (error) {
    moduleRef.destroy();
    throw error;
  }
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
  private typedRouter:
    | {
        navigate: (
          path: string,
          paramsOrOptions?:
            | Record<string, string>
            | TypedNavigateOptions<Record<string, unknown>>,
          options?: TypedNavigateOptions<Record<string, unknown>>,
        ) => Promise<boolean>;
        href: (
          path: string,
          paramsOrOptions?:
            | Record<string, string>
            | TypedHrefOptions<Record<string, unknown>>,
          options?: TypedHrefOptions<Record<string, unknown>>,
        ) => string;
      }
    | null = null;
  private outlet: HTMLElement | null = null;
  private modules = new ModuleRegistry();

  constructor() {
    this.destroyRef.onDestroy(() => this.dispose());
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

  get typed(): { navigate: TypedNavigate<TRoutes>; href: TypedHref<TRoutes> } {
    return this.runtimeTyped as {
      navigate: TypedNavigate<TRoutes>;
      href: TypedHref<TRoutes>;
    };
  }

  get typedNavigate(): TypedNavigate<TRoutes> {
    return this.typed.navigate;
  }

  get typedHref(): TypedHref<TRoutes> {
    return this.typed.href;
  }

  get rawNavigate(): (
    target: string | URL,
    options?: NavigationOptions,
  ) => Promise<boolean> {
    return (target, options) => this.requireEngine().navigate(target, options);
  }

  get rawHref(): (target: string | URL) => string {
    return (target) =>
      routerHref(
        resolveRouterUrl(target, this.baseHref, window.location, 'href'),
      );
  }

  connect(outlet: HTMLElement): void {
    if (this.outlet === outlet) return;
    if (this.outlet) {
      throw new Error(
        'StreamixRouter is already connected to another root outlet.',
      );
    }

    const modules = new ModuleRegistry();
    const context: AdapterContext = {
      injector: this.injector,
      render: createAngularRenderer(this.appRef),
      modules,
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
        modules.dispose();
      }
      throw error;
    }

    this.modules.dispose();
    this.modules = modules;
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
    target: string | URL,
    options?: NavigationOptions,
  ): Promise<boolean> {
    return this.requireEngine().navigate(target, options);
  }

  updateHistoryState(state: unknown): void {
    this.requireEngine().updateHistoryState(state);
  }

  preload(): Promise<void> {
    return this.requireEngine().preload();
  }

  href(target: string | URL): string {
    return routerHref(
      resolveRouterUrl(target, this.baseHref, window.location, 'href'),
    );
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

  private get runtimeTyped() {
    if (this.typedRouter) {
      return this.typedRouter;
    }

    this.typedRouter = createTypedRouter(
      this.configuration.routes as TRoutes,
      (target, options) => this.requireEngine().navigate(target, options),
      (target) =>
        routerHref(
          resolveRouterUrl(target, this.baseHref, window.location, 'href'),
        ),
    ) as NonNullable<typeof this.typedRouter>;

    return this.typedRouter;
  }

  private requireEngine(): Router {
    const engine = this.engine;
    if (!engine) {
      throw new Error('StreamixRouter has no active outlet.');
    }
    return engine;
  }
}

@Directive({
  selector: 'streamix-outlet',
  standalone: true,
  host: {
    [`[attr.${OUTLET_ATTRIBUTE}]`]: '""',
  },
})
export class StreamixOutlet {
  private readonly router = inject(StreamixRouter);
  private readonly element = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly destroyRef = inject(DestroyRef);
  private connectedRoot = false;

  @Output() readonly activate = new EventEmitter<unknown>();
  @Output() readonly deactivate = new EventEmitter<unknown>();

  constructor() {
    const onActivate = (event: Event) =>
      this.activate.emit((event as CustomEvent<unknown>).detail);
    const onDeactivate = (event: Event) =>
      this.deactivate.emit((event as CustomEvent<unknown>).detail);

    this.element.addEventListener(OUTLET_ACTIVATE_EVENT, onActivate);
    this.element.addEventListener(OUTLET_DEACTIVATE_EVENT, onDeactivate);
    if (!this.router.active) {
      this.router.connect(this.element);
      this.connectedRoot = true;
    }

    this.destroyRef.onDestroy(() => {
      this.element.removeEventListener(OUTLET_ACTIVATE_EVENT, onActivate);
      this.element.removeEventListener(OUTLET_DEACTIVATE_EVENT, onDeactivate);
      if (this.connectedRoot) {
        this.router.disconnect(this.element);
      }
    });
  }
}

@Directive({
  selector: 'a[streamixLink]',
  standalone: true,
  host: {
    '[attr.href]': 'href',
    '(click)': 'onClick($event)',
  },
})
export class StreamixLink {
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(StreamixRouter);
  private target: string | URL = '';
  href = '';

  constructor() {
    watchRouterLocation(this.destroyRef, () => this.refreshHref());
    this.refreshHref();
  }

  @Input('streamixLink')
  set streamixLink(value: string | URL | null | undefined) {
    this.target = value ?? '';
    this.refreshHref();
  }

  onClick(event: MouseEvent): void {
    const anchor = event.currentTarget as HTMLAnchorElement;

    if (!shouldNavigate(event, anchor)) {
      return;
    }

    event.preventDefault();

    void this.router
      .rawNavigate(this.target)
      .catch(reportNavigationError);
  }

  private refreshHref(): void {
    this.href = this.router.rawHref(this.target);
    this.changeDetectorRef.markForCheck();
  }
}

function shouldNavigate(
  event: MouseEvent,
  anchor: HTMLAnchorElement,
): boolean {
  return !(
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (anchor.target !== '' && anchor.target !== '_self') ||
    anchor.hasAttribute('download') ||
    anchor.relList.contains('external')
  );
}

function reportNavigationError(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}

@NgModule({
  imports: [StreamixOutlet, StreamixLink],
  exports: [StreamixOutlet, StreamixLink],
})
export class StreamixRouterModule {
  static forChild(
    routes: StreamixRoutes,
  ): ModuleWithProviders<StreamixRouterModule> {
    return {
      ngModule: StreamixRouterModule,
      providers: [
        {
          provide: STREAMIX_MODULE_ROUTES,
          useValue: routes,
          multi: true,
        },
      ],
    };
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
