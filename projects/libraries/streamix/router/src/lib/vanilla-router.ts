import { HistoryManager, ZERO_SCROLL, type HistoryEntry, type HistoryUpdate, type ScrollPosition } from './history';
import { dispatchRouterLocationChange } from './router-events';
import {
  isPathInsideBase,
  normalizeBaseHref,
  resolveRouterUrl,
  routerHref,
  stripBaseHref
} from './router-url';

type MaybePromise<T> = T | PromiseLike<T>;

type RawRouteParams = Readonly<Record<string, string>>;

export type RouteParams =
  Readonly<Record<string, unknown>>;

export type RouteQuery =
  Readonly<Record<string, unknown>>;

export type RouteData =
  Readonly<Record<string, unknown>>;

export interface ActivatedRoute {
  readonly url: URL;
  readonly path: string;
  /**
   * Parsed and validated path parameters.
   * Raw matcher captures remain internal to the router.
   */
  readonly params: RouteParams;

  /**
   * Parsed and validated search values.
   * Raw URLSearchParams remain available through `url.searchParams`.
   */
  readonly query: RouteQuery;

  readonly data: RouteData;
  readonly historyState: unknown;
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
  readonly component?: unknown;
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

export type ParseRouteParams = (
  params: RawRouteParams,
  url: URL,
  signal: AbortSignal,
) => MaybePromise<RouteParams>;

export type ParseRouteQuery = (
  url: URL,
  signal: AbortSignal,
) => MaybePromise<RouteQuery>;

export interface LoadedRoute {
  readonly component?: RouteComponent;
  readonly canActivate?: CanActivate[];
  readonly canDeactivate?: CanDeactivate[];
  readonly resolve?: Record<string, Resolve>;
  readonly parseParams?: ParseRouteParams;
  readonly parseQuery?: ParseRouteQuery;
}

export interface Route {
  name?: string;
  path: string;
  outlet?: string;
  /** Same-path named outlets activated atomically with this primary route. */
  outlets?: readonly Route[];
  load?: () => MaybePromise<LoadedRoute>;
  redirectTo?: string;
  data?: Record<string, unknown>;
  preload?: boolean;
  viewTransition?: boolean;
  canActivate?: CanActivate[];
  canDeactivate?: CanDeactivate[];
  resolve?: Record<string, Resolve>;
}

export type NavigationPhase = 'recognizing' | 'guarding' | 'resolving' | 'loading' | null;

export interface NavigationOptions {
  replace?: boolean;
  state?: unknown;
}

export type ScrollRestorationMode = 'restore' | 'top' | 'preserve';
export type PreloadingStrategy = 'none' | 'eager' | 'idle';
export type ViewTransitionPhase = 'success' | 'not-found' | 'error';

export interface ViewTransitionContext {
  readonly url: URL;
  readonly from: ActivatedRoute | null;
  readonly to: ActivatedRoute | null;
  readonly phase: ViewTransitionPhase;
  readonly routeConfig: Route | null;
  readonly error?: unknown;
}

export type ViewTransitionsOption =
  | boolean
  | ((context: ViewTransitionContext) => boolean);

export interface RouterState {
  readonly current: ActivatedRoute | null;
  readonly pending: boolean;
  readonly phase: NavigationPhase;
  readonly error: unknown;
  readonly path: string;
  readonly params: RouteParams;
  readonly query: RouteQuery;
  readonly data: RouteData;
  readonly historyState: unknown;
  readonly routeConfig: Route | null;
}

export interface Router {
  readonly state: RouterState;
  start(): void;
  stop(): void;
  dispose(): void;
  navigate(target: string | URL, options?: NavigationOptions): Promise<boolean>;
  replace(target: string | URL, state?: unknown): Promise<boolean>;
  updateHistoryState(state: unknown): void;
  preload(): Promise<void>;
  back(): void;
  forward(): void;
  href(target: string): string;
  createLink(to: string, text: string, className?: string): HTMLAnchorElement;
}

export interface RouterConfig {
  routes: Route[];
  /**
   * Default DOM outlet used when no custom named-outlet renderer is supplied.
   */
  outlet?: HTMLElement | null;
  baseHref?: string;
  enableTracing?: boolean;
  maxRedirects?: number;
  onSameUrlNavigation?: 'ignore';
  scrollRestoration?: ScrollRestorationMode;
  preloading?: PreloadingStrategy;
  viewTransitions?: ViewTransitionsOption;
  navigateExternal?: (url: URL) => void;
  onOutletActivate?: (outlet: HTMLElement, component: unknown) => void;
  render?: (outletName: string, node: Node, route: ActivatedRoute) => void;
  renderNotFound?: (outletName: string, url: URL, router: Router) => void;
  commit?: (outlets: readonly PreparedOutlet[]) => void;
  renderError?: (outletName: string, error: unknown, router: Router) => void;
  onStateChange?: (state: RouterState) => void;
}

interface NavigationCompletion {
  settled: boolean;
  resolve(success: boolean): void;
}

interface NavigationRequest {
  readonly id: number;
  readonly url: URL;
  readonly redirectCount: number;
  readonly completion: NavigationCompletion;
  readonly historyUpdate: HistoryUpdate;
}

interface RouteMatch {
  readonly route: Route;
  readonly params: RawRouteParams;
}

interface RoutePattern {
  readonly path: string;
  readonly segments: readonly string[];
  readonly parameterNames: readonly (string | null)[];
}

export interface PreparedOutlet {
  readonly name: string;
  readonly route: ActiveRoute;
  readonly node: Node;
  readonly component?: unknown;
  readonly rendered: ActiveRender;
}

interface NavigationSuccess {
  type: 'success';
  request: NavigationRequest;
  route: ActiveRoute;
  outlets: readonly PreparedOutlet[];
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
  preserveActive?: boolean;
}

type NavigationResult =
  | NavigationSuccess
  | NavigationRedirect
  | NavigationBlocked
  | NavigationNotFound
  | NavigationFailure;

class RoutePreparationError extends Error {
  constructor(
    readonly originalError: unknown,
    readonly preserveActive: boolean,
  ) {
    super(
      originalError instanceof Error
        ? originalError.message
        : String(originalError),
      { cause: originalError },
    );
    this.name = 'RoutePreparationError';
  }
}

interface ActiveRoute extends ActivatedRoute {
}

interface ActiveRender {
  readonly controller: AbortController;
  readonly dispose: () => void;
}

const EMPTY_PARAMS: RouteParams =
  Object.freeze({});

const EMPTY_QUERY: RouteQuery =
  Object.freeze({});

const EMPTY_DATA: RouteData =
  Object.freeze({});

function splitPath(path: string): string[] {
  return path
    .split('/')
    .filter(Boolean);
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isRenderedRouteNode(value: unknown): value is RenderedRouteNode {
  return value !== null && typeof value === 'object' && 'node' in value;
}

function normalizeRenderedRouteNode(value: Node | RenderedRouteNode): RenderedRouteNode {
  return isRenderedRouteNode(value) ? value : { node: value };
}

function readRawQuery(
  url: URL,
): RouteQuery {
  const values:
    Record<string, string> = {};

  url.searchParams.forEach(
    (value, key) => {
      values[key] = value;
    },
  );

  return Object.freeze(values);
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

function interpolateRedirect(
  redirectTo: string,
  params: RawRouteParams,
): string {
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


function validateRouteGroups(routes: readonly Route[]): void {
  const primaryPaths = new Set<string>();

  for (const primary of routes) {
    const primaryOutlet = primary.outlet?.trim() ?? '';
    if (primaryOutlet) {
      throw new Error(
        `Top-level route "${primary.path}" must target the primary outlet`,
      );
    }

    if (primaryPaths.has(primary.path)) {
      throw new Error(`Duplicate primary route path "${primary.path}"`);
    }
    primaryPaths.add(primary.path);

    const outletNames = new Set<string>();
    for (const outlet of primary.outlets ?? []) {
      const name = outlet.outlet?.trim() ?? '';
      if (!name) {
        throw new Error(
          `Secondary route for "${primary.path}" must define a named outlet`,
        );
      }
      if (outletNames.has(name)) {
        throw new Error(
          `Duplicate outlet "${name}" for route "${primary.path}"`,
        );
      }
      outletNames.add(name);

      if (outlet.path !== primary.path) {
        throw new Error(
          `Outlet "${name}" must use the primary path "${primary.path}"`,
        );
      }
      if (outlet.outlets?.length) {
        throw new Error(`Outlet "${name}" cannot contain nested outlets`);
      }
      if (outlet.redirectTo) {
        throw new Error(`Outlet "${name}" cannot redirect`);
      }
      if (outlet.name) {
        throw new Error(`Outlet "${name}" cannot define a route name`);
      }
      if (outlet.preload !== undefined) {
        throw new Error(
          `Outlet "${name}" cannot define preload; the primary route owns group preloading`,
        );
      }
      if (outlet.viewTransition !== undefined) {
        throw new Error(
          `Outlet "${name}" cannot define viewTransition; the primary route owns the transition`,
        );
      }
    }

    if (primary.redirectTo && outletNames.size > 0) {
      throw new Error(
        `Redirect route "${primary.path}" cannot activate named outlets`,
      );
    }
  }
}

const routeLoads = new WeakMap<Route, Promise<LoadedRoute>>();

function loadRoute(
  route: Route,
): Promise<LoadedRoute> {
  let pending = routeLoads.get(route);

  if (!pending) {
    pending = Promise
      .resolve(
        route.load?.() ?? {},
      )
      .then(loaded => ({
        component: loaded.component,
        canActivate: loaded.canActivate,
        canDeactivate: loaded.canDeactivate,
        resolve: loaded.resolve,
        parseParams: loaded.parseParams,
        parseQuery: loaded.parseQuery,
      }))
      .catch(error => {
        routeLoads.delete(route);
        throw error;
      });

    routeLoads.set(route, pending);
  }

  return pending;
}

export function createRouter(config: RouterConfig): Router {
  validateRouteGroups(config.routes);
  const render = config.render;
  const renderNotFound = config.renderNotFound;
  const renderError = config.renderError;
  const commitOutlets = config.commit;
  const navigateExternal = config.navigateExternal ?? ((url: URL) => window.location.assign(url.href));
  const baseHref = normalizeBaseHref(config.baseHref ?? '/');
  const maxRedirects = config.maxRedirects ?? 10;
  const scrollRestoration = config.scrollRestoration ?? 'preserve';
  const preloading = config.preloading ?? 'none';
  const viewTransitions = config.viewTransitions ?? false;
  const history =
    new HistoryManager();
  const routePatterns = new WeakMap<Route, RoutePattern>();

  let currentState: ActiveRoute | null = null;
  let requestState: NavigationRequest | null = null;
  let navigationPhase: NavigationPhase = null;
  let errorState: unknown = null;

  let started = false;
  let disposed = false;
  let navigationId = 0;
  let latestRequestId = 0;
  let activeController: AbortController | null = null;
  const activeRenders = new Map<string, ActiveRender>();
  const activeRouteStates = new Map<string, ActiveRoute>();
  let startRequestQueued = false;
  let preloadTask: Promise<void> | null = null;
  let preloadQueued = false;
  let preloadIdleId: number | null = null;
  let preloadTimeoutId: number | null = null;

  function trace(message: string, ...values: unknown[]): void {
    if (config.enableTracing) console.debug(`[Router] ${message}`, ...values);
  }

  function warn(message: string, ...values: unknown[]): void {
    console.warn(`[Router] ${message}`, ...values);
  }

  function resolveOutlet(): HTMLElement | null {
    return config.outlet ?? document.getElementById('app');
  }

  function createStatusRoute(url: URL): ActivatedRoute {
    return currentState ?? {
      url,
      path: stripBaseHref(url.pathname, baseHref),
      params: EMPTY_PARAMS,
      query: readRawQuery(url),
      data: EMPTY_DATA,
      historyState: window.history.state,
      config: config.routes[0] ?? { path: '**' },
    };
  }

  function renderPrimaryNode(node: Node, route: ActivatedRoute): HTMLElement | null {
    if (render) {
      render('', node, route);
      return node.parentElement ?? resolveOutlet();
    }

    const outlet = resolveOutlet();
    if (outlet) {
      defaultRender(outlet, node);
    }
    return outlet;
  }

  function disposeRender(renderInstance: ActiveRender | null): void {
    if (!renderInstance) return;
    renderInstance.dispose();
  }

  function replaceActiveRender(
    outletName: string,
    renderInstance: ActiveRender | null,
  ): void {
    const previousRender =
      activeRenders.get(outletName) ?? null;

    if (renderInstance) {
      activeRenders.set(
        outletName,
        renderInstance,
      );
    } else {
      activeRenders.delete(
        outletName,
      );
    }

    disposeRender(previousRender);
  }

  function disposeAllRenders(): void {
    for (const renderInstance of activeRenders.values()) {
      disposeRender(renderInstance);
    }

    activeRenders.clear();
    activeRouteStates.clear();
  }  

  function clearOutlet(): void {
    const outlet = resolveOutlet();
    if (outlet) outlet.replaceChildren();
  }

  function currentHref(): string {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function readScroll(): ScrollPosition {
    return {
      x: window.scrollX,
      y: window.scrollY,
    }
  }

  function scrollToPosition(position: ScrollPosition): void {
    window.scrollTo(position.x, position.y);
  }

  function restoreScroll(update: HistoryUpdate): void {
    if (scrollRestoration === 'preserve') {
      return;
    }

    if (scrollRestoration === 'restore' && update.type === 'popstate') {
      scrollToPosition(update.nextEntry?.scroll ?? ZERO_SCROLL);
      return;
    }

    scrollToPosition(ZERO_SCROLL);
  }

  function restorePreviousScroll(update: HistoryUpdate): void {
    if (scrollRestoration === 'preserve') {
      return;
    }

    scrollToPosition(update.previousScroll);
  }

  function isInsideBase(pathname: string): boolean {
    return isPathInsideBase(pathname, baseHref);
  }

  function resolveAppUrl(target: string | URL, mode: 'navigate' | 'href'): URL {
    return resolveRouterUrl(target, baseHref, window.location, mode);
  }

  function activeHref(): string | null {
    const url = currentState?.url;
    return url ? url.pathname + url.search + url.hash : null;
  }

  function restoreActiveUrl(): void {
    const active = activeHref();
    const fallback = history.createDefaultUpdate().previousEntry?.href ?? currentHref();
    const href =
      active ?? fallback;

    window.history.replaceState(
      currentState?.historyState ??
        history.createDefaultUpdate().previousEntry?.state ?? null,
      '',
      href,
    );

    dispatchRouterLocationChange();
  }

  function applyHistoryStateToRoute(
    route: ActiveRoute,
    historyState: unknown,
  ): ActiveRoute {
    return { ...route, historyState };
  }

  function updateHistoryState(state: unknown): void {
    if (disposed) {
      throw new Error('Cannot update history state on a disposed router');
    }

    const entry = history.createDefaultUpdate().previousEntry ?? {
      href: currentHref(),
      scroll: readScroll(),
      state: null,
    };
    const nextEntry: HistoryEntry = {
      href: entry.href,
      scroll: readScroll(),
      state: state ?? null,
    };

    window.history.replaceState(
      nextEntry.state,
      '',
      nextEntry.href,
    );
    history.commitUpdate({ ...history.createDefaultUpdate(), nextEntry }, nextEntry.href);
    dispatchRouterLocationChange();

    if (currentState) {
      currentState = applyHistoryStateToRoute(currentState, nextEntry.state);
      notifyStateChange();
    }
  }

  function shouldUseViewTransition(
    context: ViewTransitionContext,
  ): boolean {
    const routeOverride = context.routeConfig?.viewTransition;
    if (routeOverride !== undefined) return routeOverride;

    return typeof viewTransitions === 'function'
      ? viewTransitions(context)
      : viewTransitions;
  }

  function runWithViewTransition(
    context: ViewTransitionContext,
    action: () => void,
  ): void {
    if (!shouldUseViewTransition(context)) {
      action();
      return;
    }

    const transitionDocument = document as Document & {
      startViewTransition?: (
        callback: () => void | PromiseLike<void>,
      ) => { finished: PromiseLike<unknown> };
    };
    const startViewTransition = transitionDocument.startViewTransition;

    if (typeof startViewTransition !== 'function') {
      action();
      return;
    }

    try {
      void Promise.resolve(
        startViewTransition.call(transitionDocument, () => action()).finished,
      ).catch(error => trace('View transition failed', error));
    } catch (error) {
      trace('View transition setup failed', error);
      action();
    }
  }

  function notifyOutletActivate(outlet: HTMLElement, component: unknown): void {
    config.onOutletActivate?.(outlet, component);
  }

  function createCompletion(): { completion: NavigationCompletion; promise: Promise<boolean> } {
    let resolve!: (success: boolean) => void;
    const promise = new Promise<boolean>(completion => {
      resolve = completion;
    });
    return { completion: { settled: false, resolve }, promise };
  }

  function settleRequest(request: NavigationRequest, success: boolean): void {
    if (request.completion.settled) return;
    request.completion.settled = true;
    request.completion.resolve(success);
  }

  function cancelActiveNavigation(): void {
    activeController?.abort();
    activeController = null;
    if (requestState) settleRequest(requestState, false);
  }

  function createRequest(
    url: URL,
    redirectCount: number,
    completion: NavigationCompletion | undefined,
    historyUpdate: HistoryUpdate,
    run: (request: NavigationRequest, signal: AbortSignal) => Promise<void>,
  ): Promise<boolean> {
    const pending = completion ? null : createCompletion();
    const request: NavigationRequest = {
      id: ++navigationId,
      url,
      redirectCount,
      completion: completion ?? pending!.completion,
      historyUpdate,
    };
    if (!completion) cancelActiveNavigation();
    latestRequestId = request.id;
    requestState = request;
    errorState = null;
    notifyStateChange();

    const controller = new AbortController();
    activeController = controller;
    void run(request, controller.signal);
    return pending?.promise ?? Promise.resolve(false);
  }

  function requestNavigation(
    url: URL,
    redirectCount = 0,
    completion?: NavigationCompletion,
    historyUpdate: HistoryUpdate = history.createDefaultUpdate(),
  ): Promise<boolean> {
    return createRequest(
      url,
      redirectCount,
      completion,
      historyUpdate,
      runNavigation,
    );
  }

  function requestExternalNavigation(
    url: URL,
    completion?: NavigationCompletion,
    historyUpdate: HistoryUpdate = history.createDefaultUpdate(),
  ): Promise<boolean> {
    return createRequest(
      url,
      0,
      completion,
      historyUpdate,
      runExternalNavigation,
    );
  }

  function notifyStateChange(): void {
    config.onStateChange?.(publicState);
  }

  function setPhase(
    request: NavigationRequest,
    phase: NavigationPhase,
  ): void {
    if (request.id !== latestRequestId) {
      return;
    }

    navigationPhase = phase;
    notifyStateChange();
  }

  function getRoutePattern(route: Route): RoutePattern {
    const cached = routePatterns.get(route);
    if (cached && cached.path === route.path) {
      return cached;
    }

    const segments = splitPath(route.path);
    const pattern: RoutePattern = {
      path: route.path,
      segments,
      parameterNames: segments.map(segment =>
        segment.startsWith(':')
          ? segment.slice(1)
          : null,
      ),
    };

    routePatterns.set(route, pattern);
    return pattern;
  }

  function matchPattern(
    pattern: RoutePattern,
    segments: readonly string[],
    params: Record<string, string>,
  ): boolean {
    for (let index = 0; index < pattern.segments.length; index++) {
      const expected = pattern.segments[index];
      const actual = segments[index];

      if (actual === undefined) {
        return false;
      }

      const parameterName = pattern.parameterNames[index];
      if (parameterName) {
        params[parameterName] = decodeSegment(actual);
        continue;
      }

      if (expected !== actual) {
        return false;
      }
    }

    return true;
  }

  function recognize(path: string): RouteMatch | null {
    const segments = splitPath(path);
    let fallback: Route | undefined;

    for (const route of config.routes) {
      if (route.path === '**' || route.path === '*') {
        fallback = route;
        continue;
      }

      const pattern = getRoutePattern(route);
      if (pattern.segments.length !== segments.length) {
        continue;
      }

      const params: Record<string, string> = {};
      if (matchPattern(pattern, segments, params)) {
        return {
          route,
          params: Object.freeze(params),
        };
      }
    }

    return fallback
      ? { route: fallback, params: Object.freeze({}) }
      : null;
  }

  async function runPreloading(): Promise<void> {
    if (disposed) {
      return;
    }

    for (const route of config.routes) {
      if (route.preload === false) {
        continue;
      }

      const group = [route, ...(route.outlets ?? [])];
      for (const member of group) {
        try {
          const loaded = await loadRoute(member);
          if (member !== route && (loaded.parseParams || loaded.parseQuery)) {
            throw new Error(
              `Outlet "${member.outlet}" cannot define parseParams or parseQuery`,
            );
          }
        } catch (error) {
          trace('Route preload failed', member.path, member.outlet ?? '', error);
        }
      }
    }
  }

  function preload(): Promise<void> {
    preloadQueued = false;
    preloadTask ??= runPreloading().finally(() => {
      preloadTask = null;
    });
    return preloadTask;
  }

  function cancelScheduledPreloading(): void {
    if (preloadIdleId !== null) {
      const cancelIdle = (window as Window & {
        cancelIdleCallback?: (id: number) => void;
      }).cancelIdleCallback;

      cancelIdle?.(preloadIdleId);
      preloadIdleId = null;
    }

    if (preloadTimeoutId !== null) {
      window.clearTimeout(preloadTimeoutId);
      preloadTimeoutId = null;
    }

    preloadQueued = false;
  }

  function schedulePreloading(): void {
    if (
      disposed ||
      preloading === 'none' ||
      preloadTask ||
      preloadQueued
    ) {
      return;
    }

    preloadQueued = true;

    const run = () => {
      preloadIdleId = null;
      preloadTimeoutId = null;

      if (disposed || !started) {
        preloadQueued = false;
        return;
      }

      void preload();
    };

    if (preloading === 'eager') {
      queueMicrotask(run);
      return;
    }

    const requestIdle = (window as Window & {
      requestIdleCallback?: (callback: () => void) => number;
    }).requestIdleCallback;

    if (typeof requestIdle === 'function') {
      preloadIdleId = requestIdle(run);
      return;
    }

    preloadTimeoutId = window.setTimeout(run, 0);
  }

  async function runCanDeactivateGuards(
    nextUrl: URL,
    signal: AbortSignal,
  ): Promise<GuardResult> {
    const routes = activeRouteStates.size > 0
      ? [...activeRouteStates.values()]
      : currentState
        ? [currentState]
        : [];

    for (const activeRoute of routes) {
      const context: DeactivationContext = {
        ...activeRoute,
        nextUrl,
        signal,
      };
      const loaded = await loadRoute(activeRoute.config);
      throwIfAborted(signal);

      for (const guard of loaded.canDeactivate ?? []) {
        const result = await executeDeactivationGuard(guard, context);
        throwIfAborted(signal);
        const redirect = readRedirect(result);
        if (redirect) {
          const redirectUrl = resolveAppUrl(redirect.redirectTo, 'href');
          if (redirectUrl.href === nextUrl.href) {
            warn('Ignoring canDeactivate redirect to the pending URL', redirect.redirectTo);
            continue;
          }
          return redirect;
        }
        if (result === false) return false;
      }
    }

    return true;
  }

  async function renderMatchedRoute(
    routeState: ActivatedRoute,
    loaded: LoadedRoute,
    signal: AbortSignal,
  ): Promise<{ node: Node; component?: unknown; rendered: ActiveRender }> {
    const destroyController = new AbortController();
    throwIfAborted(signal);
    if (!loaded.component) {
      throw new Error(`Matched route "${routeState.config.path}" has no component`);
    }
    const output = normalizeRenderedRouteNode(
      await loaded.component(routeState, {
        signal,
        destroySignal: destroyController.signal,
      }),
    );
    throwIfAborted(signal);
    return {
      node: output.node,
      component: output.component,
      rendered: {
        controller: destroyController,
        dispose: () => {
          destroyController.abort();
          output.dispose?.();
        },
      },
    };
  }

  async function performNavigation(
    request: NavigationRequest,
    signal: AbortSignal,
  ): Promise<NavigationResult> {
    trace('Navigation started', request.url.href);
    setPhase(request, 'recognizing');

    if (!isInsideBase(request.url.pathname)) {
      throw new Error(
        `URL "${request.url.pathname}" is outside router base "${baseHref}"`,
      );
    }

    const path = stripBaseHref(request.url.pathname, baseHref);
    const match = recognize(path);
    throwIfAborted(signal);

    setPhase(request, 'guarding');
    const deactivationResult = await runCanDeactivateGuards(request.url, signal);
    if (deactivationResult === false) {
      return { type: 'blocked', request };
    }

    const deactivationRedirect = deactivationResult
      ? readRedirect(deactivationResult)
      : null;
    if (deactivationRedirect) {
      return { type: 'redirect', request, ...deactivationRedirect };
    }

    if (!match) {
      return { type: 'not-found', request };
    }

    const primaryRoute = match.route;
    const routes = [primaryRoute, ...(primaryRoute.outlets ?? [])];
    const historyState = request.historyUpdate.nextEntry?.state ?? null;

    if (primaryRoute.redirectTo) {
      return {
        type: 'redirect',
        request,
        redirectTo: interpolateRedirect(primaryRoute.redirectTo, match.params),
        replace: true,
      };
    }

    let loadedRoutes: LoadedRoute[];
    try {
      loadedRoutes = await Promise.all(routes.map(loadRoute));
    } catch (error) {
      throw new RoutePreparationError(
        error,
        currentState !== null && routes.length > 1,
      );
    }
    throwIfAborted(signal);

    for (let index = 1; index < loadedRoutes.length; index++) {
      if (loadedRoutes[index].parseParams || loadedRoutes[index].parseQuery) {
        throw new Error(
          `Outlet "${routes[index].outlet}" cannot define parseParams or parseQuery`,
        );
      }
    }

    // The primary route owns URL parsing. Secondary outlets share the same
    // validated params and query because they are not independently navigable.
    const primaryLoaded = loadedRoutes[0];
    const [parsedParams, parsedQuery] = await Promise.all([
      primaryLoaded.parseParams
        ? primaryLoaded.parseParams(match.params, request.url, signal)
        : Promise.resolve(
            Object.freeze({ ...match.params }) as RouteParams,
          ),
      primaryLoaded.parseQuery
        ? primaryLoaded.parseQuery(request.url, signal)
        : Promise.resolve(readRawQuery(request.url)),
    ]);
    throwIfAborted(signal);

    const sharedParams = Object.freeze({ ...parsedParams });
    const sharedQuery = Object.freeze({ ...parsedQuery });

    const baseRoutes = routes.map<ActivatedRoute>(route => ({
      url: request.url,
      path,
      params: sharedParams,
      query: sharedQuery,
      data: Object.freeze(route.data ?? {}),
      historyState,
      config: route,
    }));

    for (let index = 0; index < loadedRoutes.length; index++) {
      const context: NavigationContext = {
        ...baseRoutes[index],
        signal,
      };

      for (const guard of loadedRoutes[index].canActivate ?? []) {
        const result = await executeGuard(guard, context);
        throwIfAborted(signal);
        const redirect = readRedirect(result);
        if (redirect) {
          return { type: 'redirect', request, ...redirect };
        }
        if (result === false) {
          return { type: 'blocked', request };
        }
      }
    }

    setPhase(request, 'resolving');

    const activatedRoutes = await Promise.all(
      baseRoutes.map(async (baseRoute, index): Promise<ActiveRoute> => {
        const entries = await Promise.all(
          Object.entries(loadedRoutes[index].resolve ?? {}).map(
            async ([key, resolver]) => [
              key,
              await executeResolver(resolver, { ...baseRoute, signal }),
            ] as const,
          ),
        );
        throwIfAborted(signal);

        return {
          ...baseRoute,
          data: Object.freeze({
            ...baseRoute.data,
            ...Object.fromEntries(entries),
          }),
        };
      }),
    );

    setPhase(request, 'loading');

    const prepared: PreparedOutlet[] = [];
    try {
      for (let index = 0; index < activatedRoutes.length; index++) {
        const route = activatedRoutes[index];
        const rendered = await renderMatchedRoute(
          route,
          loadedRoutes[index],
          signal,
        );
        prepared.push({
          name: route.config.outlet?.trim() ?? '',
          route,
          ...rendered,
        });
      }
    } catch (error) {
      for (let index = prepared.length - 1; index >= 0; index--) {
        try {
          prepared[index].rendered.dispose();
        } catch {}
      }

      throw new RoutePreparationError(
        error,
        currentState !== null && routes.length > 1,
      );
    }

    return {
      type: 'success',
      request,
      route: activatedRoutes[0],
      outlets: Object.freeze(prepared),
    };
  }

  async function runNavigation(request: NavigationRequest, signal: AbortSignal): Promise<void> {
    if (disposed) return;

    try {
      const result = await performNavigation(request, signal);
      if (disposed || result.request.id !== latestRequestId) {
        if (result.type === 'success') {
          for (const outlet of result.outlets) {
            outlet.rendered.dispose();
          }
        }
        return;
      }
      commit(result);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return;
      const preparationError =
        error instanceof RoutePreparationError
          ? error
          : null;
      const failure: NavigationFailure = {
        type: 'error',
        request,
        error: preparationError?.originalError ?? error,
        preserveActive: preparationError?.preserveActive ?? false,
      };
      if (failure.request.id !== latestRequestId) return;
      commit(failure);
    } finally {
      if (activeController?.signal === signal) {
        activeController = null;
      }
    }
  }

  async function runExternalNavigation(
    request: NavigationRequest,
    signal: AbortSignal,
  ): Promise<void> {
    if (disposed) {
      settleRequest(request, false);
      return;
    }

    try {
      setPhase(request, 'guarding');

      const deactivationResult =
        await runCanDeactivateGuards(
          request.url,
          signal,
        );

      throwIfAborted(signal);

      if (request.id !== latestRequestId) {
        return;
      }

      const redirect =
        deactivationResult
          ? readRedirect(
              deactivationResult,
            )
          : null;

      if (redirect) {
        const redirectUrl =
          resolveAppUrl(
            redirect.redirectTo,
            'href',
          );

        if (
          redirectUrl.origin !==
          window.location.origin
        ) {
          requestState = null;
          navigationPhase = null;
          errorState = null;
          settleRequest(
            request,
            true,
          );
          notifyStateChange();
          navigateExternal(
            redirectUrl,
          );
          return;
        }

        const href =
          redirectUrl.pathname +
          redirectUrl.search +
          redirectUrl.hash;

        const historyState =
          window.history.state;

        const historyUpdate =
          history.createUpdate(
            href,
            redirect.replace,
            historyState,
          );

        window.history[
          redirect.replace
            ? 'replaceState'
            : 'pushState'
        ](
          historyState,
          '',
          href,
        );

        dispatchRouterLocationChange();

        void requestNavigation(
          redirectUrl,
          0,
          request.completion,
          historyUpdate,
        );

        return;
      }

      if (
        deactivationResult === false
      ) {
        commit({
          type: 'blocked',
          request,
        });
        return;
      }

      requestState = null;
      navigationPhase = null;
      errorState = null;

      settleRequest(
        request,
        true,
      );

      notifyStateChange();
      navigateExternal(
        request.url,
      );
    } catch (error) {
      if (
        signal.aborted ||
        isAbortError(error)
      ) {
        return;
      }

      if (
        request.id !==
        latestRequestId
      ) {
        return;
      }

      commit({
        type: 'error',
        request,
        error,
      });
    } finally {
      if (
        activeController?.signal ===
        signal
      ) {
        activeController = null;
      }
    }
  }

  function commit(result: NavigationResult): void {
    if (disposed || result.request.id !== latestRequestId) return;

    switch (result.type) {
      case 'success': {
        runWithViewTransition({
          url: result.request.url,
          from: currentState,
          to: result.route,
          phase: 'success',
          routeConfig: result.route.config,
        }, () => {
          const nextNames = new Set(result.outlets.map(outlet => outlet.name));

          // A custom group commit remains atomic: old renders stay active until
          // the complete group has committed successfully. The built-in/per-outlet
          // renderer disposes old views first so their disposal hooks still observe
          // the view attached to its outlet.
          if (!commitOutlets) {
            for (const renderInstance of activeRenders.values()) {
              disposeRender(renderInstance);
            }
            activeRenders.clear();
            activeRouteStates.clear();
          }

          try {
            if (commitOutlets) {
              commitOutlets(result.outlets);
            } else {
              for (const outlet of result.outlets) {
                if (outlet.name === '') {
                  renderPrimaryNode(outlet.node, outlet.route);
                } else if (render) {
                  render(outlet.name, outlet.node, outlet.route);
                } else {
                  throw new Error(
                    `No renderer is configured for outlet "${outlet.name}"`,
                  );
                }
              }
            }
          } catch (error) {
            for (const outlet of result.outlets) {
              outlet.rendered.dispose();
            }
            throw error;
          }

          if (commitOutlets) {
            for (const [name] of activeRenders.entries()) {
              if (!nextNames.has(name)) {
                replaceActiveRender(name, null);
                activeRouteStates.delete(name);
              }
            }
          }

          for (const outlet of result.outlets) {
            if (commitOutlets) {
              replaceActiveRender(outlet.name, outlet.rendered);
            } else {
              activeRenders.set(outlet.name, outlet.rendered);
            }
            activeRouteStates.set(outlet.name, outlet.route);

            // The router only knows the concrete DOM target for its default
            // primary outlet. Custom named-outlet renderers own activation hooks.
            if (!commitOutlets && outlet.name === '') {
              const target = outlet.node.parentElement ?? resolveOutlet();
              if (target) {
                notifyOutletActivate(target, outlet.component);
              }
            }
          }
        });
        history.commitUpdate(
          result.request.historyUpdate,
          result.request.url.pathname + result.request.url.search + result.request.url.hash,
        );
        currentState = result.route;
        requestState = null;
        navigationPhase = null;
        errorState = null;
        window.dispatchEvent(new CustomEvent('routechange', { detail: result.route }));
        trace('Navigation completed', result.route.path);
        restoreScroll(result.request.historyUpdate);
        settleRequest(result.request, true);
        notifyStateChange();
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
        if (
          url.origin !==
          window.location.origin
        ) {
          void requestExternalNavigation(
            url,
            result.request.completion,
            result.request.historyUpdate,
          );
          return;
        }

        const href = url.pathname + url.search + url.hash;
        const historyState = window.history.state;
        const historyUpdate = history.createUpdate(href, result.replace, historyState);
        window.history[result.replace ? 'replaceState' : 'pushState'](historyState, '', href);
        dispatchRouterLocationChange();
        void requestNavigation(
          url,
          result.request.redirectCount + 1,
          result.request.completion,
          historyUpdate,
        );
        return;
      }
      case 'blocked': {
        restoreActiveUrl();
        history.rollbackUpdate(result.request.historyUpdate);
        requestState = null;
        navigationPhase = null;
        errorState = null;
        trace('Navigation blocked');
        restorePreviousScroll(result.request.historyUpdate);
        settleRequest(result.request, false);
        notifyStateChange();
        return;
      }
      case 'not-found': {
        runWithViewTransition({
          url: result.request.url,
          from: currentState,
          to: null,
          phase: 'not-found',
          routeConfig: null,
        }, () => {          
          if (renderNotFound) {
            renderNotFound('', result.request.url, publicRouter);
          } else {
            const heading = document.createElement('h1');
            heading.textContent = '404 — Page Not Found';
            renderPrimaryNode(
              heading,
              createStatusRoute(result.request.url),
            );
          }

          disposeAllRenders();
        });
        history.commitUpdate(
          result.request.historyUpdate,
          result.request.url.pathname + result.request.url.search + result.request.url.hash,
        );
        currentState = null;
        requestState = null;
        navigationPhase = null;
        errorState = null;
        trace('Route not found', result.request.url.pathname);
        restoreScroll(result.request.historyUpdate);
        settleRequest(result.request, false);
        notifyStateChange();
        return;
      }
      case 'error': {
        restoreActiveUrl();

        if (!result.preserveActive) {
          runWithViewTransition({
            url: result.request.url,
            from: currentState,
            to: null,
            phase: 'error',
            routeConfig: null,
            error: result.error,
          }, () => {
            if (renderError) {
              renderError('', result.error, publicRouter);
            } else {
              const heading = document.createElement('h1');
              heading.textContent = 'Page failed to load';
              renderPrimaryNode(
                heading,
                createStatusRoute(result.request.url),
              );
            }

            disposeAllRenders();
          });
        }

        history.rollbackUpdate(result.request.historyUpdate);
        if (!result.preserveActive) {
          currentState = null;
        }
        requestState = null;
        navigationPhase = null;
        errorState = result.error;
        trace('Navigation failed', result.error);
        restorePreviousScroll(result.request.historyUpdate);
        settleRequest(result.request, false);
        notifyStateChange();
        return;
      }
    }
  }

  function handlePopState(): void {
    requestNavigation(
      new URL(window.location.href),
      0,
      undefined,
      history.createPopStateUpdate(currentHref()),
    );
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

    event.preventDefault();
    navigate(url);
  }

  function navigate(target: string | URL, options: NavigationOptions = {}): Promise<boolean> {
    if (disposed) throw new Error('Cannot navigate with a disposed router');
    const url = resolveAppUrl(target, 'navigate');

    if (
      url.origin !==
      window.location.origin
    ) {
      return requestExternalNavigation(
        url,
        undefined,
        history.createDefaultUpdate(),
      );
    }

    if (!isInsideBase(url.pathname)) {
      throw new Error(`URL "${url.pathname}" is outside router base "${baseHref}"`);
    }

    if (config.onSameUrlNavigation === 'ignore' && currentState?.url.href === url.href) {
      return Promise.resolve(false);
    }

    const href = url.pathname + url.search + url.hash;
    const historyState = options.state ?? null;
    const historyUpdate = history.createUpdate(href, options.replace ?? false, historyState);
    window.history[options.replace ? 'replaceState' : 'pushState'](historyState, '', href);
    dispatchRouterLocationChange();
    return requestNavigation(url, 0, undefined, historyUpdate);
  }

  function replace(target: string | URL, state?: unknown): Promise<boolean> {
    return navigate(target, { replace: true, state });
  }

  function startRouter(): void {
    if (disposed) {
      throw new Error(
        'Cannot start a disposed router',
      );
    }

    if (started) {
      return;
    }

    started = true;
    window.addEventListener(
      'popstate',
      handlePopState,
    );
    document.addEventListener(
      'click',
      handleClick,
    );
    schedulePreloading();

    // Starting the router must be synchronous from the caller's point of
    // view. Queue initial URL recognition so `state.pending` remains false
    // immediately after start(), and let an explicit navigate() win.
    if (startRequestQueued) {
      return;
    }

    startRequestQueued = true;

    queueMicrotask(() => {
      startRequestQueued = false;

      if (
        !started ||
        disposed ||
        currentState !== null ||
        requestState !== null
      ) {
        return;
      }

      void requestNavigation(
        new URL(window.location.href),
        0,
        undefined,
        history.createDefaultUpdate(),
      );
    });
  }

  function stopRouter(): void {
    cancelScheduledPreloading();

    if (!started) {
      cancelActiveNavigation();
      return;
    }

    window.removeEventListener('popstate', handlePopState);
    document.removeEventListener('click', handleClick);
    cancelActiveNavigation();
    disposeAllRenders();
    clearOutlet();
    started = false;
    startRequestQueued = false;
    requestState = null;
    navigationPhase = null;
    errorState = null;
    currentState = null;
    notifyStateChange();
  }

  function href(target: string): string {
    const url = resolveAppUrl(target, 'href');
    return routerHref(url);
  }

  function createLink(to: string, text: string, className = ''): HTMLAnchorElement {
    const link = document.createElement('a');
    link.href = href(to);
    link.textContent = text;
    if (className) link.className = className;
    return link;
  }

  let publicRouter: Router;

  const publicState: RouterState = {
    get current() {
      if (disposed) return null;
      return currentState;
    },
    get pending() {
      if (disposed) return false;
      return requestState !== null;
    },
    get phase() {
      if (disposed) return null;
      return navigationPhase;
    },
    get error() {
      if (disposed) return null;
      return errorState;
    },
    get path() {
      if (disposed) return '';
      return currentState?.path ?? '';
    },
    get params() {
      if (disposed) return EMPTY_PARAMS;
      return currentState?.params ?? EMPTY_PARAMS;
    },
    get query() {
      if (disposed) return EMPTY_QUERY;
      return currentState?.query ?? EMPTY_QUERY;
    },
    get data() {
      if (disposed) return EMPTY_DATA;
      return currentState?.data ?? EMPTY_DATA;
    },
    get historyState() {
      if (disposed) return null;
      return currentState?.historyState ?? history.createDefaultUpdate().previousEntry?.state ?? null;
    },
    get routeConfig() {
      if (disposed) return null;
      return currentState?.config ?? null;
    },
  };

  publicRouter = {
    state: publicState,
    start: () => startRouter(),
    stop: () => stopRouter(),
    dispose: () => {
      if (disposed) return;
      stopRouter();
      disposed = true;
    },
    navigate: (target, options) => navigate(target, options),
    replace: (target, state) => replace(target, state),
    updateHistoryState: (state) => updateHistoryState(state),
    preload: () => preload(),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    href: (target) => href(target),
    createLink: (to, text, className) => createLink(to, text, className),
  };

  return publicRouter;
}

export type VanillaRouterInstance = ReturnType<typeof createRouter>;