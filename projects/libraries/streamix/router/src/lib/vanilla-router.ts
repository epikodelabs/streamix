import { dispatchRouterLocationChange } from './router-events';
import {
  isPathInsideBase,
  normalizeBaseHref,
  normalizePath,
  resolveRouterUrl,
  routerHref,
  stripBaseHref,
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
  render?: (outlet: HTMLElement, node: Node, route: ActivatedRoute) => void;
  renderNotFound?: (outlet: HTMLElement, url: URL, router: Router) => void;
  renderError?: (outlet: HTMLElement, error: unknown, router: Router) => void;
  onStateChange?: (state: RouterState) => void;
}

interface NavigationRequest {
  readonly id: number;
  readonly url: URL;
  readonly redirectCount: number;
  readonly completion: NavigationCompletion;
  readonly historyUpdate: HistoryUpdate;
}

interface NavigationCompletion {
  settled: boolean;
  resolve(success: boolean): void;
}

interface ScrollPosition {
  readonly x: number;
  readonly y: number;
}

interface HistoryEntry {
  readonly href: string;
  readonly scroll: ScrollPosition;
  readonly state: unknown;
}

interface HistoryUpdate {
  readonly type: 'none' | 'push' | 'replace' | 'popstate';
  readonly previousIndex: number;
  readonly nextIndex: number;
  readonly previousEntry?: HistoryEntry;
  readonly previousScroll: ScrollPosition;
  readonly nextEntry?: HistoryEntry;
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

interface NavigationSuccess {
  type: 'success';
  request: NavigationRequest;
  route: ActiveRoute;
  node: Node;
  component?: unknown;
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
const ZERO_SCROLL: ScrollPosition = Object.freeze({ x: 0, y: 0 });

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


function isRenderedRouteNode(value: unknown): value is RenderedRouteNode {
  return value !== null && typeof value === 'object' && 'node' in value;
}

function normalizeRenderedRouteNode(value: Node | RenderedRouteNode): RenderedRouteNode {
  return isRenderedRouteNode(value) ? value : { node: value };
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

function defaultRenderNotFound(outlet: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.textContent = '404 \u2014 Page Not Found';
  outlet.replaceChildren(heading);
}

function defaultRenderError(outlet: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.textContent = 'Page failed to load';
  outlet.replaceChildren(heading);
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
  const render = config.render ?? defaultRender;
  const renderNotFound = config.renderNotFound ?? defaultRenderNotFound;
  const renderError = config.renderError ?? defaultRenderError;
  const navigateExternal = config.navigateExternal ?? ((url: URL) => window.location.assign(url.href));
  const baseHref = normalizeBaseHref(config.baseHref ?? '/');
  const maxRedirects = config.maxRedirects ?? 10;
  const scrollRestoration = config.scrollRestoration ?? 'preserve';
  const preloading = config.preloading ?? 'none';
  const viewTransitions = config.viewTransitions ?? false;

  const routePatterns = new WeakMap<Route, RoutePattern>();

  let currentState: ActiveRoute | null = null;
  let requestState: NavigationRequest | null = null;
  let phaseState: NavigationPhase = null;
  let errorState: unknown = null;

  let started = false;
  let disposed = false;
  let navigationId = 0;
  let latestRequestId = 0;
  let activeController: AbortController | null = null;
  let activeRender: ActiveRender | null = null;
  let startRequestQueued = false;
  let historyEntries: HistoryEntry[] = [];
  let historyIndex = -1;
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

  function currentHref(): string {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function readScroll(): ScrollPosition {
    return {
      x: window.scrollX,
      y: window.scrollY,
    };
  }

  function readHistoryState(): unknown {
    return window.history.state ?? null;
  }

  function scrollToPosition(position: ScrollPosition): void {
    window.scrollTo(position.x, position.y);
  }

  function ensureHistoryEntry(): void {
    if (historyEntries.length > 0) {
      return;
    }

    historyEntries = [{
      href: currentHref(),
      scroll: readScroll(),
      state: readHistoryState(),
    }];
    historyIndex = 0;
  }

  function saveCurrentScroll(): ScrollPosition {
    const scroll = readScroll();
    if (historyIndex >= 0) {
      const entry = historyEntries[historyIndex];
      if (entry) {
        historyEntries[historyIndex] = {
          href: entry.href,
          scroll,
          state: entry.state,
        };
      }
    }
    return scroll;
  }

  function createDefaultHistoryUpdate(): HistoryUpdate {
    ensureHistoryEntry();

    return {
      type: 'none',
      previousIndex: historyIndex,
      nextIndex: historyIndex,
      previousScroll: readScroll(),
      previousEntry:
        historyEntries[historyIndex],
    };
  }

  function createHistoryUpdate(
    href: string,
    replace: boolean,
    state: unknown,
  ): HistoryUpdate {
    ensureHistoryEntry();
    const previousScroll = saveCurrentScroll();
    const previousIndex = historyIndex;
    const nextEntry: HistoryEntry = {
      href,
      scroll: replace ? previousScroll : ZERO_SCROLL,
      state: state ?? null,
    };

    if (replace) {
      const previousEntry = historyEntries[historyIndex];
      historyEntries[historyIndex] = nextEntry;
      return {
        type: 'replace',
        previousIndex,
        nextIndex: historyIndex,
        previousEntry,
        previousScroll,
        nextEntry,
      };
    }

    historyEntries = historyEntries.slice(0, historyIndex + 1);
    historyEntries.push(nextEntry);
    return {
      type: 'push',
      previousIndex,
      nextIndex: historyIndex + 1,
      previousScroll,
      previousEntry: historyEntries[previousIndex],
      nextEntry,
    };
  }

  function findHistoryIndexByHref(href: string): number {
    if (historyEntries.length === 0) {
      return -1;
    }

    const previous = historyEntries[historyIndex - 1];
    if (previous?.href === href) {
      return historyIndex - 1;
    }

    const next = historyEntries[historyIndex + 1];
    if (next?.href === href) {
      return historyIndex + 1;
    }

    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < historyEntries.length; index++) {
      if (historyEntries[index]?.href !== href || index === historyIndex) {
        continue;
      }

      const distance = Math.abs(index - historyIndex);
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    }

    return bestIndex;
  }

  function createPopStateHistoryUpdate(href: string): HistoryUpdate {
    ensureHistoryEntry();
    const previousScroll = saveCurrentScroll();
    const previousIndex = historyIndex;
    const resolvedIndex = findHistoryIndexByHref(href);
    const nextIndex = resolvedIndex >= 0 ? resolvedIndex : previousIndex;
    const nextEntry = historyEntries[nextIndex]
      ? {
          ...historyEntries[nextIndex]!,
          href,
          state: readHistoryState(),
        }
      : {
          href,
          scroll: ZERO_SCROLL,
          state: readHistoryState(),
        };

    return {
      type: 'popstate',
      previousIndex,
      nextIndex,
      previousScroll,
      previousEntry: historyEntries[previousIndex],
      nextEntry,
    };
  }

  function rollbackHistoryUpdate(update: HistoryUpdate): void {
    switch (update.type) {
      case 'push':
        historyEntries = historyEntries.slice(0, update.previousIndex + 1);
        historyIndex = update.previousIndex;
        return;
      case 'replace':
        if (update.previousEntry && update.previousIndex >= 0) {
          historyEntries[update.previousIndex] = update.previousEntry;
        }
        historyIndex = update.previousIndex;
        return;
      case 'popstate':
      case 'none':
        historyIndex = update.previousIndex;
        return;
    }
  }

  function commitHistoryUpdate(update: HistoryUpdate, href: string): void {
    switch (update.type) {
      case 'push':
      case 'replace':
        historyIndex = update.nextIndex;
        historyEntries[historyIndex] = update.nextEntry ?? {
          href,
          scroll: update.type === 'replace' ? update.previousScroll : ZERO_SCROLL,
          state: null,
        };
        return;
      case 'popstate': {
        historyIndex = update.nextIndex;
        const existingEntry = historyEntries[historyIndex];
        historyEntries[historyIndex] = existingEntry
          ? {
              href,
              scroll: existingEntry.scroll,
              state: update.nextEntry?.state ?? existingEntry.state,
            }
          : update.nextEntry ?? {
              href,
              scroll: ZERO_SCROLL,
              state: null,
            };
        return;
      }
      case 'none':
        ensureHistoryEntry();
        return;
    }
  }

  function restoreScroll(update: HistoryUpdate): void {
    if (scrollRestoration === 'preserve') {
      return;
    }

    if (scrollRestoration === 'restore' && update.type === 'popstate') {
      scrollToPosition(historyEntries[update.nextIndex]?.scroll ?? ZERO_SCROLL);
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
    ensureHistoryEntry();

    const active = activeHref();
    const fallback =
      historyEntries[historyIndex]
        ?.href ??
      historyEntries[0]
        ?.href ??
      currentHref();

    const href =
      active ?? fallback;

    window.history.replaceState(
      currentState?.historyState ??
        historyEntries[historyIndex]
          ?.state ??
        null,
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

  function updateCurrentHistoryEntry(entry: HistoryEntry): void {
    if (historyIndex < 0) {
      return;
    }
    historyEntries[historyIndex] = entry;
  }

  function updateHistoryState(state: unknown): void {
    if (disposed) {
      throw new Error('Cannot update history state on a disposed router');
    }

    ensureHistoryEntry();
    const entry = historyEntries[historyIndex] ?? {
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
    updateCurrentHistoryEntry(nextEntry);
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
    historyUpdate: HistoryUpdate = createDefaultHistoryUpdate(),
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
    historyUpdate: HistoryUpdate = createDefaultHistoryUpdate(),
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

  function setPhase(request: NavigationRequest, phase: NavigationPhase): void {
    if (request.id !== latestRequestId) return;
    phaseState = phase;
    notifyStateChange();
  }

  function getRoutePattern(route: Route): RoutePattern {
    const cached = routePatterns.get(route);
    if (cached && cached.path === route.path) return cached;

    const segments = splitPath(route.path);
    const pattern: RoutePattern = {
      path: route.path,
      segments,
      parameterNames: segments.map(segment => segment.startsWith(':') ? segment.slice(1) : null),
    };
    routePatterns.set(route, pattern);
    return pattern;
  }

  function shouldPreloadRoute(route: Route): boolean {
    return route.preload !== false;
  }

  async function preloadRoute(route: Route, seen: WeakSet<Route>): Promise<void> {
    if (seen.has(route) || !shouldPreloadRoute(route)) return;
    seen.add(route);
    try { await loadRoute(route); }
    catch (error) { trace('Route preload failed', route.path, error); }
  }

  async function runPreloading(): Promise<void> {
    if (disposed) {
      return;
    }

    const seen = new WeakSet<Route>();
    for (const route of config.routes) {
      await preloadRoute(route, seen);
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
      const cancelIdle =
        (window as Window & {
          cancelIdleCallback?: (
            id: number,
          ) => void;
        }).cancelIdleCallback;

      cancelIdle?.(preloadIdleId);
      preloadIdleId = null;
    }

    if (preloadTimeoutId !== null) {
      window.clearTimeout(
        preloadTimeoutId,
      );
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

    const requestIdle =
      (window as Window & {
        requestIdleCallback?: (
          callback: () => void,
        ) => number;
      }).requestIdleCallback;

    if (typeof requestIdle === 'function') {
      preloadIdleId =
        requestIdle(run);
      return;
    }

    preloadTimeoutId =
      window.setTimeout(
        run,
        0,
      );
  }

  async function runCanDeactivateGuards(
    nextUrl: URL,
    signal: AbortSignal
  ): Promise<GuardResult> {
    const activeRoute = currentState;
    if (!activeRoute) return true;

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

    return true;
  }

  async function renderMatchedRoute(
    routeState: ActivatedRoute,
    signal: AbortSignal,
  ): Promise<{ node: Node; component?: unknown; rendered: ActiveRender }> {
    const destroyController = new AbortController();
    const loaded = await loadRoute(routeState.config);
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

  function recognize(routes: readonly Route[], segments: readonly string[]): RouteMatch | null {
    let fallback: Route | undefined;
    for (const route of routes) {
      if (route.path === '**' || route.path === '*') {
        fallback = route;
        continue;
      }
      const pattern = getRoutePattern(route);
      if (pattern.segments.length !== segments.length) continue;
      const params: Record<string, string> = {};
      if (matchPattern(pattern, segments, 0, params)) return { route, params };
    }
    return fallback ? { route: fallback, params: {} } : null;
  }

  function matchPattern(
    pattern: RoutePattern,
    segments: readonly string[],
    segmentIndex: number,
    params: Record<string, string>,
  ): boolean {
    for (let i = 0; i < pattern.segments.length; i++) {
      const expected = pattern.segments[i];
      const actual = segments[segmentIndex + i];

      if (actual === undefined) {
        return false;
      }

      const parameterName = pattern.parameterNames[i];
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

  async function performNavigation(request: NavigationRequest, signal: AbortSignal): Promise<NavigationResult> {
    trace('Navigation started', request.url.href);
    setPhase(request, 'recognizing');

    if (!isInsideBase(request.url.pathname)) {
      throw new Error(`URL "${request.url.pathname}" is outside router base "${baseHref}"`);
    }

    const path = stripBaseHref(request.url.pathname, baseHref);
    const match = recognize(config.routes, splitPath(path));
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

    const staticData = {
      ...(match.route.data ?? {}),
    };

    const historyState =
      request.historyUpdate
        .nextEntry?.state ??
      readHistoryState();

    if (match.route.redirectTo) {
      return {
        type: 'redirect',
        request,
        redirectTo:
          interpolateRedirect(
            match.route.redirectTo,
            match.params,
          ),
        replace: true,
      };
    }

    const loadedRoute =
      await loadRoute(
        match.route,
      );

    throwIfAborted(signal);

    // Parse URL-derived values before guards and resolvers. Public route
    // contexts therefore never expose unvalidated path or query strings.
    const [
      parsedParams,
      parsedQuery,
    ] = await Promise.all([
      loadedRoute.parseParams
        ? loadedRoute.parseParams(
            match.params,
            request.url,
            signal,
          )
        : Promise.resolve(
            Object.freeze({
              ...match.params,
            }) as RouteParams,
          ),

      loadedRoute.parseQuery
        ? loadedRoute.parseQuery(
            request.url,
            signal,
          )
        : Promise.resolve(
            Object.freeze(
              Object.fromEntries(request.url.searchParams),
            ) as RouteQuery,
          ),
    ]);

    throwIfAborted(signal);

    const baseRoute:
      ActivatedRoute = {
      url: request.url,
      path,
      params:
        Object.freeze({
          ...parsedParams,
        }),
      query:
        Object.freeze({
          ...parsedQuery,
        }),
      data:
        Object.freeze({
          ...staticData,
        }),
      historyState,
      config:
        match.route,
    };

    const guardContext:
      NavigationContext = {
      ...baseRoute,
      signal,
    };

    for (
      const guard
      of loadedRoute.canActivate ?? []
    ) {
      const result =
        await executeGuard(
          guard,
          guardContext,
        );

      throwIfAborted(signal);

      const redirect =
        readRedirect(result);

      if (redirect) {
        return {
          type: 'redirect',
          request,
          ...redirect,
        };
      }

      if (result === false) {
        return {
          type: 'blocked',
          request,
        };
      }
    }

    setPhase(
      request,
      'resolving',
    );

    const resolvedData:
      Record<string, unknown> = {};

    const resolveContext:
      NavigationContext = {
      ...baseRoute,
      signal,
    };

    const values =
      await Promise.all(
        Object.entries(
          loadedRoute.resolve ?? {},
        ).map(
          async (
            [key, resolver],
          ) => {
            const value =
              await executeResolver(
                resolver,
                resolveContext,
              );

            return [
              key,
              value,
            ] as const;
          },
        ),
      );

    throwIfAborted(signal);

    Object.assign(
      resolvedData,
      Object.fromEntries(values),
    );

    const activatedRoute:
      ActiveRoute = {
      ...baseRoute,
      data:
        Object.freeze({
          ...staticData,
          ...resolvedData,
        }),
    };

    setPhase(request, 'loading');
    const { node, component, rendered } = await renderMatchedRoute(activatedRoute, signal);
    return { type: 'success', request, route: activatedRoute, node, component, rendered };
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
          requestState = null;
          phaseState = null;
          errorState = null;
          settleRequest(request, true);
          notifyStateChange();
          navigateExternal(url);
          return;
        }

        const href = url.pathname + url.search + url.hash;
        const historyState = window.history.state;
        const historyUpdate = createHistoryUpdate(href, redirect.replace, historyState);
        window.history[redirect.replace ? 'replaceState' : 'pushState'](historyState, '', href);
        dispatchRouterLocationChange();
        void requestNavigation(url, 0, request.completion, historyUpdate);
        return;
      }

      if (deactivationResult === false) {
        commit({ type: 'blocked', request });
        return;
      }

      requestState = null;
      phaseState = null;
      errorState = null;
      settleRequest(request, true);
      notifyStateChange();
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
          replaceActiveRender(result.rendered);
          const outlet = resolveOutlet();
          if (outlet) {
            render(outlet, result.node, result.route);
            notifyOutletActivate(outlet, result.component);
          }
        });
        commitHistoryUpdate(
          result.request.historyUpdate,
          result.request.url.pathname + result.request.url.search + result.request.url.hash,
        );
        currentState = result.route;
        requestState = null;
        phaseState = null;
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
        if (url.origin !== window.location.origin) {
          void requestExternalNavigation(
            url,
            result.request.completion,
            result.request.historyUpdate,
          );
          return;
        }

        const href = url.pathname + url.search + url.hash;
        const historyState = window.history.state;
        const historyUpdate = createHistoryUpdate(href, result.replace, historyState);
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
        rollbackHistoryUpdate(result.request.historyUpdate);
        requestState = null;
        phaseState = null;
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
          const outlet = resolveOutlet();
          if (outlet) renderNotFound(outlet, result.request.url, publicRouter);
          replaceActiveRender(null);
        });
        commitHistoryUpdate(
          result.request.historyUpdate,
          result.request.url.pathname + result.request.url.search + result.request.url.hash,
        );
        currentState = null;
        requestState = null;
        phaseState = null;
        errorState = null;
        trace('Route not found', result.request.url.pathname);
        restoreScroll(result.request.historyUpdate);
        settleRequest(result.request, false);
        notifyStateChange();
        return;
      }
      case 'error': {
        restoreActiveUrl();
        runWithViewTransition({
          url: result.request.url,
          from: currentState,
          to: null,
          phase: 'error',
          routeConfig: null,
          error: result.error,
        }, () => {
          const outlet = resolveOutlet();
          if (outlet) renderError(outlet, result.error, publicRouter);
          replaceActiveRender(null);
        });
        rollbackHistoryUpdate(result.request.historyUpdate);
        currentState = null;
        requestState = null;
        phaseState = null;
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
      createPopStateHistoryUpdate(currentHref()),
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

    if (url.origin !== window.location.origin) {
      return requestExternalNavigation(url, undefined, createDefaultHistoryUpdate());
    }

    if (!isInsideBase(url.pathname)) {
      throw new Error(`URL "${url.pathname}" is outside router base "${baseHref}"`);
    }

    if (config.onSameUrlNavigation === 'ignore' && currentState?.url.href === url.href) {
      return Promise.resolve(false);
    }

    const href = url.pathname + url.search + url.hash;
    const historyState = options.state ?? null;
    const historyUpdate = createHistoryUpdate(href, options.replace ?? false, historyState);
    window.history[options.replace ? 'replaceState' : 'pushState'](historyState, '', href);
    dispatchRouterLocationChange();
    return requestNavigation(url, 0, undefined, historyUpdate);
  }

  function replace(target: string | URL, state?: unknown): Promise<boolean> {
    return navigate(target, { replace: true, state });
  }

  function startRouter(): void {
    if (disposed) throw new Error('Cannot start a disposed router');
    if (started) return;

    ensureHistoryEntry();
    started = true;
    window.addEventListener('popstate', handlePopState);
    document.addEventListener('click', handleClick);
    schedulePreloading();

    if (startRequestQueued) return;
    startRequestQueued = true;
    queueMicrotask(() => {
      startRequestQueued = false;
      if (!started || disposed || currentState !== null || requestState !== null) return;
      requestNavigation(
        new URL(window.location.href),
        0,
        undefined,
        createDefaultHistoryUpdate(),
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
    replaceActiveRender(null);
    clearOutlet();
    started = false;
    requestState = null;
    phaseState = null;
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
      return phaseState;
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
      return currentState?.historyState ?? readHistoryState();
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