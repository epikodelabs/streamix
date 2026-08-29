import { abortError, combineSignals } from './abort';
import { flow, normalizeError, type Stream } from './stream';
import type { ParserFunction } from './readers';

const LOG_PREFIX = '[httpClient]';

/** A parsed HTTP response stream with explicit request cancellation. */
export type HttpStream<T = unknown> = Stream<T> & { abort(): void };

/** Minimal transport state visible to middleware. */
export type Context = {
  url: string;
  init: RequestInit;
  fetch: typeof fetch;
};

export type ResponseResult = {
  kind: 'response';
  request: Context;
  response: Response;
};

export type DataResult = {
  kind: 'data';
  request: Context;
  data: AsyncIterable<unknown>;
};

export type HttpResult = ResponseResult | DataResult;

export type Middleware = (
  next: (context: Context) => Promise<HttpResult>,
) => (context: Context) => Promise<HttpResult>;

export type RequestTransform = (context: Context) => Context;

export type HttpClient = {
  withDefaults(...middlewares: readonly Middleware[]): HttpClient;
  request<T>(
    url: string,
    parser: ParserFunction<T>,
    init?: RequestInit,
  ): HttpStream<T>;
};

export type HttpClientOptions = {
  baseUrl?: string | URL;
  middlewares?: readonly Middleware[];
};

type HttpContextError = Error & {
  context?: Context;
  status?: number;
};

type NormalizedHttpClientOptions = {
  baseUrl?: string;
  middlewares: readonly Middleware[];
};

const cloneRequest = (
  context: Context,
  patch: Partial<Context> = {},
): Context => ({
  ...context,
  ...patch,
  init: {
    ...context.init,
    ...patch.init,
    headers: patch.init?.headers ?? new Headers(context.init.headers),
  },
});

const withHeader = (
  context: Context,
  name: string,
  value: string,
): Context => {
  const headers = new Headers(context.init.headers);
  headers.set(name, value);
  return cloneRequest(context, { init: { ...context.init, headers } });
};

const methodOf = (context: Context): string => context.init.method ?? 'GET';

// Aborted requests (caller cancellation / consumer teardown) must surface
// immediately instead of burning through the retry backoff schedule.
const isRetryableError = (error: unknown): boolean =>
  (error as Error | undefined)?.name !== 'AbortError';

// `Array.isArray` alone cannot narrow `readonly Middleware[]` out of a union
// (readonly arrays are not assignable to `any[]`), so a custom guard is needed.
const isMiddlewareList = (
  value: readonly Middleware[] | HttpClientOptions | undefined,
): value is readonly Middleware[] => Array.isArray(value);

const normalizeHttpClientOptions = (
  options: readonly Middleware[] | HttpClientOptions | undefined,
): NormalizedHttpClientOptions => {
  if (isMiddlewareList(options)) {
    return { middlewares: options };
  }

  return {
    baseUrl: options?.baseUrl != null ? String(options.baseUrl) : undefined,
    middlewares: options?.middlewares ?? [],
  };
};

const getDefaultBaseUrl = (): string | undefined => {
  if (typeof globalThis.location?.href === 'string' && globalThis.location.href.length > 0) {
    return globalThis.location.href;
  }

  return 'http://localhost/';
};

const resolveRequestUrl = (url: string, baseUrl?: string): string => {
  try {
    return new URL(url).toString();
  } catch {
    const resolvedBaseUrl = baseUrl ?? getDefaultBaseUrl();
    if (resolvedBaseUrl) {
      // Conventional base-URL joining: a relative path extends the base path
      // (baseUrl 'https://api.test/v1' + 'users' → 'https://api.test/v1/users').
      // Plain RFC 3986 resolution would discard the '/v1' segment.
      return new URL(
        url.replace(/^\/+/, ''),
        resolvedBaseUrl.replace(/\/+$/, '') + '/',
      ).toString();
    }
  }

  return url;
};

const prepareRequestInit = (init: RequestInit): RequestInit => {
  const headers = new Headers(init.headers);
  let body = init.body;

  // Preserve raw string bodies without letting Request auto-inject
  // `text/plain;charset=UTF-8` when the caller did not ask for a content type.
  if (typeof body === 'string' && !headers.has('Content-Type')) {
    body = new Blob([body]);
  }

  return {
    ...init,
    headers,
    body,
  };
};

// ─── Middleware ───────────────────────────────────────────────────────────────

/** Adapts pure request-state transformations into middleware. */
export const useRequest = (...transforms: readonly RequestTransform[]): Middleware =>
  (next) => (context) => next(
    transforms.reduce((current, transform) => transform(current), context),
  );

export const useOauth = ({
  getToken,
  refreshToken,
  shouldRetry = () => true,
}: {
  getToken: () => Promise<string>;
  refreshToken: () => Promise<string>;
  shouldRetry?: (context: Context) => boolean;
}): Middleware =>
  (next) => async (context) => {
    const authenticated = withHeader(
      context,
      'Authorization',
      `Bearer ${await getToken()}`,
    );

    try {
      return await next(authenticated);
    } catch (error) {
      const httpError = error as HttpContextError;
      const retryContext = httpError.context;

      if (httpError.status !== 401 || !retryContext || !shouldRetry(retryContext)) {
        throw normalizeError(error);
      }

      return next(withHeader(
        retryContext,
        'Authorization',
        `Bearer ${await refreshToken()}`,
      ));
    }
  };

export const useRetry = (
  maxRetries = 3,
  backoffBase = 1000,
  shouldRetry: (error: unknown, context: Context) => boolean = isRetryableError,
): Middleware =>
  (next) => async (context) => {
    for (let retry = 0; ; retry++) {
      try {
        return await next(cloneRequest(context));
      } catch (error) {
        if (retry >= maxRetries || !shouldRetry(error, context)) {
          throw normalizeError(error);
        }
        await new Promise((resolve) => setTimeout(resolve, backoffBase * 2 ** retry));
      }
    }
  };

export const useFallback = (
  handler: (error: unknown, context: Context) => AsyncIterable<unknown>,
): Middleware =>
  (next) => async (context) => {
    try {
      return await next(context);
    } catch (error) {
      return { kind: 'data', request: context, data: handler(error, context) };
    }
  };

export const useLogger = (
  logger: (message: string) => void = console.log,
): Middleware =>
  (next) => async (context) => {
    logger(`Request: ${methodOf(context)} ${context.url}`);
    const result = await next(context);
    const status = result.kind === 'response' ? result.response.status : 'No Response';
    logger(`Response: ${status} ${result.request.url}`);
    return result;
  };

export const useTimeout = (ms: number): Middleware =>
  (next) => async (context) => {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);

    const signal = context.init.signal
      ? combineSignals(context.init.signal, controller.signal)
      : controller.signal;

    try {
      return await next(cloneRequest(context, {
        init: { ...context.init, signal },
      }));
    } catch (error) {
      if ((error as Error)?.name === 'AbortError' && timedOut) {
        throw new Error(
          `${LOG_PREFIX} Request timed out for ${methodOf(context)} ${context.url}`,
        );
      }
      throw normalizeError(error);
    } finally {
      clearTimeout(timeoutId);
    }
  };

// ─── Client ───────────────────────────────────────────────────────────────────

export const createHttpClient = (
  options: readonly Middleware[] | HttpClientOptions = [],
): HttpClient => {
  const { baseUrl, middlewares } = normalizeHttpClientOptions(options);
  const defaultFetch = globalThis.fetch.bind(globalThis);

  const execute = async (context: Context): Promise<HttpResult> => {
    const request = new Request(resolveRequestUrl(context.url, baseUrl), prepareRequestInit(context.init));
    const response = await context.fetch(request);

    if (!response.ok) {
      // Cancel the error body so the connection is released back to the
      // keep-alive pool instead of being held until the body drains or GC.
      void response.body?.cancel().catch(() => {});

      const error = new Error(
        `${LOG_PREFIX} HTTP Error: ${response.status} ${response.statusText} for ${request.method} ${request.url}`,
      ) as HttpContextError;
      error.status = response.status;
      error.context = context;
      throw error;
    }

    return { kind: 'response', request: context, response };
  };

  const run = middlewares.reduceRight<(context: Context) => Promise<HttpResult>>(
    (next, middleware) => middleware(next),
    execute,
  );

  const request = <T>(
    url: string,
    parser: ParserFunction<T>,
    init: RequestInit = {},
  ): HttpStream<T> => {
    const controller = new AbortController();
    const signal = init.signal
      ? combineSignals(init.signal, controller.signal)
      : controller.signal;

    const context: Context = {
      url,
      init: { ...init, signal },
      fetch: defaultFetch,
    };

    // Start the transport eagerly so abort/timeout wiring is live before the
    // first consumer attaches. Only the first iteration consumes this run;
    // re-iterations start a fresh fetch instead of sharing (and exhausting)
    // a single Response body.
    let initialRun: Promise<HttpResult> | null = run(context);
    initialRun.catch(() => { /* avoid unhandled rejection when nobody iterates */ });

    const stream = flow<T>(async function* (consumerSignal) {
      // Tie consumer cancellation (for-await break, early return, or a
      // flow restart) to the request so in-flight fetches are aborted.
      const onConsumerAbort = () => controller.abort(abortError());
      consumerSignal?.addEventListener('abort', onConsumerAbort, { once: true });

      try {
        const resultPromise = initialRun ?? run(context);
        initialRun = null;

        const result = await resultPromise;
        if (result.kind === 'data') {
          yield* result.data as AsyncIterable<T>;
          return;
        }
        yield* parser(result.response);
      } catch (error) {
        if (consumerSignal?.aborted) return;
        throw error;
      } finally {
        consumerSignal?.removeEventListener('abort', onConsumerAbort);
      }
    }) as HttpStream<T>;

    stream.abort = () => controller.abort(abortError());
    return stream;
  };

  return {
    withDefaults: (...additional) => createHttpClient({
      baseUrl,
      middlewares: [...middlewares, ...additional],
    }),
    request,
  };
};

export type { ParserFunction } from './readers';
