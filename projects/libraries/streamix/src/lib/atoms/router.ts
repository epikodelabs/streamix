import {
    atom,
    flow,
    MaybePromise,
    method,
    scope,
} from '@epikodelabs/streamix';

export type RouteParams = Readonly<Record<string, string>>;
export type QueryParams = Readonly<Record<string, string>>;
export type RouteData = Readonly<Record<string, unknown>>;

export interface ActivatedRoute {
  readonly url: URL;
  readonly path: string;
  readonly params: RouteParams;
  readonly queryParams: QueryParams;
  readonly data: RouteData;
  readonly config: Route;
}

export interface NavigationContext extends ActivatedRoute {
  readonly signal: AbortSignal;
}

export type GuardResult =
  | boolean
  | string
  | URL
  | {
      redirectTo: string;
      replace?: boolean;
    };

export type CanActivate =
  | ((route: NavigationContext) => MaybePromise<GuardResult>)
  | {
      canActivate(route: NavigationContext): MaybePromise<GuardResult>;
    };

export type Resolve<T = unknown> =
  | ((route: NavigationContext) => MaybePromise<T>)
  | {
      resolve(route: NavigationContext): MaybePromise<T>;
    };

export type RouteComponent = (
  route: ActivatedRoute
) => Node | Promise<Node>;

export interface Route {
  path: string;

  loadComponent?: () => MaybePromise<
    RouteComponent | { default: RouteComponent }
  >;

  loadChildren?: () => MaybePromise<
    Route[] | { default: Route[] }
  >;

  redirectTo?: string;
  pathMatch?: 'full' | 'prefix';

  data?: Record<string, unknown>;
  children?: Route[];

  canActivate?: CanActivate[];
  resolve?: Record<string, Resolve>;
}

export type NavigationStatus =
  | 'idle'
  | 'recognizing'
  | 'guarding'
  | 'resolving'
  | 'loading'
  | 'active'
  | 'blocked'
  | 'not-found'
  | 'error';

export interface NavigationOptions {
  replace?: boolean;
  state?: unknown;
}

export interface RouterConfig {
  routes: Route[];

  outlet?: HTMLElement | null;
  baseHref?: string;
  enableTracing?: boolean;
  maxRedirects?: number;

  render?: (
    outlet: HTMLElement,
    component: RouteComponent,
    route: ActivatedRoute
  ) => MaybePromise<void>;

  renderNotFound?: (
    outlet: HTMLElement,
    url: URL
  ) => MaybePromise<void>;

  renderError?: (
    outlet: HTMLElement,
    error: unknown
  ) => MaybePromise<void>;
}

interface NavigationRequest {
  readonly id: number;
  readonly url: URL;
  readonly source: 'start' | 'imperative' | 'popstate';
}

interface RouteMatch {
  readonly route: Route;
  readonly chain: Route[];
  readonly params: Record<string, string>;
}

interface NavigationSuccess {
  readonly type: 'success';
  readonly request: NavigationRequest;
  readonly activatedRoute: ActivatedRoute;
  readonly component: RouteComponent;
}

interface NavigationRedirect {
  readonly type: 'redirect';
  readonly request: NavigationRequest;
  readonly redirectTo: string;
  readonly replace: boolean;
}

interface NavigationBlocked {
  readonly type: 'blocked';
  readonly request: NavigationRequest;
}

interface NavigationNotFound {
  readonly type: 'not-found';
  readonly request: NavigationRequest;
}

type NavigationResult =
  | NavigationSuccess
  | NavigationRedirect
  | NavigationBlocked
  | NavigationNotFound;

function normalizePath(path: string): string {
  const normalized = `/${path}`.replace(/\/+/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function splitPath(path: string): string[] {
  return normalizePath(path).split('/').filter(Boolean);
}

function decodeSegment(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function readQuery(url: URL): QueryParams {
  return Object.freeze(Object.fromEntries(url.searchParams.entries()));
}

function unwrapDefault<T>(value: T | { default: T }): T {
  if (value !== null && typeof value === 'object' && 'default' in value) {
    return (value as { default: T }).default;
  }
  return value as T;
}

function executeGuard(guard: CanActivate, route: NavigationContext): MaybePromise<GuardResult> {
  return typeof guard === 'function' ? guard(route) : guard.canActivate(route);
}

function executeResolver(resolver: Resolve, route: NavigationContext): MaybePromise<unknown> {
  return typeof resolver === 'function' ? resolver(route) : resolver.resolve(route);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Navigation aborted', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function defaultRender(
  outlet: HTMLElement,
  component: RouteComponent,
  route: ActivatedRoute
): Promise<void> {
  const node = await component(route);
  outlet.replaceChildren(node);
}

function defaultRenderNotFound(outlet: HTMLElement, _url: URL): void {
  const heading = document.createElement('h1');
  heading.textContent = '404 — Page Not Found';
  outlet.replaceChildren(heading);
}

function defaultRenderError(outlet: HTMLElement, _error: unknown): void {
  const heading = document.createElement('h1');
  heading.textContent = 'Page failed to load';
  outlet.replaceChildren(heading);
}

async function getChildRoutes(route: Route): Promise<Route[]> {
  if (route.children) return route.children;
  if (!route.loadChildren) return [];
  return unwrapDefault(await route.loadChildren());
}

async function recognizeRoutes(
  routes: Route[],
  segments: string[],
  segmentIndex = 0,
  parentParams: Record<string, string> = {},
  parentChain: Route[] = []
): Promise<RouteMatch | null> {
  let wildcard: Route | undefined;
  for (const route of routes) {
    if (route.path === '*' || route.path === '**') {
      wildcard = route;
      continue;
    }
    const routeSegments = splitPath(route.path);
    const params = { ...parentParams };
    let matches = true;
    for (let index = 0; index < routeSegments.length; index++) {
      const routeSegment = routeSegments[index];
      const pathSegment = segments[segmentIndex + index];
      if (pathSegment === undefined) { matches = false; break; }
      if (routeSegment.startsWith(':')) {
        params[routeSegment.slice(1)] = decodeSegment(pathSegment);
        continue;
      }
      if (routeSegment !== pathSegment) { matches = false; break; }
    }
    if (!matches) continue;
    const nextSegmentIndex = segmentIndex + routeSegments.length;
    const remainingSegments = segments.length - nextSegmentIndex;
    const chain = [...parentChain, route];
    const children = await getChildRoutes(route);
    if (children.length > 0) {
      const childMatch = await recognizeRoutes(children, segments, nextSegmentIndex, params, chain);
      if (childMatch) return childMatch;
    }
    const pathMatch = route.pathMatch ?? 'prefix';
    if (remainingSegments === 0) {
      return { route, chain, params };
    }
    if (pathMatch === 'prefix' && routeSegments.length === 0) {
      return { route, chain, params };
    }
  }
  if (!wildcard) return null;
  return { route: wildcard, chain: [...parentChain, wildcard], params: parentParams };
}

function interpolateRedirect(redirectTo: string, params: RouteParams): string {
  return redirectTo.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => encodeURIComponent(params[key] ?? ''));
}

function readGuardRedirect(result: GuardResult): { redirectTo: string; replace: boolean } | null {
  if (typeof result === 'string') return { redirectTo: result, replace: true };
  if (result instanceof URL) return { redirectTo: result.pathname + result.search + result.hash, replace: true };
  if (result && typeof result === 'object' && 'redirectTo' in result) {
    return { redirectTo: result.redirectTo, replace: result.replace ?? true };
  }
  return null;
}

// ----- Public Router API -----
export interface Router {
  state: any;
  start(): void;
  stop(): void;
  dispose(): void;
  navigate(target: string | URL, options?: NavigationOptions): void;
  replace(target: string | URL, state?: unknown): void;
  back(): void;
  forward(): void;
  href(path: string): string;
  createLink(to: string, text: string, className?: string): HTMLAnchorElement;
}

export function createRouter(config: RouterConfig): Router {
  const outlet = config.outlet ?? document.getElementById('app');
  const render = config.render ?? defaultRender;
  const renderNotFound = config.renderNotFound ?? defaultRenderNotFound;
  const renderError = config.renderError ?? defaultRenderError;
  const baseHref = normalizePath(config.baseHref ?? '/');
  const maxRedirects = config.maxRedirects ?? 10;

  const navigationRequest = atom<NavigationRequest | null>(null);

  let started = false;
  let navigationId = 0;
  let previousUrl = window.location.pathname + window.location.search + window.location.hash;

  function trace(message: string, ...values: unknown[]): void {
    if (config.enableTracing) console.debug(`[Router] ${message}`, ...values);
  }

  function stripBaseHref(pathname: string): string {
    if (baseHref === '/') return normalizePath(pathname);
    if (!pathname.startsWith(baseHref)) return normalizePath(pathname);
    return normalizePath(pathname.slice(baseHref.length));
  }

  function createHref(path: string): string {
    if (baseHref === '/') return normalizePath(path);
    return normalizePath(`${baseHref}/${path}`);
  }

  function requestNavigation(url: URL, source: NavigationRequest['source']): void {
    navigationRequest.set({ id: ++navigationId, url, source });
  }

  // Use a type assertion on the whole scope to avoid complex inference issues
  const router = scope({
    current: null as ActivatedRoute | null,
    pending: null as NavigationRequest | null,
    status: 'idle' as NavigationStatus,
    error: null as unknown,

    path: (self: any) => self.current?.path ?? '',
    params: (self: any) => self.current?.params ?? {},
    query: (self: any) => self.current?.queryParams ?? {},
    data: (self: any) => self.current?.data ?? {},
    routeConfig: (self: any) => self.current?.config ?? null,
    navigating: (self: any) => self.pending !== null,

    navigation: flow(async function* (signal?: AbortSignal) {
      const request = navigationRequest.value;
      if (!request) return;
      router.pending = request;
      router.error = null;
      const result = await performNavigation(request, signal!);
      throwIfAborted(signal!);
      yield result;
    }),

    navigate: method((target: string | URL, options: NavigationOptions = {}) => {
      const url = target instanceof URL ? target : new URL(target, window.location.href);
      if (url.origin !== window.location.origin) {
        window.location.assign(url);
        return;
      }
      previousUrl = window.location.pathname + window.location.search + window.location.hash;
      const href = url.pathname + url.search + url.hash;
      if (options.replace) {
        window.history.replaceState(options.state ?? null, '', href);
      } else {
        window.history.pushState(options.state ?? null, '', href);
      }
      requestNavigation(url, 'imperative');
    }),

    replace: method((target: string | URL, state?: unknown) => {
      router.navigate(target, { replace: true, state });
    }),

    back: method(() => { window.history.back(); }),
    forward: method(() => { window.history.forward(); }),

    start: method(() => {
      if (started) return;
      started = true;
      window.addEventListener('popstate', handlePopState);
      document.addEventListener('click', handleDocumentClick);
      requestNavigation(new URL(window.location.href), 'start');
    }),

    stop: method(() => {
      if (!started) return;
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('click', handleDocumentClick);
      started = false;
      router.pending = null;
    }),

    href: method((path: string) => createHref(path)),

    createLink: method((to: string, text: string, className = ''): HTMLAnchorElement => {
      const link = document.createElement('a');
      link.href = createHref(to);
      link.textContent = text;
      if (className) link.className = className;
      return link;
    }),
  }) as any; // Cast to any to bypass internal type issues

  // ----- Navigation implementation -----
  async function performNavigation(request: NavigationRequest, signal: AbortSignal): Promise<NavigationResult> {
    trace('Navigation started', request.url.href);
    router.status = 'recognizing';
    const path = stripBaseHref(request.url.pathname);
    const match = await recognizeRoutes(config.routes, splitPath(path));
    throwIfAborted(signal);
    if (!match) {
      return { type: 'not-found', request };
    }

    const staticData = Object.assign({}, ...match.chain.map(route => route.data ?? {}));
    const baseRoute: ActivatedRoute = {
      url: request.url,
      path,
      params: Object.freeze({ ...match.params }),
      queryParams: readQuery(request.url),
      data: Object.freeze(staticData),
      config: match.route,
    };
    const context: NavigationContext = { ...baseRoute, signal };

    for (const route of match.chain) {
      if (!route.redirectTo) continue;
      return {
        type: 'redirect',
        request,
        redirectTo: interpolateRedirect(route.redirectTo, match.params),
        replace: true,
      };
    }

    router.status = 'guarding';
    for (const route of match.chain) {
      for (const guard of route.canActivate ?? []) {
        const result = await executeGuard(guard, context);
        throwIfAborted(signal);
        const redirect = readGuardRedirect(result);
        if (redirect) return { type: 'redirect', request, ...redirect };
        if (result === false) return { type: 'blocked', request };
      }
    }

    router.status = 'resolving';
    const resolvedData: Record<string, unknown> = {};
    for (const route of match.chain) {
      const entries = Object.entries(route.resolve ?? {});
      const values = await Promise.all(
        entries.map(async ([key, resolver]) => {
          const value = await executeResolver(resolver, context);
          return [key, value] as const;
        })
      );
      throwIfAborted(signal);
      Object.assign(resolvedData, Object.fromEntries(values));
    }

    const activatedRoute: ActivatedRoute = {
      ...baseRoute,
      data: Object.freeze({ ...staticData, ...resolvedData }),
    };

    if (!match.route.loadComponent) {
      throw new Error(`Route "${match.route.path}" has no component`);
    }
    router.status = 'loading';
    const loaded = await match.route.loadComponent();
    throwIfAborted(signal);
    return {
      type: 'success',
      request,
      activatedRoute,
      component: unwrapDefault(loaded),
    };
  }

  async function commitNavigation(result: NavigationResult, redirectCount = 0): Promise<void> {
    if (result.request.id !== navigationId) return;
    switch (result.type) {
      case 'success': {
        if (outlet) await render(outlet, result.component, result.activatedRoute);
        if (result.request.id !== navigationId) return;
        router.current = result.activatedRoute;
        router.pending = null;
        router.status = 'active';
        previousUrl = result.request.url.pathname + result.request.url.search + result.request.url.hash;
        window.dispatchEvent(new CustomEvent('routechange', { detail: result.activatedRoute }));
        trace('Navigation completed', result.activatedRoute.path);
        return;
      }
      case 'redirect': {
        if (redirectCount >= maxRedirects) {
          throw new Error(`Maximum redirect count of ${maxRedirects} exceeded`);
        }
        const url = new URL(result.redirectTo, window.location.href);
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
        const redirectedRequest: NavigationRequest = { id: ++navigationId, url, source: 'imperative' };
        router.pending = redirectedRequest;
        const controller = new AbortController();
        const redirectedResult = await performNavigation(redirectedRequest, controller.signal);
        await commitNavigation(redirectedResult, redirectCount + 1);
        return;
      }
      case 'blocked': {
        router.pending = null;
        router.status = 'blocked';
        if (result.request.source === 'imperative') {
          window.history.replaceState(window.history.state, '', previousUrl);
        }
        trace('Navigation blocked');
        return;
      }
      case 'not-found': {
        if (outlet) await renderNotFound(outlet, result.request.url);
        if (result.request.id !== navigationId) return;
        router.pending = null;
        router.status = 'not-found';
        trace('Route not found', result.request.url.pathname);
        return;
      }
    }
  }

  function handlePopState(): void {
    requestNavigation(new URL(window.location.href), 'popstate');
  }

  function handleDocumentClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download') || anchor.rel.split(/\s+/).includes('external')) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const currentLocation = window.location.pathname + window.location.search;
    const targetLocation = url.pathname + url.search;
    if (currentLocation === targetLocation && url.hash) return;
    event.preventDefault();
    router.navigate(url);
  }

  const unsubscribeNavigation = router.at.navigation.subscribe(async (result: NavigationResult) => {
    try {
      await commitNavigation(result);
    } catch (error) {
      if (isAbortError(error)) return;
      router.pending = null;
      router.error = error;
      router.status = 'error';
      if (outlet) await renderError(outlet, error);
      trace('Navigation failed', error);
    }
  });

  // Return the public API with explicit Router interface
  return {
    state: router,
    start: () => router.start(),
    stop: () => router.stop(),
    dispose: () => {
      router.stop();
      unsubscribeNavigation?.();
      navigationRequest.dispose();
      router.dispose();
    },
    navigate: (target: string | URL, options?: NavigationOptions) => router.navigate(target, options),
    replace: (target: string | URL, state?: unknown) => router.replace(target, state),
    back: () => router.back(),
    forward: () => router.forward(),
    href: (path: string) => router.href(path),
    createLink: (to: string, text: string, className?: string) => router.createLink(to, text, className),
  };
}

export type StreamixRouter = Router;