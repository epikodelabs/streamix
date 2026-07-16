import { Stream, MaybePromise } from '@epikodelabs/streamix';

/**
 * A {@link Stream} that represents a stream of HTTP responses.
 *
 * The stream yields values produced by a response parser and exposes an
 * `abort()` method that cancels the underlying request.
 */
type HttpStream<T = any> = Stream<T> & {
    abort: () => void;
};
/**
 * Options for configuring an HTTP request.
 */
type HttpOptions = {
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
    response?: Response;
    data?: AsyncIterable<any>;
    [key: string]: any;
};
/**
 * A middleware function that transforms a {@link Context} before the request
 * is sent or after the response is received.
 */
type Middleware = (next: (context: Context) => Promise<Context>) => (context: Context) => Promise<Context>;
/**
 * Parses a {@link Response} into an async iterable of values.
 */
type ParserFunction<T = any> = (response: Response) => AsyncIterable<T>;
/**
 * An HTTP client built from a chain of middleware.
 */
type HttpClient = {
    withDefaults(this: HttpClient, ...middlewares: Middleware[]): HttpClient;
    get<T = any>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T>;
    post<T = any>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T>;
    put<T = any>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T>;
    patch<T = any>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T>;
    delete<T = any>(url: string, options?: HttpOptions | ParserFunction<T>, parser?: ParserFunction<T>): HttpStream<T>;
};
/**
 * Middleware that installs a custom `fetch` implementation on the context.
 */
declare const useCustom: (customFetch: Function) => Middleware;
/**
 * Middleware that resolves relative URLs against a base URL.
 */
declare const useBase: (baseUrl: string) => Middleware;
/**
 * Middleware that sets the `Accept` request header.
 */
declare const useAccept: (contentType: string) => Middleware;
/**
 * Middleware that adds an OAuth2 bearer token and refreshes it on 401 responses.
 */
declare const useOauth: ({ getToken, refreshToken, shouldRetry, }: {
    getToken: () => Promise<string>;
    refreshToken: () => Promise<string>;
    shouldRetry?: (context: Context) => boolean;
}) => Middleware;
/**
 * Middleware that retries failed requests with exponential backoff.
 */
declare const useRetry: (maxRetries?: number, backoffBase?: number, shouldRetry?: (error: any, context: Context) => boolean) => Middleware;
/**
 * Middleware that follows HTTP redirect responses up to a maximum number of hops.
 */
declare const useRedirect: (maxRedirects?: number) => Middleware;
/**
 * Middleware that sets a custom request header.
 */
declare const useHeader: (name: string, value: string) => Middleware;
/**
 * Middleware that removes the named headers from the request context.
 */
declare const useStripHeaders: (...names: string[]) => Middleware;
/**
 * Middleware that appends query parameters to the request URL.
 */
declare const useParams: (data: Record<string, any>) => Middleware;
/**
 * Middleware that catches errors and returns a fallback context instead of throwing.
 */
declare const useFallback: (handler: (error: any, context: Context) => Context) => Middleware;
/**
 * Middleware that logs the request method/URL and response status.
 */
declare const useLogger: (logger?: (message: string) => void) => Middleware;
/**
 * Middleware that aborts the request if it does not complete within the given
 * number of milliseconds.
 */
declare const useTimeout: (ms: number) => Middleware;
/**
 * Creates an {@link HttpClient} instance.
 *
 * Use `withDefaults()` to register middleware that will be applied to every
 * request made through the client.
 */
declare const createHttpClient: () => HttpClient;
/**
 * Parser that yields the response status, status text, and headers.
 */
declare const readStatus: ParserFunction<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
}>;
/**
 * Parser that reads the response body and yields the parsed JSON value.
 */
declare const readJson: ParserFunction;
/**
 * Parser that yields the response body as a string.
 */
declare const readText: ParserFunction<string>;
/**
 * Parser that yields the response body as an {@link ArrayBuffer}.
 */
declare const readArrayBuffer: ParserFunction<ArrayBuffer>;
/**
 * Parser that yields the response body as a {@link Blob}.
 */
declare const readBlob: ParserFunction<Blob>;
/**
 * Metadata emitted by {@link readChunks} for each chunk of the response body.
 */
type ChunkData<T> = {
    chunk: T;
    progress: number;
    done: boolean;
};
/**
 * Parser that streams response chunks and yields each chunk together with
 * download progress metadata.
 */
declare const readChunks: <T = Uint8Array>(chunkParser?: (chunk: any) => T) => ParserFunction<ChunkData<T>>;
/**
 * Chunk parser that returns a {@link Uint8Array} unchanged.
 */
declare const readBinaryChunk: (chunk: Uint8Array) => Uint8Array;
/**
 * Chunk parser that decodes a binary chunk into a UTF-8 string.
 */
declare function readTextChunk(chunk: any, encoding?: string): string;
/**
 * Chunk parser that parses a string chunk as JSON.
 */
declare const readJsonChunk: (chunk: string) => any;
/**
 * Chunk parser that parses a single NDJSON line as JSON.
 */
declare const readNdjsonChunk: (line: string) => any;
/**
 * Chunk parser that encodes a binary chunk as a Base64 string.
 */
declare const readBase64Chunk: (chunk: Uint8Array) => string;
/**
 * Chunk parser that splits a CSV text chunk into rows and columns.
 */
declare const readCsvChunk: (chunk: string) => string[][];
/**
 * Parser that reads the entire response body and yields it as a single
 * concatenated {@link Uint8Array}.
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
