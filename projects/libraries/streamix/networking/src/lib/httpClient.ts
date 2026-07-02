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
 * Represents a stream of HTTP responses.
 */
/**
 * Represents a stream of HTTP responses.
 *
 * This is a special type of stream that includes a method to abort the
 * underlying HTTP request, providing control over long-running or cancellable
 * operations.
 */
export type HttpStream<T = any> = Atom<T> & { abort: () => void };

/**
 * HTTP request options.
 */
/**
 * HTTP request options.
 *
 * This object defines the configuration for an HTTP request, including
 * headers, URL parameters, body content, and credentials.
 */
export type HttpOptions = {
  headers?: Record<string, string>;
  params?: Record<string, string>;
  withCredentials?: boolean;
  body?: any;
};

/**
 * Represents the HTTP request context.
 */
/**
 * Represents the HTTP request context.
 *
 * This object is passed through the middleware chain and contains all
 * relevant information about the request and response lifecycle.
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
 * A middleware function for modifying the HTTP request context.
 */
/**
 * A middleware function for modifying the HTTP request context.
 *
 * Middleware functions are composed in a chain, where each middleware
 * can process the `Context` object before passing it to the next function
 * via the `next` parameter.
 */
export type Middleware = (
  next: (context: Context) => Promise<Context>,
) => (context: Context) => Promise<Context>;

/**
 * A function to parse the HTTP response body into a stream of values.
 */
/**
 * A function to parse the HTTP response body into a stream of values.
 *
 * A parser takes a `Response` object and returns an `AsyncIterable` that
 * yields the parsed data. This allows for streaming responses and handling
 * various data formats.
 */
export type ParserFunction<T = any> = (response: Response) => AsyncIterable<T>;

/**
 * HTTP Client for making requests with middleware support.
 */
/**
 * HTTP Client for making requests with middleware support.
 *
 * This object provides methods for standard HTTP verbs (`get`, `post`, etc.)
 * and a `withDefaults` method to configure the client with a set of middleware
 * functions that will be applied to every request.
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
 * Creates a middleware function that sets a custom fetch function within a context object.
 *
 * This is useful for mocking HTTP requests in tests or for using a different
 * fetch implementation, such as `node-fetch` in a server environment.
 */
export const useCustom = (customFetch: Function): Middleware => {
  return (next) => async (context: Context) => {
    context.fetch = customFetch;
    return await next(context);
  };
};

/**
 * Resolves relative URLs against a base URL.
 *
 * This middleware is useful for making API requests without repeating the
 * base URL for every call. It will resolve relative paths like `/users/1`
 * against the provided `baseUrl`.
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
 * Sets the `Accept` header for the request.
 *
 * This middleware ensures that the request specifies the desired content
 * type for the response, such as `application/json`.
 */
export const useAccept = (contentType: string): Middleware => {
  return (next) => async (context) => {
    context.headers['Accept'] = contentType;
    return await next(context);
  };
};

/**
 * Handles OAuth 2.0 authentication and token refresh.
 *
 * This middleware automatically adds an `Authorization` header to the request
 * with a bearer token. If a 401 Unauthorized response is received, it attempts
 * to refresh the token and retry the request.
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
 * Retry middleware for handling transient errors.
 *
 * This middleware automatically retries a failed request, with an exponential
 * backoff delay between attempts. This is useful for handling temporary network
 * failures or flaky API services.
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
 * Handles HTTP redirects.
 *
 * This middleware automatically follows 3xx redirect responses up to a
 * specified maximum number of times. It updates the URL in the context and
 * handles the change in HTTP method for a 303 See Other redirect.
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
 * Sets a custom header for the request.
 */
export const useHeader = (name: string, value: string): Middleware => {
  return (next) => async (context) => {
    context.headers[name] = value;
    return await next(context);
  };
};

/**
 * Removes headers from the request context by name.
 *
 * This is useful for stripping default headers (like `Content-Type`) that
 * would otherwise trigger a CORS preflight on simple GET requests.
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
 * Appends query parameters to the request URL.
 */
export const useParams = (data: Record<string, any>): Middleware => {
  return (next) => async (context) => {
    context.params = { ...data, ...context.params };
    return await next(context);
  };
};

/**
 * Handles errors thrown by the next middleware in the chain.
 *
 * This middleware provides a way to gracefully handle errors without
 * breaking the entire chain. It catches errors and allows you to
 * define a custom fallback behavior.
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
 * Logs request and response information.
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
 * Sets a timeout for the request.
 *
 * This middleware adds a timeout to the request, automatically aborting it
 * if it takes longer than the specified number of milliseconds.
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
 * Creates an HTTP client with middleware support and streaming capabilities.
 *
 * The client is a factory for creating request streams. Middleware can be
 * configured globally for the client using `withDefaults`.
 *
 * @returns {HttpClient} An instance of the HTTP client.
 *
 * @example
 * ```typescript
 * async function fetchData() {
 *   const client = createHttpClient().withDefaults(
 *     useBase("https://api.example.com"),
 *     useAccept("application/json"),
 *     useLogger(),
 *     useTimeout(5000),
 *     useFallback((error, context) => {
 *       console.error("Request failed:", error);
 *       return context;
 *     })
 *   );
 *
 *   const responseStream = client.get("/data", readJson);
 *
 *   try {
 *     for await (const value of responseStream) {
 *       console.log("Received data:", value);
 *     }
 *   } catch (error) {
 *     console.error("Unexpected error:", error);
 *   }
 * }
 *
 * fetchData();
 *
 * async function postData() {
 *   const client = createHttpClient().use(
 *     useBase("https://api.example.com"),
 *     useLogger(),
 *     useFallback((error, context) => {
 *       console.error("Post request failed:", error);
 *       return context;
 *     })
 *   );
 *
 *   const responseStream = client.post("/items");
 *
 *   try {
 *     for await (const value of responseStream) {
 *       console.log("Post response:", value);
 *     }
 *   } catch (error) {
 *     console.error("Post request error:", error);
 *   }
 * }
 *
 * postData();
 * ```
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
 * Yields the response status and status text as a single object.
 *
 * This parser ignores the response body and emits the HTTP status metadata only.
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
 * Parses a Response object as JSON.
 *
 * This is a standard parser function that reads the entire response body,
 * parses it as a JSON object, and then emits that single object.
 */
export const readJson: ParserFunction = async function* <T>(
  response: Response,
) {
  const data = (await response.json()) as T;
  yield data;
};

/**
 **
 * Parses a Response object as text.
 *
 * This parser reads the entire response body as a text string and emits
 * that string as a single value.
 */
export const readText: ParserFunction<string> = async function* (response) {
  const data = (await response.text()) as string;
  yield data;
};

/**
 * Parses a Response object as an ArrayBuffer.
 *
 * This parser reads the entire response body into an `ArrayBuffer` and
 * emits it as a single value. This is useful for handling binary data.
 */
export const readArrayBuffer: ParserFunction<ArrayBuffer> =
  async function* (response) {
    const data = await response.arrayBuffer();
    yield data;
  };

/**
 * Parses a Response object as a Blob.
 *
 * This parser reads the entire response body into a `Blob` object and
 * emits it as a single value. This is useful for working with files or images.
 */
export const readBlob: ParserFunction<Blob> = async function* (response) {
  const data = await response.blob();
  yield data;
};

/**
 * Type for the chunks emitted by the readChunks function.
 *
 * This object contains a parsed chunk of data, the current progress of the
 * download, and a `done` flag indicating completion.
 */
export type ChunkData<T> = {
  chunk: T;
  progress: number;
  done: boolean;
};

/**
 * Reads and processes streamed response chunks based on Content-Type.
 *
 * This is a versatile parser that can handle a variety of streaming formats,
 * including binary data and line-delimited JSON (NDJSON). It emits chunks
 * as they arrive, along with progress information.
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
 * Parses raw binary chunks (returns Uint8Array as-is).
 */
export const readBinaryChunk = (chunk: Uint8Array): Uint8Array => chunk;

/**
 * Decodes a binary chunk into a text string.
 */
export function readTextChunk(chunk: any, encoding = 'utf-8'): string {
  if (chunk === null || chunk === undefined) return '';

  if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
    return new TextDecoder(encoding).decode(chunk, { stream: true });
  }

  return typeof chunk === 'string' ? chunk : '';
}

/**
 * Parses a binary chunk as JSON.
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
 * Parses a single NDJSON line.
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
 * Converts a binary chunk to a Base64 string.
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
 * Parses a text chunk as CSV data.
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
 * Reads and collects the entire response body from a `ReadableStream`.
 *
 * This function returns a stream that yields the full data as it's read.
 * It's useful for scenarios where you need the complete response body
 * before processing the data, such as for images or complete files.
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