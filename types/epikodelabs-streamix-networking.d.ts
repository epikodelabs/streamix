import { Stream, MaybePromise } from '@epikodelabs/streamix';

/**
 * Represents a stream of HTTP responses.
 *
 * This is a special type of stream that includes a method to abort the
 * underlying HTTP request, providing control over long-running or cancellable
 * operations.
 */
type HttpStream<T = any> = Stream<T> & {
    abort: () => void;
};
/**
 * HTTP request options.
 *
 * This object defines the configuration for an HTTP request, including
 * headers, URL parameters, body content, and credentials.
 */
type HttpOptions = {
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
type Context = {
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
/**
 * A middleware function for modifying the HTTP request context.
 *
 * Middleware functions are composed in a chain, where each middleware
 * can process the `Context` object before passing it to the next function
 * via the `next` parameter.
 */
type Middleware = (next: (context: Context) => Promise<Context>) => (context: Context) => Promise<Context>;
/**
 * A function to parse the HTTP response body into a stream of values.
 *
 * A parser takes a `Response` object and returns an `AsyncIterable` that
 * yields the parsed data. This allows for streaming responses and handling
 * various data formats.
 */
type ParserFunction<T = any> = (response: Response) => AsyncIterable<T>;
/**
 * HTTP Client for making requests with middleware support.
 *
 * This object provides methods for standard HTTP verbs (`get`, `post`, etc.)
 * and a `withDefaults` method to configure the client with a set of middleware
 * functions that will be applied to every request.
 */
type HttpClient = {
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
    get<T = any>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T>;
    /**
     * Performs an HTTP POST request.
     */
    post<T = any>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T>;
    /**
     * Performs an HTTP PUT request.
     */
    put<T = any>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T>;
    /**
     * Performs an HTTP PATCH request.
     */
    patch<T = any>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T>;
    /**
     * Performs an HTTP DELETE request.
     */
    delete<T = any>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T>;
};
/**
 * Creates a middleware function that sets a custom fetch function within a context object.
 *
 * This is useful for mocking HTTP requests in tests or for using a different
 * fetch implementation, such as `node-fetch` in a server environment.
 */
declare const useCustom: (customFetch: Function) => Middleware;
/**
 * Resolves relative URLs against a base URL.
 *
 * This middleware is useful for making API requests without repeating the
 * base URL for every call. It will resolve relative paths like `/users/1`
 * against the provided `baseUrl`.
 */
declare const useBase: (baseUrl: string) => Middleware;
/**
 * Sets the `Accept` header for the request.
 *
 * This middleware ensures that the request specifies the desired content
 * type for the response, such as `application/json`.
 */
declare const useAccept: (contentType: string) => Middleware;
/**
 * Handles OAuth 2.0 authentication and token refresh.
 *
 * This middleware automatically adds an `Authorization` header to the request
 * with a bearer token. If a 401 Unauthorized response is received, it attempts
 * to refresh the token and retry the request.
 */
declare const useOauth: ({ getToken, refreshToken, shouldRetry, }: {
    getToken: () => Promise<string>;
    refreshToken: () => Promise<string>;
    shouldRetry?: (context: Context) => boolean;
}) => Middleware;
/**
 * Retry middleware for handling transient errors.
 *
 * This middleware automatically retries a failed request, with an exponential
 * backoff delay between attempts. This is useful for handling temporary network
 * failures or flaky API services.
 */
declare const useRetry: (maxRetries?: number, backoffBase?: number, shouldRetry?: (error: any, context: Context) => boolean) => Middleware;
/**
 * Handles HTTP redirects.
 *
 * This middleware automatically follows 3xx redirect responses up to a
 * specified maximum number of times. It updates the URL in the context and
 * handles the change in HTTP method for a 303 See Other redirect.
 */
declare const useRedirect: (maxRedirects?: number) => Middleware;
/**
 * Sets a custom header for the request.
 */
declare const useHeader: (name: string, value: string) => Middleware;
/**
 * Removes headers from the request context by name.
 *
 * This is useful for stripping default headers (like `Content-Type`) that
 * would otherwise trigger a CORS preflight on simple GET requests.
 */
declare const useStripHeaders: (...names: string[]) => Middleware;
/**
 * Appends query parameters to the request URL.
 */
declare const useParams: (data: Record<string, any>) => Middleware;
/**
 * Handles errors thrown by the next middleware in the chain.
 *
 * This middleware provides a way to gracefully handle errors without
 * breaking the entire chain. It catches errors and allows you to
 * define a custom fallback behavior.
 */
declare const useFallback: (handler: (error: any, context: Context) => Context) => Middleware;
/**
 * Logs request and response information.
 */
declare const useLogger: (logger?: (message: string) => void) => Middleware;
/**
 * Sets a timeout for the request.
 *
 * This middleware adds a timeout to the request, automatically aborting it
 * if it takes longer than the specified number of milliseconds.
 */
declare const useTimeout: (ms: number) => Middleware;
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
declare const createHttpClient: () => HttpClient;
/**
 * Yields the response status and status text as a single object.
 *
 * This parser ignores the response body and emits the HTTP status metadata only.
 */
declare const readStatus: ParserFunction<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
}>;
/**
 * Parses a Response object as JSON.
 *
 * This is a standard parser function that reads the entire response body,
 * parses it as a JSON object, and then emits that single object.
 */
declare const readJson: ParserFunction;
/**
 **
 * Parses a Response object as text.
 *
 * This parser reads the entire response body as a text string and emits
 * that string as a single value.
 */
declare const readText: ParserFunction<string>;
/**
 * Parses a Response object as an ArrayBuffer.
 *
 * This parser reads the entire response body into an `ArrayBuffer` and
 * emits it as a single value. This is useful for handling binary data.
 */
declare const readArrayBuffer: ParserFunction<ArrayBuffer>;
/**
 * Parses a Response object as a Blob.
 *
 * This parser reads the entire response body into a `Blob` object and
 * emits it as a single value. This is useful for working with files or images.
 */
declare const readBlob: ParserFunction<Blob>;
/**
 * Type for the chunks emitted by the readChunks function.
 *
 * This object contains a parsed chunk of data, the current progress of the
 * download, and a `done` flag indicating completion.
 */
type ChunkData<T> = {
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
declare const readChunks: <T = Uint8Array>(chunkParser?: (chunk: any) => T) => ParserFunction<ChunkData<T>>;
/**
 * Parses raw binary chunks (returns Uint8Array as-is).
 */
declare const readBinaryChunk: (chunk: Uint8Array) => Uint8Array;
/**
 * Decodes a binary chunk into a text string.
 */
declare function readTextChunk(chunk: any, encoding?: string): string;
/**
 * Parses a binary chunk as JSON.
 */
declare const readJsonChunk: (chunk: string) => any;
/**
 * Parses a single NDJSON line.
 */
declare const readNdjsonChunk: (line: string) => any;
/**
 * Converts a binary chunk to a Base64 string.
 */
declare const readBase64Chunk: (chunk: Uint8Array) => string;
/**
 * Parses a text chunk as CSV data.
 */
declare const readCsvChunk: (chunk: string) => string[][];
/**
 * Reads and collects the entire response body from a `ReadableStream`.
 *
 * This function returns a stream that yields the full data as it's read.
 * It's useful for scenarios where you need the complete response body
 * before processing the data, such as for images or complete files.
 */
declare const readFull: ParserFunction<Uint8Array>;

/**
 * Creates a stream that performs a JSONP request and emits the resulting data once.
 *
 * This function provides a reactive way to handle JSONP requests, which are
 * often used to bypass the same-origin policy for loading data from a different
 * domain. It dynamically creates a `<script>` tag, handles the response via a
 * global callback, and then cleans up after itself. The stream emits a single
 * value and then completes.
 *
 * @template T The type of the JSONP data to be emitted.
 * @param {MaybePromise<string>} url The URL to make the JSONP request to.
 * @param {MaybePromise<string>} [callbackParam='callback'] The name of the query parameter for the callback function.
 * @returns {Stream<T>} A new stream that emits the JSONP data and then completes.
 */
declare function jsonp<T = any>(url: MaybePromise<string>, callbackParam?: MaybePromise<string>): Stream<T>;

/**
 * A bidirectional stream built on top of WebSocket.
 *
 * Incoming WebSocket messages are emitted through the stream,
 * while outgoing messages can be sent using {@link WebSocketStream.send}.
 *
 * @template T Message payload type.
 */
type WebSocketStream<T = any> = Stream<T> & {
    /**
     * Sends a JSON-serializable message to the server.
     *
     * If the socket is still connecting, the message is queued automatically
     * and flushed once the connection opens.
     *
     * @param message Message payload to send.
     */
    send: (message: T) => void;
    /**
     * Closes the WebSocket connection and terminates the stream.
     *
     * Any queued outgoing messages are discarded.
     */
    close: () => void;
};
/**
 * Creates a reactive WebSocket stream.
 *
 * Features:
 * - Bidirectional messaging
 * - Automatic send queue while connecting
 * - Async URL / socket factory support
 * - Proper stream termination semantics
 * - AbortSignal support
 * - Cleanup-safe event handling
 *
 * Incoming WebSocket messages are expected to be JSON encoded.
 * Outgoing messages are automatically serialized with `JSON.stringify`.
 *
 * @template T Message payload type.
 *
 * @param url
 * WebSocket URL or async URL provider.
 *
 * @param factory
 * Optional WebSocket factory for dependency injection or testing.
 *
 * @returns A {@link WebSocketStream} instance.
 */
declare function webSocket<T = any>(url: MaybePromise<string>, factory?: (url: string) => MaybePromise<WebSocket>): WebSocketStream<T>;

export { createHttpClient, jsonp, readArrayBuffer, readBase64Chunk, readBinaryChunk, readBlob, readChunks, readCsvChunk, readFull, readJson, readJsonChunk, readNdjsonChunk, readStatus, readText, readTextChunk, useAccept, useBase, useCustom, useFallback, useHeader, useLogger, useOauth, useParams, useRedirect, useRetry, useStripHeaders, useTimeout, webSocket };
export type { ChunkData, Context, HttpClient, HttpOptions, HttpStream, Middleware, ParserFunction, WebSocketStream };
