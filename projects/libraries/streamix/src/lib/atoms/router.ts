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

export interface DeactivationContext extends ActivatedRoute {
  readonly nextUrl: URL;
  readonly signal: AbortSignal;
}

export interface RouteRenderContext {
  readonly signal: AbortSignal;
  readonly destroySignal: AbortSignal;
}

export interface RenderedRouteNode {
  readonly node: Node;
  readonly dispose?: () => void;
}

export type GuardResult =
  | boolean
  | string
  | { redirectTo: string; replace?: boolean };

export type CanActivate =
  | ((route: NavigationContext) => MaybePromise<GuardResult>)
  | { canActivate(route: NavigationContext): MaybePromise<GuardResult> };

export type CanDeactivate =
  | ((route: DeactivationContext) => MaybePromise<GuardResult>)
  | { canDeactivate(route: DeactivationContext): MaybePromise<GuardResult> };

export type Resolve<T = unknown> =
  | ((route: NavigationContext) => MaybePromise<T>)
  | { resolve(route: NavigationContext): MaybePromise<T> };

export type RouteComponent = (
  route: ActivatedRoute,
  context: RouteRenderContext
) => MaybePromise<Node | RenderedRouteNode>;

export interface Route {
  path: string;
  loadComponent?: () => MaybePromise<RouteComponent | { default: RouteComponent }>;
  loadChildren?: () => MaybePromise<Route[] | { default: Route[] }>;
  redirectTo?: string;
  data?: Record<string, unknown>;
  children?: Route[];
  canActivate?: CanActivate[];
  canDeactivate?: CanDeactivate[];
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
  route: ActiveRoute;
  node: Node;
  rendered: ActiveRender;
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

interface ActiveRoute extends ActivatedRoute {
  readonly chain: readonly Route[];
  readonly routeStates: readonly ActivatedRoute[];
}

interface ActiveRender {
  readonly controller: AbortController;
  readonly dispose: () => void;
}

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
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readQuery(url: URL): QueryParams {
  return Object.freeze(Object.fromEntries(url.searchParams.entries()));
}

function isRenderedRouteNode(value: unknown): value is RenderedRouteNode {
  return value !== null && typeof value === 'object' && 'node' in value;
}

function normalizeRenderedRouteNode(value: Node | RenderedRouteNode): RenderedRouteNode {
  return isRenderedRouteNode(value) ? value : { node: value };
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

function executeDeactivationGuard(
  guard: CanDeactivate,
  route: DeactivationContext
): MaybePromise<GuardResult> {
  return typeof guard === 'function' ? guard(route) : guard.canDeactivate(route);
}

function executeResolver(resolver: Resolve, route: NavigationContext): MaybePromise<unknown> {
  return typeof resolver === 'function' ? resolver(route) : resolver.resolve(route);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Navigation aborted', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error
    && (error as { name?: string }).name === 'AbortError';
}

function interpolateRedirect(redirectTo: string, params: RouteParams): string {
  return redirectTo.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => {
    if (!(key in params)) {
      throw new Error(`Missing route parameter "${key}" for redirect "${redirectTo}"`);
    }
    return encodeURIComponent(params[key]);
  });
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
  heading.textContent = '404 вЂ” Page Not Found';
  outlet.replaceChildren(heading);
}

function defaultRenderError(outlet: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.textContent = 'Page failed to load';
  outlet.replaceChildren(heading);
}

function findNestedOutlet(node: Node): HTMLElement | null {
  if (node instanceof HTMLElement && node.matches('[data-router-outlet]')) {
    return node;
  }
  if (node instanceof Element || node instanceof DocumentFragment) {
    const candidate = node.querySelector('[data-router-outlet]');
    return candidate instanceof HTMLElement ? candidate : null;
  }
  return null;
}

export function createRouter(config: RouterConfig): Router {
  const render = config.render ?? defaultRender;
  const renderNotFound = config.renderNotFound ?? defaultRenderNotFound;
  const renderError = config.renderError ?? defaultRenderError;
  const navigateExternal = config.navigateExternal ?? ((url: URL) => window.location.assign(url.href));
  const baseHref = normalizeBaseHref(config.baseHref ?? '/');
  const maxRedirects = config.maxRedirects ?? 10;

  const lazyChildren = new WeakMap<Route, Promise<Route[]>>();

  const currentState = atom<ActiveRoute | null>(null);
  const requestState = atom<NavigationRequest | null>(null);
  const phaseState = atom<NavigationPhase>(null);
  const errorState = atom<unknown>(null);

  let started = false;
  let disposed = false;
  let navigationId = 0;
  let latestRequestId = 0;
  let activeController: AbortController | null = null;
  let activeRender: ActiveRender | null = null;
  let startRequestQueued = false;

  function trace(message: string, ...values: unknown[]): void {
    if (config.enableTracing) console.debug(`[Router] ${message}`, ...values);
  }

  function resolveOutlet(): HTMLElement | null {
    return config.outlet ?? document.getElementById('app');
  }

  function disposeRender(renderInstance: ActiveRender | null): void {
    if (!renderInstance) return;
    renderInstance.dispose();
  }

  function replaceActiveRender(renderInstance: ActiveRender | null): void {
    const previousRender = activeRender;
    activeRender = renderInstance;
    disposeRender(previousRender);
  }

  function clearOutlet(): void {
    const outlet = resolveOutlet();
    if (outlet) outlet.replaceChildren();
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

  function relativeBaseUrl(): string {
    if (baseHref !== '/' && isInsideBase(window.location.pathname)) {
      return window.location.href;
    }
    return baseHref === '/'
      ? `${window.location.origin}/`
      : `${window.location.origin}${baseHref}/`;
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

    return new URL(urlString, relativeBaseUrl());
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

  function requestExternalNavigation(url: URL): void {
    const request = { id: ++navigationId, url, redirectCount: 0 };
    latestRequestId = request.id;
    requestState.next(request);
    errorState.next(null);

    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    void runExternalNavigation(request, controller.signal);
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

  function createRouteStates(
    chain: readonly Route[],
    url: URL,
    path: string,
    params: RouteParams,
    queryParams: QueryParams,
    data: RouteData
  ): readonly ActivatedRoute[] {
    return chain.map(route => ({
      url,
      path,
      params,
      queryParams,
      data,
      config: route,
    }));
  }

  async function runCanDeactivateGuards(
    nextUrl: URL,
    signal: AbortSignal
  ): Promise<GuardResult | null> {
    const activeRoute = currentState.value;
    if (!activeRoute) return null;

    for (let index = activeRoute.routeStates.length - 1; index >= 0; index--) {
      const routeState = activeRoute.routeStates[index];
      const context: DeactivationContext = {
        ...routeState,
        nextUrl,
        signal,
      };

      for (const guard of routeState.config.canDeactivate ?? []) {
        const result = await executeDeactivationGuard(guard, context);
        throwIfAborted(signal);
        const redirect = readRedirect(result);
        if (redirect) {
          const redirectUrl = resolveAppUrl(redirect.redirectTo, 'href');
          if (redirectUrl.href === nextUrl.href) {
            continue;
          }
          return redirect;
        }
        if (result === false) return false;
      }
    }

    return null;
  }

  async function renderRouteChain(
    routeStates: readonly ActivatedRoute[],
    signal: AbortSignal
  ): Promise<{ node: Node; rendered: ActiveRender }> {
    if (routeStates.length === 0) {
      throw new Error('Route render chain is empty');
    }

    const destroyController = new AbortController();
    const cleanups: Array<() => void> = [];

    const rendered: ActiveRender = {
      controller: destroyController,
      dispose: () => {
        destroyController.abort();
        while (cleanups.length > 0) {
          const cleanup = cleanups.pop();
          try {
            cleanup?.();
          } catch (error) {
            trace('Route cleanup failed', error);
          }
        }
      },
    };

    async function renderAt(index: number): Promise<Node> {
      const routeState = routeStates[index];
      if (!routeState) {
        throw new Error('Route render chain is empty');
      }

      if (!routeState.config.loadComponent) {
        if (index === routeStates.length - 1) {
          throw new Error(`Matched route "${routeState.config.path}" has no component`);
        }
        return renderAt(index + 1);
      }

      const loaded = await routeState.config.loadComponent();
      throwIfAborted(signal);
      const component = unwrapDefault(loaded);
      const output = normalizeRenderedRouteNode(
        await component(routeState, {
          signal,
          destroySignal: destroyController.signal,
        })
      );
      throwIfAborted(signal);

      if (output.dispose) {
        cleanups.push(output.dispose);
      }

      if (index < routeStates.length - 1) {
        const childNode = await renderAt(index + 1);
        const outlet = findNestedOutlet(output.node);
        if (!outlet) {
          throw new Error(`Route "${routeState.config.path}" rendered no nested outlet`);
        }
        outlet.replaceChildren(childNode);
      }

      return output.node;
    }

    try {
      const node = await renderAt(0);
      throwIfAborted(signal);
      return { node, rendered };
    } catch (error) {
      rendered.dispose();
      throw error;
    }
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

        if (actual === undefined) {
          matched = false;
          break;
        }

        if (expected.startsWith(':')) {
          params[expected.slice(1)] = decodeSegment(actual);
          continue;
        }

        if (expected !== actual) {
          matched = false;
          break;
        }
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

    setPhase(request, 'guarding');
    const deactivationResult = await runCanDeactivateGuards(request.url, signal);
    if (deactivationResult === false) {
      return { type: 'blocked', request };
    }
    if (deactivationResult) {
      const redirect = readRedirect(deactivationResult);
      if (redirect) return { type: 'redirect', request, ...redirect };
    }

    if (!match) {
      return { type: 'not-found', request };
    }

    const staticData = Object.assign({}, ...match.chain.map(route => route.data ?? {}));
    const baseRoute: ActivatedRoute = {
      url: request.url,
      path,
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

    const mergedData = Object.freeze({ ...staticData, ...resolvedData });
    const routeStates = createRouteStates(
      match.chain,
      request.url,
      path,
      baseRoute.params,
      baseRoute.queryParams,
      mergedData
    );

    const activatedRoute: ActiveRoute = {
      ...baseRoute,
      data: mergedData,
      chain: Object.freeze([...match.chain]),
      routeStates: Object.freeze(routeStates),
    };

    setPhase(request, 'loading');
    const { node, rendered } = await renderRouteChain(routeStates, signal);
    return { type: 'success', request, route: activatedRoute, node, rendered };
  }

  async function runExternalNavigation(request: NavigationRequest, signal: AbortSignal): Promise<void> {
    if (disposed) return;

    try {
      setPhase(request, 'guarding');
      const deactivationResult = await runCanDeactivateGuards(request.url, signal);
      if (request.id !== latestRequestId) return;

      const redirect = deactivationResult ? readRedirect(deactivationResult) : null;
      if (redirect) {
        const url = resolveAppUrl(redirect.redirectTo, 'href');
        if (url.origin !== window.location.origin) {
          requestState.next(null);
          phaseState.next(null);
          errorState.next(null);
          navigateExternal(url);
          return;
        }

        const href = url.pathname + url.search + url.hash;
        window.history[redirect.replace ? 'replaceState' : 'pushState'](window.history.state, '', href);
        requestNavigation(url);
        return;
      }

      if (deactivationResult === false) {
        commit({ type: 'blocked', request });
        return;
      }

      requestState.next(null);
      phaseState.next(null);
      errorState.next(null);
      navigateExternal(request.url);
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

  async function runNavigation(request: NavigationRequest, signal: AbortSignal): Promise<void> {
    if (disposed) return;

    try {
      const result = await performNavigation(request, signal);
      if (result.request.id !== latestRequestId) {
        if (result.type === 'success') {
          result.rendered.dispose();
        }
        return;
      }
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
        const outlet = resolveOutlet();
        if (outlet) render(outlet, result.node, result.route);
        replaceActiveRender(result.rendered);
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
          commit({
            type: 'error',
            request: result.request,
            error: new Error(`Maximum redirect count of ${maxRedirects} exceeded`),
          });
          return;
        }

        const url = resolveAppUrl(result.redirectTo, 'href');
        if (url.origin !== window.location.origin) {
          requestExternalNavigation(url);
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
        errorState.next(null);
        trace('Navigation blocked');
        return;
      }
      case 'not-found': {
        const outlet = resolveOutlet();
        if (outlet) renderNotFound(outlet, result.request.url);
        replaceActiveRender(null);
        currentState.next(null);
        requestState.next(null);
        phaseState.next(null);
        errorState.next(null);
        trace('Route not found', result.request.url.pathname);
        return;
      }
      case 'error': {
        const outlet = resolveOutlet();
        restoreActiveUrl();
        if (outlet) renderError(outlet, result.error);
        replaceActiveRender(null);
        currentState.next(null);
        requestState.next(null);
        phaseState.next(null);
        errorState.next(result.error);
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
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

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

    if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) {
      return;
    }

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
      requestExternalNavigation(url);
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
    replaceActiveRender(null);
    clearOutlet();
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
