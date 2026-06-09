import { createReplaySubject, createStream, type Stream } from '@epikodelabs/streamix';

const LOG_PREFIX = '[httpClient]';

const logWarning = (message: string, ...details: any[]) => {
  console.warn(`${LOG_PREFIX} ${message}`, ...details);
};

/**
 * Represents a stream of HTTP responses.
 *
 * This is a special type of stream that includes a method to abort the
 * underlying HTTP request, providing control over long-running or cancellable
 * operations.
 */
export type HttpStream<T = any> = Stream<T> & { abort: () => void };

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
  data?: Stream;
  [key: string]: any;
};

type HttpContextError = Error & {
  context?: Context;
  status?: number;
};

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
 *
 * A parser takes a `Response` object and returns an `AsyncIterable` that
 * yields the parsed data. This allows for streaming responses and handling
 * various data formats.
 */
export type ParserFunction<T = any> = (response: Response) => AsyncIterable<T>;

/**
 * HTTP Client for making requests with middleware support.
 *
 * This object provides methods for standard HTTP verbs (`get`, `post`, etc.)
 * and a `withDefaults` method to configure the client with a set of middleware
 * functions that will be applied to every request.
 */
export type HttpClient = {
  /**
   * Adds middleware functions to the HTTP client.
   *
   * This method configures the client with default middleware that will be
   * applied to all subsequent requests.
   */
  withDefaults(this: HttpClient, ...middlewares: Middleware[]): HttpClient;

  /**
   * Performs an HTTP GET request.
   */
  get<T = any>(
    url: string,
    options?: HttpOptions | ParserFunction<T>,
    parser?: ParserFunction<T>,
  ): HttpStream<T>;

  /**
   * Performs an HTTP POST request.
   */
  post<T = any>(
    url: string,
    options?: HttpOptions | ParserFunction<T>,
    parser?: ParserFunction<T>,
  ): HttpStream<T>;

  /**
   * Performs an HTTP PUT request.
   */
  put<T = any>(
    url: string,
    options?: HttpOptions | ParserFunction<T>,
    parser?: ParserFunction<T>,
  ): HttpStream<T>;

  /**
   * Performs an HTTP PATCH request.
   */
  patch<T = any>(
    url: string,
    options?: HttpOptions | ParserFunction<T>,
    parser?: ParserFunction<T>,
  ): HttpStream<T>;

  /**
   * Performs an HTTP DELETE request.
   */
  delete<T = any>(
    url: string,
    options?: HttpOptions | ParserFunction<T>,
    parser?: ParserFunction<T>,
  ): HttpStream<T>;
};

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
}

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
    context.headers["Authorization"] = `Bearer ${await getToken()}`;

    let newContext: Context;
    try {
      newContext = await next(context);
    } catch (error: any) {
      const contextualError = error as HttpContextError;
      const retryContext = contextualError.context;
      if (contextualError.status === 401 && retryContext && shouldRetry(retryContext)) {
        retryContext.headers["Authorization"] = `Bearer ${await refreshToken()}`;
        return await next(retryContext);
      }
      throw error;
    }

    if (newContext.status === 401 && shouldRetry(newContext)) {
      newContext.headers["Authorization"] = `Bearer ${await refreshToken()}`;
      return await next(newContext);
    }

    return newContext;
  };
};

/**
 * Retry middleware for handling transient errors.
 *
 * This middleware automatically retries a failed request, with an exponential
 * backoff delay between attempts.
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
          throw error;
        }

        if (retryCount === maxRetries) {
          throw error;
        }

        const delay = backoffBase * Math.pow(2, retryCount);
        await new Promise((resolve) => setTimeout(resolve, delay));
        retryCount++;
      }
    }

    throw new Error(`${LOG_PREFIX} Retry middleware failed unexpectedly after ${maxRetries} attempts`);
  };
};

/**
 * Handles HTTP redirects.
 *
 * This middleware automatically follows 3xx redirect responses up to a
 * specified maximum number of times.
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
        throw new Error(`${LOG_PREFIX} Too many redirects while requesting ${context.url} (max: ${maxRedirects})`);
      }

      const location = result.redirectTo;
      if (!location || typeof location !== 'string') {
        throw new Error(`${LOG_PREFIX} Redirect response missing Location header for ${result.url}`);
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
        context.headers = { ...context.headers };
        delete context.headers['content-type'];
        delete context.headers['content-length'];
        delete context.headers['Content-Type'];
        delete context.headers['Content-Length'];
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
    context.params = { ...data, ...(context.params || {}) };
    return await next(context);
  };
};

/**
 * Handles errors thrown by the next middleware in the chain.
 */
export const useFallback = (
  handler: (error: any, context: Context) => Context | Promise<Context>,
): Middleware => {
  return (next) => async (context) => {
    try {
      return await next(context);
    } catch (error) {
      return await handler(error, context);
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
 */
export const useTimeout = (ms: number): Middleware => {
  return (next) => async (context: Context) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ms);

    let combinedSignal = controller.signal;
    if (context['signal']) {
      if (typeof AbortSignal !== 'undefined' && (AbortSignal as any).any) {
        combinedSignal = (AbortSignal as any).any([context['signal'], controller.signal]);
      } else {
        logWarning('AbortSignal.any not available, using timeout signal only');
      }
    }

    context['signal'] = combinedSignal;

    try {
      context = await next(context);
      clearTimeout(timeoutId);
      return context;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`${LOG_PREFIX} Request timed out for ${context.method ?? 'UNKNOWN'} ${context.url}`);
      }
      throw error;
    }
  };
};

/**
 * Creates an HTTP client with middleware support and streaming capabilities.
 */
export const createHttpClient = (): HttpClient => {
  const defaultHeaders = { 'Content-Type': 'application/json' };
  const middlewares: Middleware[] = [];

  const resolveUrl = (url: string, params?: Record<string, string>): string => {
    const isAbsolute = url.startsWith('http://') || url.startsWith('https://');

    if (params) {
      if (isAbsolute) {
        const urlObj = new URL(url);
        Object.entries(params).forEach(([key, value]) =>
          urlObj.searchParams.append(key, value),
        );
        return urlObj.toString();
      }

      const baseHref =
        (typeof document !== 'undefined' && document.baseURI) ||
        (typeof location !== 'undefined' && typeof location.href === 'string'
          ? location.href
          : undefined) ||
        'http://localhost';

      const urlObj = new URL(url, baseHref);
      Object.entries(params).forEach(([key, value]) =>
        urlObj.searchParams.append(key, value),
      );
      return urlObj.toString();
    }

    return url;
  };

  const chainMiddleware = (middlewares: Middleware[]): Middleware => {
    return middlewares.reduceRight((nextMiddleware, middleware) =>
      (next) => (ctx) => middleware(nextMiddleware(next))(ctx),
    () => async (context) => {
      let body = context.body;
      
      if (typeof body === 'object' && body !== null) {
        const isBinaryStream = body instanceof ArrayBuffer ||
                               body instanceof Blob ||
                               body instanceof ReadableStream;
        
        let isFormData = false;
        try {
          isFormData = body instanceof FormData;
        } catch {
          isFormData = false;
        }
        
        const isUrlSearchParams = body instanceof URLSearchParams;
        
        if (!isBinaryStream && !isFormData && !isUrlSearchParams) {
          const contentType = context.headers['Content-Type'] || '';
          if (contentType.startsWith('application/json')) {
            body = JSON.stringify(body);
          }
        }
      }

      const url = resolveUrl(context.url, context.params);
      const { method, parser } = context;

      const request = new Request(url, {
        method,
        headers: context.headers,
        body,
        credentials: context['credentials'],
        signal: context['signal'],
      });

      const response = await context.fetch!(request) as Response;

      context.ok = response.ok;
      context.status = response.status;
      context.statusText = response.statusText;

      // Handle empty responses (204 No Content, 304 Not Modified)
      if (response.status === 204 || response.status === 304 || method === 'HEAD') {
        const replay = createReplaySubject<any>();

        (async () => {
          try {
            for await (const item of parser(response)) {
              replay.next(item);
            }
            replay.complete();
          } catch (error) {
            replay.error(error);
          }
        })();
        context.data = replay; return context;
      }

      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        if (!location) {
          throw new Error(`${LOG_PREFIX} Redirect response (${response.status}) missing Location header for ${url}`);
        }
        context.redirectTo = location;
        return context;
      }

      // Handle errors before processing response
      if (!response.ok) {
        const error = new Error(
          `${LOG_PREFIX} HTTP Error: ${response.status} ${response.statusText} for ${method} ${url}`
        ) as HttpContextError;
        error.status = response.status;
        error.context = { ...context };
        throw error;
      }

      const replay = createReplaySubject();

      // Eagerly consume the parser and store results
      (async () => {
        try {
          for await (const item of parser(response)) {
            replay.next(item);
          }
          replay.complete();
        } catch (error: any) {
          replay.error(error);
        }
      })();

      // Create stream that reads from the replay subject
      context.data = createStream('httpParser', async function* (signal) {
        if (signal?.aborted) return;
        
        for await (const value of replay) {
          if (signal?.aborted) break;
          yield value;
        }
      });
      
      return context;
    });
  }

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

    const headers = { ...defaultHeaders, ...(options.headers || {}) };

    const context: Context = {
      url,
      method,
      headers,
      body: options.body,
      params: options.params,
      credentials: options.withCredentials ? 'include' : 'same-origin',
      signal: abortController.signal,
      fetch: globalThis.fetch.bind(globalThis),
      parser,
    };

    const promise = chainMiddleware(middlewares)(async (ctx) => ctx)(context);

    const stream = createStream('httpData', async function* () {
      const ctx = await promise;
      
      if (!ctx || !ctx.data) {
        return;
      }
      
      yield* ctx.data;
    }) as HttpStream<T>;

    stream.abort = () => abortController.abort();
    return stream;
  };

  return {
    withDefaults: function (this: HttpClient, ...newMiddlewares: Middleware[]) {
      middlewares.push(...newMiddlewares);
      return this;
    },
    get: <T>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T> => 
      request<T>('GET', url, options, parser),
    post: <T>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T> => 
      request<T>('POST', url, options, parser),
    put: <T>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T> => 
      request<T>('PUT', url, options, parser),
    patch: <T>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T> => 
      request<T>('PATCH', url, options, parser),
    delete: <T>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T> => 
      request<T>('DELETE', url, options, parser),
  };
};

/**
 * Yields the response status and status text as a single object.
 */
export const readStatus: ParserFunction<{ status: number; statusText: string; headers: Record<string, string>; }> =
  async function* (response) {
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
 */
export const readJson: ParserFunction = async function* <T>(response: Response) {
  const text = await response.text();
  if (!text || text.trim() === '') {
    return;
  }
  const data = JSON.parse(text) as T;
  yield data;
};

/**
 * Parses a Response object as text.
 */
export const readText: ParserFunction<string> = async function* (response) {
  const data = await response.text() as string;
  yield data;
};

/**
 * Parses a Response object as an ArrayBuffer.
 */
export const readArrayBuffer: ParserFunction<ArrayBuffer> = async function* (response) {
  const data = await response.arrayBuffer();
  yield data;
};

/**
 * Parses a Response object as a Blob.
 */
export const readBlob: ParserFunction<Blob> = async function* (response) {
  const data = await response.blob();
  yield data;
};

/**
 * Type for the chunks emitted by the readChunks function.
 */
export type ChunkData<T> = {
  chunk: T;
  progress: number;
  done: boolean;
};

/**
 * Parses a streaming response into chunks with progress information.
 * 
 * @example
 * // Basic usage
 * for await (const chunk of readChunks(response)) {
 *   console.log(chunk.progress, chunk.chunk);
 * }
 * 
 * @example
 * // With custom chunk parser for NDJSON
 * for await (const chunk of readChunks(response, readNdjsonChunk)) {
 *   console.log(chunk.chunk);
 * }
 * 
 * @param response - The fetch Response object
 * @param chunkParser - Optional function to parse each chunk (default: identity)
 * @returns AsyncGenerator yielding chunks with progress information
 */
export function readChunks<T>(
  response: Response,
  chunkParser: (chunk: Uint8Array | string) => T
): AsyncGenerator<ChunkData<T>>;
export function readChunks(
  response: Response
): AsyncGenerator<ChunkData<Uint8Array | string>>;
export async function* readChunks<T>(
  response: Response,
  chunkParser?: (chunk: Uint8Array | string) => T
): AsyncGenerator<ChunkData<T>> {
  // Handle empty responses
  if (!response.body) {
    if (response.status === 204 || response.status === 304) {
      yield { chunk: null as unknown as T, progress: 1, done: true };
      return;
    }
    throw new Error(`${LOG_PREFIX} Response body for ${response.url || 'unknown'} is not readable`);
  }

  const contentLength = response.headers.get('Content-Length');
  const totalSize = contentLength ? parseInt(contentLength, 10) : null;
  let loaded = 0;
  
  const reader = response.body.getReader();
  const contentType = response.headers.get('Content-Type') || '';
  const isNDJSON = contentType.includes('x-ndjson');
  const isText = contentType.includes('text') || contentType.includes('json');

  const parser = chunkParser || ((chunk: any) => chunk);
  
  const encoding = getEncoding(contentType).replace(/^['"]|['"]$/g, '');
  const decoder = new TextDecoder(encoding);
  
  let lineBuffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      if (value) {
        loaded += value.length;
        const progress = totalSize ? loaded / totalSize : 0.5;

        if (isNDJSON) {
          // NDJSON processing
          const chunkText = decoder.decode(value, { stream: true });
          lineBuffer += chunkText;
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              try {
                const parsedChunk = parser(line);
                yield { chunk: parsedChunk, progress, done: false };
              } catch (error) {
                logWarning('Invalid NDJSON line', line, error);
              }
            }
          }
        } else if (isText) {
          // Text/JSON processing
          const chunkText = decoder.decode(value, { stream: true });
          const parsedChunk = parser(chunkText);
          yield { chunk: parsedChunk, progress, done: false };
        } else {
          // Binary processing
          const parsedChunk = parser(value);
          yield { chunk: parsedChunk, progress, done: false };
        }
      }
    }

    // Flush remaining buffers
    const finalText = decoder.decode();
    
    if (isNDJSON) {
      if (finalText) lineBuffer += finalText;
      if (lineBuffer && lineBuffer.trim()) {
        try {
          const parsedChunk = parser(lineBuffer);
          yield { chunk: parsedChunk, progress: 1, done: false };
        } catch (error) {
          logWarning('Invalid or incomplete NDJSON in final buffer', lineBuffer, error);
        }
      }
    } else if (isText && finalText) {
      if (finalText.trim()) {
        const parsedChunk = parser(finalText);
        yield { chunk: parsedChunk, progress: 1, done: false };
      }
    }

    // Signal completion
    yield { chunk: null as unknown as T, progress: 1, done: true };
    
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parses raw binary chunks (returns Uint8Array as-is).
 */
export const readBinaryChunk = (chunk: Uint8Array | string): Uint8Array => {
  if (chunk instanceof Uint8Array) {
    return chunk;
  }
  throw new TypeError('readBinaryChunk expects a Uint8Array, but received a string.');
};

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
export const readJsonChunk = (chunk: Uint8Array | string): any => {
  if (typeof chunk !== 'string') chunk = new TextDecoder().decode(chunk);

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
export const readNdjsonChunk = (chunk: Uint8Array | string): any => {
  const line = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);

  try {
    if (!line.trim()) {
      return null;
    }
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
  return chunk.split(/\r?\n/).map((line) => line.split(","));
};

/**
 * Gets the encoding from a Content-Type header.
 */
function getEncoding(contentType: string): string {
  const match = contentType.match(/charset=([^;]+)/);
  return match ? match[1].trim().toLowerCase() : 'utf-8';
}

/**
 * Reads and collects the entire response body from a `ReadableStream`.
 */
export async function* readFull(response: Response): AsyncGenerator<Uint8Array> {
  if (!response.body) {
    if (response.status === 204 || response.status === 304) {
      yield new Uint8Array(0);
      return;
    }
    throw new Error(`${LOG_PREFIX} Response body for ${response.url || 'unknown'} is not readable`);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
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
  } finally {
    reader.releaseLock();
  }
}