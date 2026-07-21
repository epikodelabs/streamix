import { atom, MaybePromise } from '@epikodelabs/streamix';

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
  | { redirectTo: string; replace?: boolean };

export type CanActivate =
  | ((route: NavigationContext) => MaybePromise<GuardResult>)
  | { canActivate(route: NavigationContext): MaybePromise<GuardResult> };

export type Resolve<T = unknown> =
  | ((route: NavigationContext) => MaybePromise<T>)
  | { resolve(route: NavigationContext): MaybePromise<T> };

export type RouteComponent = (route: ActivatedRoute) => MaybePromise<Node>;

export interface Route {
  path: string;
  loadComponent?: () => MaybePromise<RouteComponent | { default: RouteComponent }>;
  loadChildren?: () => MaybePromise<Route[] | { default: Route[] }>;
  redirectTo?: string;
  data?: Record<string, unknown>;
  children?: Route[];
  canActivate?: CanActivate[];
  resolve?: Record<string, Resolve>;
}

export type NavigationPhase = 'recognizing' | 'guarding' | 'resolving' | 'loading' | null;

export interface NavigationOptions {
  replace?: boolean;
  state?: unknown;
}

export interface RouterState {
  readonly current: ActivatedRoute | null;
  readonly pending: boolean;
  readonly phase: NavigationPhase;
  readonly error: unknown;
  readonly path: string;
  readonly params: RouteParams;
  readonly query: QueryParams;
  readonly data: RouteData;
  readonly routeConfig: Route | null;
}

export interface Router {
  readonly state: RouterState;
  start(): void;
  stop(): void;
  dispose(): void;
  navigate(target: string | URL, options?: NavigationOptions): void;
  replace(target: string | URL, state?: unknown): void;
  back(): void;
  forward(): void;
  href(target: string): string;
  createLink(to: string, text: string, className?: string): HTMLAnchorElement;
}

export interface RouterConfig {
  routes: Route[];
  outlet?: HTMLElement | null;
  baseHref?: string;
  enableTracing?: boolean;
  maxRedirects?: number;
  navigateExternal?: (url: URL) => void;
  render?: (outlet: HTMLElement, node: Node, route: ActivatedRoute) => void;
  renderNotFound?: (outlet: HTMLElement, url: URL) => void;
  renderError?: (outlet: HTMLElement, error: unknown) => void;
}

// ---- internal types ----
interface NavigationRequest {
  readonly id: number;
  readonly url: URL;
  readonly redirectCount: number;
}

interface RouteMatch {
  readonly route: Route;
  readonly chain: Route[];
  readonly params: Record<string, string>;
}

interface NavigationSuccess {
  type: 'success';
  request: NavigationRequest;
  route: ActivatedRoute;
  node: Node;
}

interface NavigationRedirect {
  type: 'redirect';
  request: NavigationRequest;
  redirectTo: string;
  replace: boolean;
}

interface NavigationBlocked {
  type: 'blocked';
  request: NavigationRequest;
}

interface NavigationNotFound {
  type: 'not-found';
  request: NavigationRequest;
}

interface NavigationFailure {
  type: 'error';
  request: NavigationRequest;
  error: unknown;
}

type NavigationResult =
  | NavigationSuccess
  | NavigationRedirect
  | NavigationBlocked
  | NavigationNotFound
  | NavigationFailure;


// ---- helpers ----
const EMPTY_PARAMS: RouteParams = Object.freeze({});
const EMPTY_QUERY: QueryParams = Object.freeze({});
const EMPTY_DATA: RouteData = Object.freeze({});

function normalizePath(path: string): string {
  const normalized = `/${path}`.replace(/\/+/g, '/');
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function normalizeBaseHref(path: string): string {
  if (!path || path === '/') return '/';
  return normalizePath(path);
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

function interpolateRedirect(redirectTo: string, params: RouteParams): string {
  return redirectTo.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => encodeURIComponent(params[key] ?? ''));
}

function readRedirect(result: GuardResult): { redirectTo: string; replace: boolean } | null {
  if (typeof result === 'string') return { redirectTo: result, replace: true };
  if (result && typeof result === 'object' && 'redirectTo' in result) {
    return { redirectTo: result.redirectTo, replace: result.replace ?? true };
  }
  return null;
}

function defaultRender(outlet: HTMLElement, node: Node): void {
  outlet.replaceChildren(node);
}

function defaultRenderNotFound(outlet: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.textContent = '404 — Page Not Found';
  outlet.replaceChildren(heading);
}

function defaultRenderError(outlet: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.textContent = 'Page failed to load';
  outlet.replaceChildren(heading);
}

// ---- createRouter ----
export function createRouter(config: RouterConfig): Router {
  const outlet = config.outlet ?? document.getElementById('app');
  const render = config.render ?? defaultRender;
  const renderNotFound = config.renderNotFound ?? defaultRenderNotFound;
  const renderError = config.renderError ?? defaultRenderError;
  const navigateExternal = config.navigateExternal ?? ((url: URL) => window.location.assign(url.href));
  const baseHref = normalizeBaseHref(config.baseHref ?? '/');
  const maxRedirects = config.maxRedirects ?? 10;

  const lazyChildren = new WeakMap<Route, Promise<Route[]>>();

  const currentState = atom<ActivatedRoute | null>(null);
  const requestState = atom<NavigationRequest | null>(null);
  const phaseState = atom<NavigationPhase>(null);
  const errorState = atom<unknown>(null);

  let started = false;
  let disposed = false;
  let navigationId = 0;
  let latestRequestId = 0;
  let activeController: AbortController | null = null;
  let startRequestQueued = false;

  function trace(message: string, ...values: unknown[]): void {
    if (config.enableTracing) console.debug(`[Router] ${message}`, ...values);
  }

  function isInsideBase(pathname: string): boolean {
    return baseHref === '/' || pathname === baseHref || pathname.startsWith(`${baseHref}/`);
  }

  function stripBaseHref(pathname: string): string {
    if (baseHref === '/') return normalizePath(pathname);
    if (!isInsideBase(pathname)) return normalizePath(pathname);
    return normalizePath(pathname.slice(baseHref.length));
  }

  function applyBaseHref(pathname: string): string {
    const normalized = normalizePath(pathname);
    if (baseHref === '/') return normalized;
    if (isInsideBase(normalized)) return normalized;
    if (normalized === '/') return baseHref;
    return normalizePath(`${baseHref}/${normalized.slice(1)}`);
  }

  function resolveAppUrl(target: string | URL, mode: 'navigate' | 'href'): URL {
    if (target instanceof URL) return target;
    const urlString = target.toString();
    if (/^https?:\/\//i.test(urlString)) return new URL(urlString);
    if (urlString.startsWith('?') || urlString.startsWith('#')) return new URL(urlString, window.location.href);

    if (urlString.startsWith('/')) {
      const url = new URL(urlString, window.location.origin);
      if (mode === 'href') {
        url.pathname = applyBaseHref(url.pathname);
      }
      return url;
    }

    const baseUrl = baseHref === '/'
      ? `${window.location.origin}/`
      : `${window.location.origin}${baseHref}/`;
    return new URL(urlString, baseUrl);
  }

  function activeHref(): string | null {
    const url = currentState.value?.url;
    return url ? url.pathname + url.search + url.hash : null;
  }

  function restoreActiveUrl(): void {
    const href = activeHref();
    if (href) window.history.replaceState(window.history.state, '', href);
  }

  function requestNavigation(url: URL, redirectCount = 0): void {
    const request = { id: ++navigationId, url, redirectCount };
    latestRequestId = request.id;
    requestState.next(request);
    errorState.next(null);

    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    void runNavigation(request, controller.signal);
  }

  function setPhase(request: NavigationRequest, phase: NavigationPhase): void {
    if (request.id !== latestRequestId) return;
    phaseState.next(phase);
  }

  async function getChildren(route: Route): Promise<Route[]> {
    if (route.children) return route.children;
    if (!route.loadChildren) return [];
    let cached = lazyChildren.get(route);
    if (!cached) {
      cached = Promise.resolve(route.loadChildren()).then(unwrapDefault).catch(error => {
        lazyChildren.delete(route);
        throw error;
      });
      lazyChildren.set(route, cached);
    }
    return cached;
  }

  async function recognize(
    routes: Route[],
    segments: string[],
    segmentIndex = 0,
    parentParams: Record<string, string> = {},
    parentChain: Route[] = []
  ): Promise<RouteMatch | null> {
    let fallback: Route | undefined;
    for (const route of routes) {
      if (route.path === '**' || route.path === '*') {
        fallback = route;
        continue;
      }
      const routeSegments = splitPath(route.path);
      const params = { ...parentParams };
      let matched = true;
      for (let index = 0; index < routeSegments.length; index++) {
        const expected = routeSegments[index];
        const actual = segments[segmentIndex + index];
        if (actual === undefined) { matched = false; break; }
        if (expected.startsWith(':')) {
          params[expected.slice(1)] = decodeSegment(actual);
          continue;
        }
        if (expected !== actual) { matched = false; break; }
      }
      if (!matched) continue;

      const nextIndex = segmentIndex + routeSegments.length;
      const chain = [...parentChain, route];
      const children = await getChildren(route);
      if (children.length > 0) {
        const childMatch = await recognize(children, segments, nextIndex, params, chain);
        if (childMatch) return childMatch;
      }
      if (nextIndex === segments.length) {
        return { route, chain, params };
      }
    }
    if (!fallback) return null;
    return { route: fallback, chain: [...parentChain, fallback], params: { ...parentParams } };
  }

  async function performNavigation(request: NavigationRequest, signal: AbortSignal): Promise<NavigationResult> {
    trace('Navigation started', request.url.href);
    setPhase(request, 'recognizing');

    if (!isInsideBase(request.url.pathname)) {
      throw new Error(`URL "${request.url.pathname}" is outside router base "${baseHref}"`);
    }
    const path = stripBaseHref(request.url.pathname);
    const match = await recognize(config.routes, splitPath(path));
    throwIfAborted(signal);

    if (!match) {
      return { type: 'not-found', request };
    }

    const staticData = Object.assign({}, ...match.chain.map(route => route.data ?? {}));
    const baseRoute: ActivatedRoute = {
      url: request.url,
      path: normalizePath(request.url.pathname),
      params: Object.freeze({ ...match.params }),
      queryParams: readQuery(request.url),
      data: Object.freeze({ ...staticData }),
      config: match.route,
    };

    for (const route of match.chain) {
      if (!route.redirectTo) continue;
      return {
        type: 'redirect',
        request,
        redirectTo: interpolateRedirect(route.redirectTo, match.params),
        replace: true,
      };
    }

    setPhase(request, 'guarding');
    const guardContext: NavigationContext = { ...baseRoute, signal };
    for (const route of match.chain) {
      for (const guard of route.canActivate ?? []) {
        const result = await executeGuard(guard, guardContext);
        throwIfAborted(signal);
        const redirect = readRedirect(result);
        if (redirect) return { type: 'redirect', request, ...redirect };
        if (result === false) return { type: 'blocked', request };
      }
    }

    setPhase(request, 'resolving');
    const resolvedData: Record<string, unknown> = {};
    for (const route of match.chain) {
      const context: NavigationContext = {
        ...baseRoute,
        data: Object.freeze({ ...staticData, ...resolvedData }),
        signal,
      };
      const values = await Promise.all(
        Object.entries(route.resolve ?? {}).map(async ([key, resolver]) => {
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
      throw new Error(`Matched route "${match.route.path}" has no component`);
    }

    setPhase(request, 'loading');
    const loaded = await match.route.loadComponent();
    throwIfAborted(signal);
    const component = unwrapDefault(loaded);
    const node = await component(activatedRoute);
    throwIfAborted(signal);

    return { type: 'success', request, route: activatedRoute, node };
  }

  async function runNavigation(request: NavigationRequest, signal: AbortSignal): Promise<void> {
    if (disposed) return;
    try {
      const result = await performNavigation(request, signal);
      if (result.request.id !== latestRequestId) return;
      commit(result);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return;
      const failure: NavigationFailure = { type: 'error', request, error };
      if (failure.request.id !== latestRequestId) return;
      commit(failure);
    } finally {
      if (activeController?.signal === signal) {
        activeController = null;
      }
    }
  }

  function commit(result: NavigationResult): void {
    if (disposed || result.request.id !== latestRequestId) return;

    switch (result.type) {
      case 'success': {
        if (outlet) render(outlet, result.node, result.route);
        currentState.next(result.route);
        requestState.next(null);
        phaseState.next(null);
        errorState.next(null);
        window.dispatchEvent(new CustomEvent('routechange', { detail: result.route }));
        trace('Navigation completed', result.route.path);
        return;
      }
      case 'redirect': {
        if (result.request.redirectCount >= maxRedirects) {
          commit({ type: 'error', request: result.request, error: new Error(`Maximum redirect count of ${maxRedirects} exceeded`) });
          return;
        }
        const url = resolveAppUrl(result.redirectTo, 'href');
        if (url.origin !== window.location.origin) {
          navigateExternal(url);
          return;
        }
        const href = url.pathname + url.search + url.hash;
        window.history[result.replace ? 'replaceState' : 'pushState'](window.history.state, '', href);
        requestNavigation(url, result.request.redirectCount + 1);
        return;
      }
      case 'blocked': {
        restoreActiveUrl();
        requestState.next(null);
        phaseState.next(null);
        trace('Navigation blocked');
        return;
      }
      case 'not-found': {
        if (outlet) renderNotFound(outlet, result.request.url);
        requestState.next(null);
        phaseState.next(null);
        errorState.next(null);
        trace('Route not found', result.request.url.pathname);
        return;
      }
      case 'error': {
        restoreActiveUrl();
        requestState.next(null);
        phaseState.next(null);
        errorState.next(result.error);
        if (!currentState.value && outlet) {
          renderError(outlet, result.error);
        }
        trace('Navigation failed', result.error);
        return;
      }
    }
  }

  function handlePopState(): void {
    requestNavigation(new URL(window.location.href));
  }

  function handleClick(event: MouseEvent): void {
    if (disposed || !started) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download') || anchor.rel.split(/\s+/).includes('external')) return;

    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || !isInsideBase(url.pathname)) {
      return;
    }
    if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;

    const current = window.location.pathname + window.location.search + window.location.hash;
    const next = url.pathname + url.search;
    if (current === next && url.hash) return;

    event.preventDefault();
    navigate(url);
  }

  function navigate(target: string | URL, options: NavigationOptions = {}): void {
    if (disposed) throw new Error('Cannot navigate with a disposed router');
    const url = resolveAppUrl(target, 'navigate');
    if (url.origin !== window.location.origin) {
      navigateExternal(url);
      return;
    }
    if (!isInsideBase(url.pathname)) {
      throw new Error(`URL "${url.pathname}" is outside router base "${baseHref}"`);
    }
    const href = url.pathname + url.search + url.hash;
    window.history[options.replace ? 'replaceState' : 'pushState'](options.state ?? null, '', href);
    requestNavigation(url);
  }

  function replace(target: string | URL, state?: unknown): void {
    navigate(target, { replace: true, state });
  }

  function startRouter(): void {
    if (disposed) throw new Error('Cannot start a disposed router');
    if (started) return;
    started = true;
    window.addEventListener('popstate', handlePopState);
    document.addEventListener('click', handleClick);
    if (startRequestQueued) return;
    startRequestQueued = true;
    queueMicrotask(() => {
      startRequestQueued = false;
      if (!started || disposed || currentState.value !== null || requestState.value !== null) return;
      requestNavigation(new URL(window.location.href));
    });
  }

  function stopRouter(): void {
    if (!started) return;
    window.removeEventListener('popstate', handlePopState);
    document.removeEventListener('click', handleClick);
    activeController?.abort();
    activeController = null;
    started = false;
    requestState.next(null);
    phaseState.next(null);
    errorState.next(null);
    currentState.next(null);
  }

  function href(target: string): string {
    const url = resolveAppUrl(target, 'href');
    return url.pathname + url.search + url.hash;
  }

  function createLink(to: string, text: string, className = ''): HTMLAnchorElement {
    const link = document.createElement('a');
    link.href = href(to);
    link.textContent = text;
    if (className) link.className = className;
    return link;
  }

  const publicState: RouterState = {
    get current() {
      if (disposed) return null;
      return currentState.value;
    },
    get pending() {
      if (disposed) return false;
      return requestState.value !== null;
    },
    get phase() {
      if (disposed) return null;
      return phaseState.value;
    },
    get error() {
      if (disposed) return null;
      return errorState.value;
    },
    get path() {
      if (disposed) return '';
      return currentState.value?.path ?? '';
    },
    get params() {
      if (disposed) return EMPTY_PARAMS;
      return currentState.value?.params ?? EMPTY_PARAMS;
    },
    get query() {
      if (disposed) return EMPTY_QUERY;
      return currentState.value?.queryParams ?? EMPTY_QUERY;
    },
    get data() {
      if (disposed) return EMPTY_DATA;
      return currentState.value?.data ?? EMPTY_DATA;
    },
    get routeConfig() {
      if (disposed) return null;
      return currentState.value?.config ?? null;
    },
  };

  // ---- public API ----
  return {
    state: publicState,
    start: () => startRouter(),
    stop: () => stopRouter(),
    dispose: () => {
      if (disposed) return;
      stopRouter();
      disposed = true;
      currentState.dispose();
      requestState.dispose();
      phaseState.dispose();
      errorState.dispose();
    },
    navigate: (target, options) => navigate(target, options),
    replace: (target, state) => replace(target, state),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    href: (target) => href(target),
    createLink: (to, text, className) => createLink(to, text, className),
  };
}

export type StreamixRouter = ReturnType<typeof createRouter>;
