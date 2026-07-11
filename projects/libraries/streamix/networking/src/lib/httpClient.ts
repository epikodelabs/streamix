import {
  flow,
  normalizeError,
  type Atom
} from '@epikodelabs/streamix';

const LOG_PREFIX = '[httpClient]';

const logWarning = (message: string, ...details: any[]) => {
  console.warn(`${LOG_PREFIX} ${message}`, ...details);
};

/**
 * An {@link Atom} that represents a stream of HTTP responses.
 *
 * The stream yields values produced by a response parser and exposes an
 * `abort()` method that cancels the underlying request.
 */
export type HttpStream<T = any> = Atom<T> & { abort: () => void };

/**
 * Options for configuring an HTTP request.
 */
export type HttpOptions = {
  headers?: Record<string, string>;
  params?: Record<string, string>;
  withCredentials?: boolean;
  body?: any;
};

/**
 * The request/response context that flows through the middleware chain.
 *
 * Middleware can read and mutate this object. After the final middleware runs,
 * `response` contains the raw {@link Response} and `parser` is used to turn it
 * into a stream of values.
 */
export type Context = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: any;
  params?: Record<string, string>;
  fetch?: Function;
  parser: ParserFunction;
  ok?: boolean;
  status?: number;
  statusText?: string;
  redirectTo?: string;
  response?: Response;
  data?: AsyncIterable<any>;
  [key: string]: any;
};

type HttpContextError = Error & {
  context?: Context;
  status?: number;
};

/**
 * A middleware function that transforms a {@link Context} before the request
 * is sent or after the response is received.
 */
export type Middleware = (
  next: (context: Context) => Promise<Context>,
) => (context: Context) => Promise<Context>;

/**
 * Parses a {@link Response} into an async iterable of values.
 */
export type ParserFunction<T = any> = (response: Response) => AsyncIterable<T>;

/**
 * An HTTP client built from a chain of middleware.
 */
export type HttpClient = {
  withDefaults(this: HttpClient, ...middlewares: Middleware[]): HttpClient;

  get<T = any>(
    url: string,
    options?: HttpOptions | ParserFunction<T>,
    parser?: ParserFunction<T>,
  ): HttpStream<T>;

  post<T = any>(
    url: string,
    options?: HttpOptions | ParserFunction<T>,
    parser?: ParserFunction<T>,
  ): HttpStream<T>;

  put<T = any>(
    url: string,
    options?: HttpOptions | ParserFunction<T>,
    parser?: ParserFunction<T>,
  ): HttpStream<T>;

  patch<T = any>(
    url: string,
    options?: HttpOptions | ParserFunction<T>,
    parser?: ParserFunction<T>,
  ): HttpStream<T>;

  delete<T = any>(
    url: string,
    options?: HttpOptions | ParserFunction<T>,
    parser?: ParserFunction<T>,
  ): HttpStream<T>;
};

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Middleware that installs a custom `fetch` implementation on the context.
 */
export const useCustom = (customFetch: Function): Middleware => {
  return (next) => async (context: Context) => {
    context.fetch = customFetch;
    return await next(context);
  };
};

/**
 * Middleware that resolves relative URLs against a base URL.
 */
export const useBase = (baseUrl: string): Middleware => {
  return (next) => async (context: Context) => {
    const url =
      context.url.startsWith('http://') || context.url.startsWith('https://')
        ? context.url
        : new URL(context.url, baseUrl).toString();

    context.url = url;
    return await next(context);
  };
};

/**
 * Middleware that sets the `Accept` request header.
 */
export const useAccept = (contentType: string): Middleware => {
  return (next) => async (context) => {
    context.headers['Accept'] = contentType;
    return await next(context);
  };
};

/**
 * Middleware that adds an OAuth2 bearer token and refreshes it on 401 responses.
 */
export const useOauth = ({
  getToken,
  refreshToken,
  shouldRetry = () => true,
}: {
  getToken: () => Promise<string>;
  refreshToken: () => Promise<string>;
  shouldRetry?: (context: Context) => boolean;
}): Middleware => {
  return (next) => async (context) => {
    context.headers['Authorization'] = `Bearer ${await getToken()}`;

    let newContext: Context;
    try {
      newContext = await next(context);
    } catch (error: any) {
      const contextualError = error as HttpContextError;
      const retryContext = contextualError.context;
      if (
        contextualError.status === 401 &&
        retryContext &&
        shouldRetry(retryContext)
      ) {
        retryContext.headers['Authorization'] =
          `Bearer ${await refreshToken()}`;
        return await next(retryContext);
      }
      throw normalizeError(error);
    }

    if (newContext.status === 401 && shouldRetry(newContext)) {
      newContext.headers['Authorization'] = `Bearer ${await refreshToken()}`;
      return await next(newContext);
    }

    return newContext;
  };
};

/**
 * Middleware that retries failed requests with exponential backoff.
 */
export const useRetry = (
  maxRetries: number = 3,
  backoffBase: number = 1000,
  shouldRetry: (error: any, context: Context) => boolean = () => true,
): Middleware => {
  return (next) => async (context) => {
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      try {
        return await next(context);
      } catch (error: any) {
        if (!shouldRetry(error, context)) {
          throw normalizeError(error);
        }

        if (retryCount === maxRetries) {
          throw normalizeError(error);
        }

        const delay = backoffBase * Math.pow(2, retryCount);
        await new Promise((resolve) => setTimeout(resolve, delay));
        retryCount++;
      }
    }

    throw new Error(
      `${LOG_PREFIX} Retry middleware failed unexpectedly after ${maxRetries} attempts`,
    );
  };
};

/**
 * Middleware that follows HTTP redirect responses up to a maximum number of hops.
 */
export const useRedirect = (maxRedirects: number = 5): Middleware => {
  return (next) => async (initialContext) => {
    let context = initialContext;
    let redirects = 0;

    while (true) {
      const result = await next(context);

      if (result.redirectTo === undefined) {
        return result;
      }

      redirects++;
      if (redirects > maxRedirects) {
        throw new Error(
          `${LOG_PREFIX} Too many redirects while requesting ${context.url} (max: ${maxRedirects})`,
        );
      }

      const location = result.redirectTo;
      if (!location || typeof location !== 'string') {
        throw new Error(
          `${LOG_PREFIX} Redirect response missing Location header for ${result.url}`,
        );
      }

      const nextUrl = new URL(location, result.url).toString();

      context = {
        ...result,
        url: nextUrl,
        redirectTo: undefined,
      };

      if (result.status === 303) {
        context.method = 'GET';
        context.body = undefined;

        if (context.headers) {
          try {
            let headersObj: Record<string, string>;

            if (context.headers instanceof Headers) {
              headersObj = {};
              context.headers.forEach((value, key) => {
                headersObj[key] = value;
              });
            } else if (Array.isArray(context.headers)) {
              headersObj = Object.fromEntries(context.headers);
            } else if (typeof context.headers === 'object') {
              headersObj = { ...context.headers };
            } else {
              headersObj = context.headers;
            }

            delete headersObj['content-type'];
            delete headersObj['content-length'];
            delete headersObj['Content-Type'];
            delete headersObj['Content-Length'];

            context.headers = headersObj;
          } catch (error) {
            logWarning(
              'Failed to process headers for 303 redirect',
              {
                url: context.url,
                status: context.status,
                redirectCount: redirects,
              },
              error,
            );
            context.headers = {};
          }
        } else {
          context.headers = {};
        }
      }
    }
  };
};

/**
 * Middleware that sets a custom request header.
 */
export const useHeader = (name: string, value: string): Middleware => {
  return (next) => async (context) => {
    context.headers[name] = value;
    return await next(context);
  };
};

/**
 * Middleware that removes the named headers from the request context.
 */
export const useStripHeaders = (...names: string[]): Middleware => {
  return (next) => async (context) => {
    const cleaned: Record<string, string> = {};
    const toRemove = names.map((n) => n.toLowerCase());
    for (const [key, value] of Object.entries(context.headers)) {
      if (!toRemove.includes(key.toLowerCase())) {
        cleaned[key] = value;
      }
    }
    context.headers = cleaned;
    return await next(context);
  };
};

/**
 * Middleware that appends query parameters to the request URL.
 */
export const useParams = (data: Record<string, any>): Middleware => {
  return (next) => async (context) => {
    context.params = { ...data, ...context.params };
    return await next(context);
  };
};

/**
 * Middleware that catches errors and returns a fallback context instead of throwing.
 */
export const useFallback = (
  handler: (error: any, context: Context) => Context,
): Middleware => {
  return (next) => async (context) => {
    try {
      return await next(context);
    } catch (error) {
      return handler(error, context);
    }
  };
};

/**
 * Middleware that logs the request method/URL and response status.
 */
export const useLogger = (
  logger: (message: string) => void = console.log,
): Middleware => {
  return (next) => async (context) => {
    logger(`Request: ${context.method} ${context.url}`);
    context = await next(context);
    logger(`Response: ${context.status || 'No Response'} ${context.url}`);
    return context;
  };
};

/**
 * Middleware that aborts the request if it does not complete within the given
 * number of milliseconds.
 */
export const useTimeout = (ms: number): Middleware => {
  return (next) => async (context: Context) => {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);

    const combinedSignal = context['signal']
      ? (AbortSignal as any).any([context['signal'], controller.signal])
      : controller.signal;

    context['signal'] = combinedSignal;

    try {
      context = await next(context);
      clearTimeout(timeoutId);
      return context;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError' && timedOut) {
        throw new Error(
          `${LOG_PREFIX} Request timed out for ${context.method ?? 'UNKNOWN'} ${context.url}`,
        );
      }
      throw normalizeError(error);
    }
  };
};

// ─── HTTP Client Implementation ──────────────────────────────────────────────

/**
 * Creates an {@link HttpClient} instance.
 *
 * Use `withDefaults()` to register middleware that will be applied to every
 * request made through the client.
 */
export const createHttpClient = (): HttpClient => {
  const defaultHeaders = { 'Content-Type': 'application/json' };
  const middlewares: Middleware[] = [];

  const resolveUrl = (url: string, params?: Record<string, string>): string => {
    const isAbsolute =
      url.startsWith('http://') || url.startsWith('https://');

    if (params) {
      const baseHref =
        (typeof document !== 'undefined' && document.baseURI) ||
        (typeof location !== 'undefined' &&
        typeof location.href === 'string'
          ? location.href
          : undefined) ||
        'http://localhost';

      const urlObj = isAbsolute ? new URL(url) : new URL(url, baseHref);
      Object.entries(params).forEach(([key, value]) =>
        urlObj.searchParams.append(key, value),
      );
      return urlObj.toString();
    }

    return url;
  };

  const chainMiddleware = (middlewares: Middleware[]): Middleware => {
    return middlewares.reduceRight(
      (nextMiddleware, middleware) => (next) => (ctx) =>
        middleware(nextMiddleware(next))(ctx),
      () => async (context: Context) => {
        let body = context.body;
        if (typeof body === 'object' && body !== null) {
          if (
            !(body instanceof FormData || body instanceof URLSearchParams)
          ) {
            if (context.headers['Content-Type'] === 'application/json') {
              body = JSON.stringify(body);
            }
          }
        }

        const url = resolveUrl(context.url, context.params);
        const { method } = context;

        const request = new Request(url, {
          method,
          headers: context.headers,
          body,
          credentials: context['credentials'],
          signal: context['signal'],
        });

        const response = (await context.fetch!(request)) as Response;

        context.ok = response.ok;
        context.status = response.status;
        context.statusText = response.statusText;

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('Location');
          if (!location) {
            throw new Error(
              `${LOG_PREFIX} Redirect response (${response.status}) missing Location header for ${url}`,
            );
          }
          context.redirectTo = location;
          return context;
        }

        if (!response.ok) {
          const error = new Error(
            `${LOG_PREFIX} HTTP Error: ${response.status} ${response.statusText} for ${method} ${url}`,
          ) as HttpContextError;
          error.status = response.status;
          error.context = { ...context };
          throw error;
        }

        // Store the raw response—parsing happens in the stream consumer
        context.response = response;
        return context;
      },
    );
  };

  const request = <T = any>(
    method: string,
    url: string,
    optionsOrParser?: HttpOptions | ParserFunction<T>,
    maybeParser?: ParserFunction<T>,
  ): HttpStream<T> => {
    const abortController = new AbortController();

    const isParser = typeof optionsOrParser === 'function';

    const options: HttpOptions = isParser ? {} : optionsOrParser || {};
    const parser: ParserFunction<T> = isParser
      ? (optionsOrParser as ParserFunction<T>)
      : (maybeParser ?? (readStatus as ParserFunction<T>));

    const context: Context = {
      url,
      method,
      headers: { ...defaultHeaders, ...options.headers },
      body: options.body,
      params: options.params,
      credentials: options.withCredentials ? 'include' : 'same-origin',
      signal: abortController.signal,
      fetch: globalThis.fetch.bind(globalThis),
      parser,
    };

    const promise = chainMiddleware(middlewares)(async (ctx) => ctx)(context);

    // No replay atom—flow yields directly from the response parser.
    // If fallback middleware set `context.data`, we use that instead.
    const stream = flow<T>(async function* () {
      const ctx = await promise;

      // Fallback middleware may have provided data directly
      if (ctx.data) {
        yield* ctx.data;
        return;
      }

      if (!ctx.response) {
        return;
      }

      yield* ctx.parser(ctx.response);
    }) as HttpStream<T>;

    stream.abort = () => {
      abortController.abort(
        new DOMException('The operation was aborted.', 'AbortError'),
      );
    };

    return stream;
  };

  return {
    withDefaults: function (this: HttpClient, ...newMiddlewares: Middleware[]) {
      middlewares.push(...newMiddlewares);
      return this;
    },
    get: <T>(
      url: string,
      options?: HttpOptions | ParserFunction<T>,
      parser?: ParserFunction<T>,
    ): HttpStream<T> => request<T>('GET', url, options, parser),
    post: <T>(
      url: string,
      options?: HttpOptions | ParserFunction<T>,
      parser?: ParserFunction<T>,
    ): HttpStream<T> => request<T>('POST', url, options, parser),
    put: <T>(
      url: string,
      options?: HttpOptions | ParserFunction<T>,
      parser?: ParserFunction<T>,
    ): HttpStream<T> => request<T>('PUT', url, options, parser),
    patch: <T>(
      url: string,
      options?: HttpOptions | ParserFunction<T>,
      parser?: ParserFunction<T>,
    ): HttpStream<T> => request<T>('PATCH', url, options, parser),
    delete: <T>(
      url: string,
      options?: HttpOptions | ParserFunction<T>,
      parser?: ParserFunction<T>,
    ): HttpStream<T> => request<T>('DELETE', url, options, parser),
  };
};

// ─── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Parser that yields the response status, status text, and headers.
 */
export const readStatus: ParserFunction<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
}> = async function* (response) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  yield {
    status: response.status,
    statusText: response.statusText,
    headers,
  };
};

/**
 * Parser that reads the response body and yields the parsed JSON value.
 */
export const readJson: ParserFunction = async function* <T>(
  response: Response,
) {
  const data = (await response.json()) as T;
  yield data;
};

/**
 * Parser that yields the response body as a string.
 */
export const readText: ParserFunction<string> = async function* (response) {
  const data = (await response.text()) as string;
  yield data;
};

/**
 * Parser that yields the response body as an {@link ArrayBuffer}.
 */
export const readArrayBuffer: ParserFunction<ArrayBuffer> =
  async function* (response) {
    const data = await response.arrayBuffer();
    yield data;
  };

/**
 * Parser that yields the response body as a {@link Blob}.
 */
export const readBlob: ParserFunction<Blob> = async function* (response) {
  const data = await response.blob();
  yield data;
};

/**
 * Metadata emitted by {@link readChunks} for each chunk of the response body.
 */
export type ChunkData<T> = {
  chunk: T;
  progress: number;
  done: boolean;
};

/**
 * Parser that streams response chunks and yields each chunk together with
 * download progress metadata.
 */
export const readChunks = <T = Uint8Array>(
  chunkParser: (chunk: any) => T = (chunk) => chunk,
): ParserFunction<ChunkData<T>> =>
  async function* (response) {
    if (!response.body) {
      throw new Error(
        `${LOG_PREFIX} Response body for ${response.url || 'unknown'} is not readable`,
      );
    }

    const contentLength = response.headers.get('Content-Length');
    const totalSize = contentLength ? parseInt(contentLength, 10) : null;
    let loaded = 0;

    const reader = response.body.getReader();
    const contentType = response.headers.get('Content-Type') || '';

    let buffer = '';
    const decoder = new TextDecoder(getEncoding(contentType));

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      if (value) {
        loaded += value.length;
        const progress = totalSize ? loaded / totalSize : 0.5;

        let parsedChunk;

        if (contentType.includes('text') || contentType.includes('json')) {
          const chunkText = decoder.decode(value, { stream: true });

          if (contentType.includes('x-ndjson')) {
            buffer += chunkText;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim()) {
                try {
                  parsedChunk = chunkParser(line);
                  yield { chunk: parsedChunk, progress, done: false };
                } catch (error) {
                  logWarning('Invalid NDJSON line', line, error);
                }
              }
            }
            continue;
          }

          parsedChunk = chunkParser(chunkText);
        } else {
          parsedChunk = chunkParser(value);
        }

        yield {
          chunk: parsedChunk,
          progress,
          done: false,
        };
      }
    }

    yield {
      chunk: null as unknown as T,
      progress: 1,
      done: true,
    };
  };

/**
 * Chunk parser that returns a {@link Uint8Array} unchanged.
 */
export const readBinaryChunk = (chunk: Uint8Array): Uint8Array => chunk;

/**
 * Chunk parser that decodes a binary chunk into a UTF-8 string.
 */
export function readTextChunk(chunk: any, encoding = 'utf-8'): string {
  if (chunk === null || chunk === undefined) return '';

  if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
    return new TextDecoder(encoding).decode(chunk, { stream: true });
  }

  return typeof chunk === 'string' ? chunk : '';
}

/**
 * Chunk parser that parses a string chunk as JSON.
 */
export const readJsonChunk = (chunk: string): any => {
  try {
    return JSON.parse(chunk);
  } catch {
    logWarning('Invalid JSON chunk', chunk);
    return null;
  }
};

/**
 * Chunk parser that parses a single NDJSON line as JSON.
 */
export const readNdjsonChunk = (line: string): any => {
  try {
    return JSON.parse(line);
  } catch {
    logWarning('Invalid NDJSON line', line);
    return null;
  }
};

/**
 * Chunk parser that encodes a binary chunk as a Base64 string.
 */
export const readBase64Chunk = (chunk: Uint8Array): string => {
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < chunk.byteLength; i += chunkSize) {
    const end = Math.min(i + chunkSize, chunk.byteLength);
    const slice = chunk.subarray(i, end);
    let chunkBinary = '';
    for (let j = 0; j < slice.byteLength; j++) {
      chunkBinary += String.fromCharCode(slice[j]);
    }
    binary += chunkBinary;
  }
  return btoa(binary);
};

/**
 * Chunk parser that splits a CSV text chunk into rows and columns.
 */
export const readCsvChunk = (chunk: string): string[][] => {
  return chunk
    .split('\n')
    .map((line) => line.split(','));
};

function getEncoding(contentType: string): string {
  const match = contentType.match(/charset=([^;]+)/);
  return match ? match[1].trim().toLowerCase() : 'utf-8';
}

/**
 * Parser that reads the entire response body and yields it as a single
 * concatenated {@link Uint8Array}.
 */
export const readFull: ParserFunction<Uint8Array> = async function* (
  response,
) {
  if (!response.body) {
    throw new Error(
      `${LOG_PREFIX} Response body for ${response.url || 'unknown'} is not readable`,
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    if (value) {
      chunks.push(value);
      totalLength += value.length;
    }
  }

  const accumulatedData = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    accumulatedData.set(chunk, offset);
    offset += chunk.length;
  }

  yield accumulatedData;
};
