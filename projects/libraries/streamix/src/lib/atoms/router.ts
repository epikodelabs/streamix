import {
    atom,
    flow,
    method,
    scope,
} from '@epikodelabs/streamix';

export type MaybePromise<T> = T | Promise<T>;

export type RouteParams =
  Readonly<Record<string, string>>;

export type QueryParams =
  Readonly<Record<string, string>>;

export type RouteData =
  Readonly<Record<string, unknown>>;

export interface ActivatedRoute {
  readonly url: URL;
  readonly path: string;
  readonly params: RouteParams;
  readonly queryParams: QueryParams;
  readonly data: RouteData;
  readonly config: Route;
}

export interface NavigationContext
  extends ActivatedRoute {
  readonly signal: AbortSignal;
}

export type GuardResult =
  | boolean
  | string
  | {
      redirectTo: string;
      replace?: boolean;
    };

export type CanActivate =
  | ((
      route: NavigationContext
    ) => MaybePromise<GuardResult>)
  | {
      canActivate(
        route: NavigationContext
      ): MaybePromise<GuardResult>;
    };

export type Resolve<T = unknown> =
  | ((
      route: NavigationContext
    ) => MaybePromise<T>)
  | {
      resolve(
        route: NavigationContext
      ): MaybePromise<T>;
    };

export type RouteComponent = (
  route: ActivatedRoute
) => MaybePromise<Node>;

export interface Route {
  /**
   * Paths are relative to their parent.
   *
   * Use:
   * - "" for an index route
   * - ":id" for a parameter
   * - "**" for the fallback route
   */
  path: string;

  loadComponent?: () => MaybePromise<
    RouteComponent |
    { default: RouteComponent }
  >;

  loadChildren?: () => MaybePromise<
    Route[] |
    { default: Route[] }
  >;

  redirectTo?: string;
  data?: Record<string, unknown>;
  children?: Route[];
  canActivate?: CanActivate[];
  resolve?: Record<string, Resolve>;
}

export type NavigationPhase =
  | 'recognizing'
  | 'guarding'
  | 'resolving'
  | 'loading'
  | null;

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

  navigate(
    target: string | URL,
    options?: NavigationOptions
  ): void;

  replace(
    target: string | URL,
    state?: unknown
  ): void;

  back(): void;
  forward(): void;

  href(target: string): string;

  createLink(
    to: string,
    text: string,
    className?: string
  ): HTMLAnchorElement;
}

export interface RouterConfig {
  routes: Route[];

  outlet?: HTMLElement | null;
  baseHref?: string;
  enableTracing?: boolean;
  maxRedirects?: number;

  /**
   * Rendering is synchronous by design.
   * Components are prepared before commit, preventing stale
   * navigation from overwriting a newer page.
   */
  render?: (
    outlet: HTMLElement,
    node: Node,
    route: ActivatedRoute
  ) => void;

  /**
   * Used only when initial navigation fails and there is no
   * previously committed page to preserve.
   */
  renderError?: (
    outlet: HTMLElement,
    error: unknown
  ) => void;
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
  readonly type: 'success';
  readonly request: NavigationRequest;
  readonly route: ActivatedRoute;
  readonly node: Node;
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

interface NavigationFailure {
  readonly type: 'error';
  readonly request: NavigationRequest;
  readonly error: unknown;
}

type NavigationResult =
  | NavigationSuccess
  | NavigationRedirect
  | NavigationBlocked
  | NavigationFailure;

interface MutableRouterState {
  current: ActivatedRoute | null;
  request: NavigationRequest | null;
  phase: NavigationPhase;
  error: unknown;
}

interface RouterMethods {
  start(): void;
  stop(): void;

  navigate(
    target: string | URL,
    options?: NavigationOptions
  ): void;

  replace(
    target: string | URL,
    state?: unknown
  ): void;

  back(): void;
  forward(): void;

  href(target: string): string;

  createLink(
    to: string,
    text: string,
    className?: string
  ): HTMLAnchorElement;
}

interface InternalRouter
  extends MutableRouterState,
    RouterMethods {
  readonly pending: boolean;
  readonly path: string;
  readonly params: RouteParams;
  readonly query: QueryParams;
  readonly data: RouteData;
  readonly routeConfig: Route | null;

  readonly at: {
    readonly navigation: {
      subscribe(
        callback: (
          result: NavigationResult
        ) => MaybePromise<void>
      ): (() => void) | void;
    };
  };

  dispose(): void;
}

const EMPTY_PARAMS: RouteParams =
  Object.freeze({});

const EMPTY_QUERY: QueryParams =
  Object.freeze({});

const EMPTY_DATA: RouteData =
  Object.freeze({});

function normalizePath(
  path: string
): string {
  const normalized =
    `/${path}`.replace(/\/+/g, '/');

  return (
    normalized.length > 1 &&
    normalized.endsWith('/')
  )
    ? normalized.slice(0, -1)
    : normalized;
}

function splitPath(
  path: string
): string[] {
  return normalizePath(path)
    .split('/')
    .filter(Boolean);
}

function decodeSegment(
  value: string
): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readQuery(
  url: URL
): QueryParams {
  return Object.freeze(
    Object.fromEntries(
      url.searchParams.entries()
    )
  );
}

function unwrapDefault<T>(
  value: T | { default: T }
): T {
  if (
    value !== null &&
    typeof value === 'object' &&
    'default' in value
  ) {
    return (
      value as { default: T }
    ).default;
  }

  return value as T;
}

function executeGuard(
  guard: CanActivate,
  route: NavigationContext
): MaybePromise<GuardResult> {
  return typeof guard === 'function'
    ? guard(route)
    : guard.canActivate(route);
}

function executeResolver(
  resolver: Resolve,
  route: NavigationContext
): MaybePromise<unknown> {
  return typeof resolver === 'function'
    ? resolver(route)
    : resolver.resolve(route);
}

function throwIfAborted(
  signal: AbortSignal
): void {
  if (signal.aborted) {
    throw new DOMException(
      'Navigation aborted',
      'AbortError'
    );
  }
}

function isAbortError(
  error: unknown
): boolean {
  return (
    error instanceof DOMException &&
    error.name === 'AbortError'
  );
}

function interpolateRedirect(
  redirectTo: string,
  params: RouteParams
): string {
  return redirectTo.replace(
    /:([A-Za-z0-9_]+)/g,
    (_, key: string) =>
      encodeURIComponent(
        params[key] ?? ''
      )
  );
}

function readRedirect(
  result: GuardResult
): {
  redirectTo: string;
  replace: boolean;
} | null {
  if (typeof result === 'string') {
    return {
      redirectTo: result,
      replace: true,
    };
  }

  if (
    result &&
    typeof result === 'object' &&
    'redirectTo' in result
  ) {
    return {
      redirectTo:
        result.redirectTo,
      replace:
        result.replace ?? true,
    };
  }

  return null;
}

function defaultRender(
  outlet: HTMLElement,
  node: Node
): void {
  outlet.replaceChildren(node);
}

function defaultRenderError(
  outlet: HTMLElement
): void {
  const heading =
    document.createElement('h1');

  heading.textContent =
    'Page failed to load';

  outlet.replaceChildren(heading);
}

export function createRouter(
  config: RouterConfig
): Router {
  const outlet =
    config.outlet ??
    document.getElementById('app');

  const render =
    config.render ??
    defaultRender;

  const renderError =
    config.renderError ??
    defaultRenderError;

  const baseHref = normalizePath(
    config.baseHref ?? '/'
  );

  const maxRedirects =
    config.maxRedirects ?? 10;

  const requests =
    atom<NavigationRequest | null>(null);

  const lazyChildren =
    new WeakMap<
      Route,
      Promise<Route[]>
    >();

  let started = false;
  let disposed = false;
  let navigationId = 0;

  let unsubscribeNavigation:
    | (() => void)
    | undefined;

  function trace(
    message: string,
    ...values: unknown[]
  ): void {
    if (config.enableTracing) {
      console.debug(
        `[Router] ${message}`,
        ...values
      );
    }
  }

  function isInsideBase(
    pathname: string
  ): boolean {
    return (
      baseHref === '/' ||
      pathname === baseHref ||
      pathname.startsWith(
        `${baseHref}/`
      )
    );
  }

  function stripBaseHref(
    pathname: string
  ): string {
    if (baseHref === '/') {
      return normalizePath(pathname);
    }

    if (!isInsideBase(pathname)) {
      return normalizePath(pathname);
    }

    return normalizePath(
      pathname.slice(
        baseHref.length
      )
    );
  }

  /**
   * All app-relative links, imperative navigation, and redirects
   * pass through this function, so baseHref is always respected.
   */
  function resolveUrl(
    target: string | URL
  ): URL {
    if (target instanceof URL) {
      return target;
    }

    if (
      target.startsWith('?') ||
      target.startsWith('#')
    ) {
      return new URL(
        target,
        window.location.href
      );
    }

    // Preserve fully-qualified URLs.
    if (
      /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(
        target
      )
    ) {
      return new URL(target);
    }

    const relative =
      target.replace(/^\/+/, '');

    const appPath =
      baseHref === '/'
        ? normalizePath(relative)
        : normalizePath(
            `${baseHref}/${relative}`
          );

    return new URL(
      appPath,
      window.location.origin
    );
  }

  function activeHref():
    | string
    | null {
    const url = router.current?.url;

    return url
      ? (
          url.pathname +
          url.search +
          url.hash
        )
      : null;
  }

  function restoreActiveUrl(): void {
    const href = activeHref();

    if (href) {
      window.history.replaceState(
        window.history.state,
        '',
        href
      );
    }
  }

  function requestNavigation(
    url: URL,
    redirectCount = 0
  ): void {
    requests.set({
      id: ++navigationId,
      url,
      redirectCount,
    });
  }

  function setPhase(
    request: NavigationRequest,
    phase: NavigationPhase
  ): void {
    if (
      router.request?.id ===
      request.id
    ) {
      router.phase = phase;
    }
  }

  async function getChildren(
    route: Route
  ): Promise<Route[]> {
    if (route.children) {
      return route.children;
    }

    if (!route.loadChildren) {
      return [];
    }

    let cached =
      lazyChildren.get(route);

    if (!cached) {
      cached = Promise
        .resolve(
          route.loadChildren()
        )
        .then(unwrapDefault)
        .catch(error => {
          lazyChildren.delete(route);
          throw error;
        });

      lazyChildren.set(
        route,
        cached
      );
    }

    return cached;
  }

  async function recognize(
    routes: Route[],
    segments: string[],
    segmentIndex = 0,
    parentParams:
      Record<string, string> = {},
    parentChain: Route[] = []
  ): Promise<RouteMatch | null> {
    let fallback:
      | Route
      | undefined;

    for (const route of routes) {
      if (
        route.path === '**' ||
        route.path === '*'
      ) {
        fallback = route;
        continue;
      }

      const routeSegments =
        splitPath(route.path);

      const params = {
        ...parentParams,
      };

      let matched = true;

      for (
        let index = 0;
        index <
        routeSegments.length;
        index++
      ) {
        const expected =
          routeSegments[index];

        const actual =
          segments[
            segmentIndex + index
          ];

        if (
          actual === undefined
        ) {
          matched = false;
          break;
        }

        if (
          expected.startsWith(':')
        ) {
          params[
            expected.slice(1)
          ] = decodeSegment(actual);

          continue;
        }

        if (expected !== actual) {
          matched = false;
          break;
        }
      }

      if (!matched) {
        continue;
      }

      const nextIndex =
        segmentIndex +
        routeSegments.length;

      const chain = [
        ...parentChain,
        route,
      ];

      const children =
        await getChildren(route);

      if (children.length > 0) {
        const childMatch =
          await recognize(
            children,
            segments,
            nextIndex,
            params,
            chain
          );

        if (childMatch) {
          return childMatch;
        }
      }

      // No prefix fallback. A route matches only when it consumes
      // the complete path. Unknown child paths fall through to **.
      if (
        nextIndex ===
        segments.length
      ) {
        return {
          route,
          chain,
          params,
        };
      }
    }

    if (!fallback) {
      return null;
    }

    return {
      route: fallback,
      chain: [
        ...parentChain,
        fallback,
      ],
      params: {
        ...parentParams,
      },
    };
  }

  async function performNavigation(
    request: NavigationRequest,
    signal?: AbortSignal
  ): Promise<NavigationResult> {
    let controller: AbortController | undefined;
    if (!signal) {
      controller = new AbortController();
      signal = controller.signal;
    }

    trace(
      'Navigation started',
      request.url.href
    );

    setPhase(
      request,
      'recognizing'
    );

    if (
      !isInsideBase(
        request.url.pathname
      )
    ) {
      throw new Error(
        `URL "${request.url.pathname}" is outside router base "${baseHref}"`
      );
    }

    const path =
      stripBaseHref(
        request.url.pathname
      );

    const match =
      await recognize(
        config.routes,
        splitPath(path)
      );

    throwIfAborted(signal);

    if (!match) {
      throw new Error(
        `No route matched "${path}". Add a "**" fallback route.`
      );
    }

    const staticData =
      Object.assign(
        {},
        ...match.chain.map(
          route =>
            route.data ?? {}
        )
      );

    const baseRoute:
      ActivatedRoute = {
        url: request.url,
        path,
        params: Object.freeze({
          ...match.params,
        }),
        queryParams:
          readQuery(request.url),
        data: Object.freeze({
          ...staticData,
        }),
        config: match.route,
      };

    for (
      const route of match.chain
    ) {
      if (!route.redirectTo) {
        continue;
      }

      return {
        type: 'redirect',
        request,
        redirectTo:
          interpolateRedirect(
            route.redirectTo,
            match.params
          ),
        replace: true,
      };
    }

    setPhase(
      request,
      'guarding'
    );

    const guardContext:
      NavigationContext = {
        ...baseRoute,
        signal,
      };

    for (
      const route of match.chain
    ) {
      for (
        const guard of
        route.canActivate ?? []
      ) {
        const result =
          await executeGuard(
            guard,
            guardContext
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
    }

    setPhase(
      request,
      'resolving'
    );

    const resolvedData:
      Record<string, unknown> = {};

    for (
      const route of match.chain
    ) {
      const context:
        NavigationContext = {
          ...baseRoute,
          data: Object.freeze({
            ...staticData,
            ...resolvedData,
          }),
          signal,
        };

      const values =
        await Promise.all(
          Object.entries(
            route.resolve ?? {}
          ).map(
            async (
              [key, resolver]
            ) => {
              const value =
                await executeResolver(
                  resolver,
                  context
                );

              return [
                key,
                value,
              ] as const;
            }
          )
        );

      throwIfAborted(signal);

      Object.assign(
        resolvedData,
        Object.fromEntries(values)
      );
    }

    const activatedRoute:
      ActivatedRoute = {
        ...baseRoute,
        data: Object.freeze({
          ...staticData,
          ...resolvedData,
        }),
      };

    if (
      !match.route.loadComponent
    ) {
      throw new Error(
        `Matched route "${match.route.path}" has no component`
      );
    }

    setPhase(
      request,
      'loading'
    );

    const loaded =
      await match.route
        .loadComponent();

    throwIfAborted(signal);

    const component =
      unwrapDefault(loaded);

    const node =
      await component(
        activatedRoute
      );

    throwIfAborted(signal);

    return {
      type: 'success',
      request,
      route: activatedRoute,
      node,
    };
  }

  function commit(
    result: NavigationResult
  ): void {
    if (
      result.request.id !==
      navigationId
    ) {
      return;
    }

    switch (result.type) {
      case 'success': {
        if (outlet) {
          render(
            outlet,
            result.node,
            result.route
          );
        }

        router.current =
          result.route;

        router.request = null;
        router.phase = null;
        router.error = null;

        window.dispatchEvent(
          new CustomEvent(
            'routechange',
            {
              detail: result.route,
            }
          )
        );

        trace(
          'Navigation completed',
          result.route.path
        );

        return;
      }

      case 'redirect': {
        if (
          result.request
            .redirectCount >=
          maxRedirects
        ) {
          commit({
            type: 'error',
            request: result.request,
            error: new Error(
              `Maximum redirect count of ${maxRedirects} exceeded`
            ),
          });

          return;
        }

        const url = resolveUrl(
          result.redirectTo
        );

        if (
          url.origin !==
          window.location.origin
        ) {
          window.location.assign(
            url
          );
          return;
        }

        const href =
          url.pathname +
          url.search +
          url.hash;

        const historyMethod =
          result.replace
            ? 'replaceState'
            : 'pushState';

        window.history[
          historyMethod
        ](
          window.history.state,
          '',
          href
        );

        requestNavigation(
          url,
          result.request
            .redirectCount + 1
        );

        return;
      }

      case 'blocked': {
        restoreActiveUrl();

        router.request = null;
        router.phase = null;

        trace(
          'Navigation blocked'
        );

        return;
      }

      case 'error': {
        restoreActiveUrl();

        router.request = null;
        router.phase = null;
        router.error =
          result.error;

        // Preserve the currently active page. Only render an
        // error page when initial navigation never committed.
        if (
          !router.current &&
          outlet
        ) {
          renderError(
            outlet,
            result.error
          );
        }

        trace(
          'Navigation failed',
          result.error
        );
      }
    }
  }

  function handlePopState(): void {
    requestNavigation(
      new URL(
        window.location.href
      )
    );
  }

  function handleClick(
    event: MouseEvent
  ): void {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const target =
      event.target;

    if (
      !(target instanceof Element)
    ) {
      return;
    }

    const anchor =
      target.closest('a[href]');

    if (
      !(
        anchor instanceof
        HTMLAnchorElement
      )
    ) {
      return;
    }

    if (
      anchor.target &&
      anchor.target !== '_self'
    ) {
      return;
    }

    if (
      anchor.hasAttribute(
        'download'
      ) ||
      anchor.rel
        .split(/\s+/)
        .includes('external')
    ) {
      return;
    }

    const url = new URL(
      anchor.href,
      window.location.href
    );

    if (
      url.origin !==
      window.location.origin ||
      !isInsideBase(
        url.pathname
      )
    ) {
      return;
    }

    const current =
      window.location.pathname +
      window.location.search;

    const next =
      url.pathname +
      url.search;

    // Let the browser handle a same-page hash jump.
    if (
      current === next &&
      url.hash
    ) {
      return;
    }

    event.preventDefault();

    router.navigate(url);
  }

  const router = scope({
    current:
      null as
        ActivatedRoute | null,

    request:
      null as
        NavigationRequest | null,

    phase:
      null as
        NavigationPhase,

    error:
      null as unknown,

    pending: (
      self: MutableRouterState
    ) => self.request !== null,

    path: (
      self: MutableRouterState
    ) => self.current?.path ?? '',

    params: (
      self: MutableRouterState
    ) =>
      self.current?.params ??
      EMPTY_PARAMS,

    query: (
      self: MutableRouterState
    ) =>
      self.current
        ?.queryParams ??
      EMPTY_QUERY,

    data: (
      self: MutableRouterState
    ) =>
      self.current?.data ??
      EMPTY_DATA,

    routeConfig: (
      self: MutableRouterState
    ) =>
      self.current?.config ??
      null,

    navigation: () => flow(
      async function* (
        signal?: AbortSignal
      ) {
        const request =
          requests.value;

        if (!request) {
          return;
        }

        router.request =
          request;

        router.error = null;

        try {
          yield await
            performNavigation(
              request,
              signal
            );
        } catch (error) {
          if (
            signal?.aborted ||
            isAbortError(error)
          ) {
            return;
          }

          yield {
            type: 'error',
            request,
            error,
          } satisfies
            NavigationFailure;
        }
      }
    ),

    navigate: method((
      target: string | URL,
      options:
        NavigationOptions = {}
    ) => {
      if (disposed) {
        throw new Error(
          'Cannot navigate with a disposed router'
        );
      }

      const url =
        resolveUrl(target);

      if (
        url.origin !==
        window.location.origin
      ) {
        window.location.assign(
          url
        );
        return;
      }

      if (
        !isInsideBase(
          url.pathname
        )
      ) {
        throw new Error(
          `URL "${url.pathname}" is outside router base "${baseHref}"`
        );
      }

      const href =
        url.pathname +
        url.search +
        url.hash;

      const historyMethod =
        options.replace
          ? 'replaceState'
          : 'pushState';

      window.history[
        historyMethod
      ](
        options.state ?? null,
        '',
        href
      );

      requestNavigation(url);
    }),

    replace: method((
      target: string | URL,
      state?: unknown
    ) => {
      router.navigate(
        target,
        {
          replace: true,
          state,
        }
      );
    }),

    back: method(() => {
      window.history.back();
    }),

    forward: method(() => {
      window.history.forward();
    }),

    start: method(() => {
      if (disposed) {
        throw new Error(
          'Cannot start a disposed router'
        );
      }

      if (started) {
        return;
      }

      started = true;

      window.addEventListener(
        'popstate',
        handlePopState
      );

      document.addEventListener(
        'click',
        handleClick
      );

      const unsubscribe =
        router.at.navigation
          .subscribe(commit);

      unsubscribeNavigation =
        typeof unsubscribe ===
        'function'
          ? unsubscribe
          : undefined;

      requestNavigation(
        new URL(
          window.location.href
        )
      );
    }),

    stop: method(() => {
      if (!started) {
        return;
      }

      window.removeEventListener(
        'popstate',
        handlePopState
      );

      document.removeEventListener(
        'click',
        handleClick
      );

      unsubscribeNavigation?.();
      unsubscribeNavigation =
        undefined;

      started = false;
      router.request = null;
      router.phase = null;
    }),

    href: method((
      target: string
    ) => {
      const url =
        resolveUrl(target);

      return (
        url.pathname +
        url.search +
        url.hash
      );
    }),

    createLink: method((
      to: string,
      text: string,
      className = ''
    ): HTMLAnchorElement => {
      const link =
        document.createElement('a');

      link.href =
        router.href(to);

      link.textContent =
        text;

      if (className) {
        link.className =
          className;
      }

      return link;
    }),
  }) as unknown as InternalRouter;

  const publicState:
    RouterState = router;

  return {
    state: publicState,

    start(): void {
      router.start();
    },

    stop(): void {
      router.stop();
    },

    dispose(): void {
      if (disposed) {
        return;
      }

      router.stop();
      requests.dispose();
      router.dispose();

      disposed = true;
    },

    navigate(
      target: string | URL,
      options?: NavigationOptions
    ): void {
      router.navigate(
        target,
        options
      );
    },

    replace(
      target: string | URL,
      state?: unknown
    ): void {
      router.replace(
        target,
        state
      );
    },

    back(): void {
      router.back();
    },

    forward(): void {
      router.forward();
    },

    href(target: string): string {
      return router.href(target);
    },

    createLink(
      to: string,
      text: string,
      className?: string
    ): HTMLAnchorElement {
      return router.createLink(
        to,
        text,
        className
      );
    },
  };
}

export type StreamixRouter =
  ReturnType<typeof createRouter>;
