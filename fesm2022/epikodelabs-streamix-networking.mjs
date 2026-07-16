import { normalizeError, createStream, isPromiseLike } from '@epikodelabs/streamix';

const LOG_PREFIX = '[httpClient]';
const logWarning = (message, ...details) => {
    console.warn(`${LOG_PREFIX} ${message}`, ...details);
};
// ─── Middleware ───────────────────────────────────────────────────────────────
/**
 * Middleware that installs a custom `fetch` implementation on the context.
 */
const useCustom = (customFetch) => {
    return (next) => async (context) => {
        context.fetch = customFetch;
        return await next(context);
    };
};
/**
 * Middleware that resolves relative URLs against a base URL.
 */
const useBase = (baseUrl) => {
    return (next) => async (context) => {
        const url = context.url.startsWith('http://') || context.url.startsWith('https://')
            ? context.url
            : new URL(context.url, baseUrl).toString();
        context.url = url;
        return await next(context);
    };
};
/**
 * Middleware that sets the `Accept` request header.
 */
const useAccept = (contentType) => {
    return (next) => async (context) => {
        context.headers['Accept'] = contentType;
        return await next(context);
    };
};
/**
 * Middleware that adds an OAuth2 bearer token and refreshes it on 401 responses.
 */
const useOauth = ({ getToken, refreshToken, shouldRetry = () => true, }) => {
    return (next) => async (context) => {
        context.headers['Authorization'] = `Bearer ${await getToken()}`;
        let newContext;
        try {
            newContext = await next(context);
        }
        catch (error) {
            const contextualError = error;
            const retryContext = contextualError.context;
            if (contextualError.status === 401 &&
                retryContext &&
                shouldRetry(retryContext)) {
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
const useRetry = (maxRetries = 3, backoffBase = 1000, shouldRetry = () => true) => {
    return (next) => async (context) => {
        let retryCount = 0;
        while (retryCount <= maxRetries) {
            try {
                return await next(context);
            }
            catch (error) {
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
        throw new Error(`${LOG_PREFIX} Retry middleware failed unexpectedly after ${maxRetries} attempts`);
    };
};
/**
 * Middleware that follows HTTP redirect responses up to a maximum number of hops.
 */
const useRedirect = (maxRedirects = 5) => {
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
                if (context.headers) {
                    try {
                        let headersObj;
                        if (context.headers instanceof Headers) {
                            headersObj = {};
                            context.headers.forEach((value, key) => {
                                headersObj[key] = value;
                            });
                        }
                        else if (Array.isArray(context.headers)) {
                            headersObj = Object.fromEntries(context.headers);
                        }
                        else if (typeof context.headers === 'object') {
                            headersObj = { ...context.headers };
                        }
                        else {
                            headersObj = context.headers;
                        }
                        delete headersObj['content-type'];
                        delete headersObj['content-length'];
                        delete headersObj['Content-Type'];
                        delete headersObj['Content-Length'];
                        context.headers = headersObj;
                    }
                    catch (error) {
                        logWarning('Failed to process headers for 303 redirect', {
                            url: context.url,
                            status: context.status,
                            redirectCount: redirects,
                        }, error);
                        context.headers = {};
                    }
                }
                else {
                    context.headers = {};
                }
            }
        }
    };
};
/**
 * Middleware that sets a custom request header.
 */
const useHeader = (name, value) => {
    return (next) => async (context) => {
        context.headers[name] = value;
        return await next(context);
    };
};
/**
 * Middleware that removes the named headers from the request context.
 */
const useStripHeaders = (...names) => {
    return (next) => async (context) => {
        const cleaned = {};
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
const useParams = (data) => {
    return (next) => async (context) => {
        context.params = { ...data, ...context.params };
        return await next(context);
    };
};
/**
 * Middleware that catches errors and returns a fallback context instead of throwing.
 */
const useFallback = (handler) => {
    return (next) => async (context) => {
        try {
            return await next(context);
        }
        catch (error) {
            return handler(error, context);
        }
    };
};
/**
 * Middleware that logs the request method/URL and response status.
 */
const useLogger = (logger = console.log) => {
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
const useTimeout = (ms) => {
    return (next) => async (context) => {
        const controller = new AbortController();
        let timedOut = false;
        const timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, ms);
        const combinedSignal = context['signal']
            ? AbortSignal.any([context['signal'], controller.signal])
            : controller.signal;
        context['signal'] = combinedSignal;
        try {
            context = await next(context);
            clearTimeout(timeoutId);
            return context;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError' && timedOut) {
                throw new Error(`${LOG_PREFIX} Request timed out for ${context.method ?? 'UNKNOWN'} ${context.url}`);
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
const createHttpClient = () => {
    const defaultHeaders = { 'Content-Type': 'application/json' };
    const middlewares = [];
    const resolveUrl = (url, params) => {
        const isAbsolute = url.startsWith('http://') || url.startsWith('https://');
        if (params) {
            const baseHref = (typeof document !== 'undefined' && document.baseURI) ||
                (typeof location !== 'undefined' &&
                    typeof location.href === 'string'
                    ? location.href
                    : undefined) ||
                'http://localhost';
            const urlObj = isAbsolute ? new URL(url) : new URL(url, baseHref);
            Object.entries(params).forEach(([key, value]) => urlObj.searchParams.append(key, value));
            return urlObj.toString();
        }
        return url;
    };
    const chainMiddleware = (middlewares) => {
        return middlewares.reduceRight((nextMiddleware, middleware) => (next) => (ctx) => middleware(nextMiddleware(next))(ctx), () => async (context) => {
            let body = context.body;
            if (typeof body === 'object' && body !== null) {
                if (!(body instanceof FormData || body instanceof URLSearchParams)) {
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
            const response = (await context.fetch(request));
            context.ok = response.ok;
            context.status = response.status;
            context.statusText = response.statusText;
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get('Location');
                if (!location) {
                    throw new Error(`${LOG_PREFIX} Redirect response (${response.status}) missing Location header for ${url}`);
                }
                context.redirectTo = location;
                return context;
            }
            if (!response.ok) {
                const error = new Error(`${LOG_PREFIX} HTTP Error: ${response.status} ${response.statusText} for ${method} ${url}`);
                error.status = response.status;
                error.context = { ...context };
                throw error;
            }
            // Store the raw response—parsing happens in the stream consumer
            context.response = response;
            return context;
        });
    };
    const request = (method, url, optionsOrParser, maybeParser) => {
        const abortController = new AbortController();
        const isParser = typeof optionsOrParser === 'function';
        const options = isParser ? {} : optionsOrParser || {};
        const parser = isParser
            ? optionsOrParser
            : (maybeParser ?? readStatus);
        const context = {
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
        // No replay buffer: the stream yields directly from the response parser.
        // If fallback middleware set `context.data`, we use that instead.
        const stream = createStream('httpData', async function* (signal) {
            const abortStreamRequest = () => {
                abortController.abort(new DOMException('The operation was aborted.', 'AbortError'));
            };
            if (signal?.aborted) {
                abortStreamRequest();
                return;
            }
            signal?.addEventListener('abort', abortStreamRequest, { once: true });
            try {
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
            }
            finally {
                signal?.removeEventListener('abort', abortStreamRequest);
            }
        });
        stream.abort = () => {
            abortController.abort(new DOMException('The operation was aborted.', 'AbortError'));
        };
        return stream;
    };
    return {
        withDefaults: function (...newMiddlewares) {
            middlewares.push(...newMiddlewares);
            return this;
        },
        get: (url, options, parser) => request('GET', url, options, parser),
        post: (url, options, parser) => request('POST', url, options, parser),
        put: (url, options, parser) => request('PUT', url, options, parser),
        patch: (url, options, parser) => request('PATCH', url, options, parser),
        delete: (url, options, parser) => request('DELETE', url, options, parser),
    };
};
// ─── Parsers ─────────────────────────────────────────────────────────────────
/**
 * Parser that yields the response status, status text, and headers.
 */
const readStatus = async function* (response) {
    const headers = {};
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
const readJson = async function* (response) {
    const data = (await response.json());
    yield data;
};
/**
 * Parser that yields the response body as a string.
 */
const readText = async function* (response) {
    const data = (await response.text());
    yield data;
};
/**
 * Parser that yields the response body as an {@link ArrayBuffer}.
 */
const readArrayBuffer = async function* (response) {
    const data = await response.arrayBuffer();
    yield data;
};
/**
 * Parser that yields the response body as a {@link Blob}.
 */
const readBlob = async function* (response) {
    const data = await response.blob();
    yield data;
};
/**
 * Parser that streams response chunks and yields each chunk together with
 * download progress metadata.
 */
const readChunks = (chunkParser = (chunk) => chunk) => async function* (response) {
    if (!response.body) {
        throw new Error(`${LOG_PREFIX} Response body for ${response.url || 'unknown'} is not readable`);
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
        if (done)
            break;
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
                            }
                            catch (error) {
                                logWarning('Invalid NDJSON line', line, error);
                            }
                        }
                    }
                    continue;
                }
                parsedChunk = chunkParser(chunkText);
            }
            else {
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
        chunk: null,
        progress: 1,
        done: true,
    };
};
/**
 * Chunk parser that returns a {@link Uint8Array} unchanged.
 */
const readBinaryChunk = (chunk) => chunk;
/**
 * Chunk parser that decodes a binary chunk into a UTF-8 string.
 */
function readTextChunk(chunk, encoding = 'utf-8') {
    if (chunk === null || chunk === undefined)
        return '';
    if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
        return new TextDecoder(encoding).decode(chunk, { stream: true });
    }
    return typeof chunk === 'string' ? chunk : '';
}
/**
 * Chunk parser that parses a string chunk as JSON.
 */
const readJsonChunk = (chunk) => {
    try {
        return JSON.parse(chunk);
    }
    catch {
        logWarning('Invalid JSON chunk', chunk);
        return null;
    }
};
/**
 * Chunk parser that parses a single NDJSON line as JSON.
 */
const readNdjsonChunk = (line) => {
    try {
        return JSON.parse(line);
    }
    catch {
        logWarning('Invalid NDJSON line', line);
        return null;
    }
};
/**
 * Chunk parser that encodes a binary chunk as a Base64 string.
 */
const readBase64Chunk = (chunk) => {
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
const readCsvChunk = (chunk) => {
    return chunk
        .split('\n')
        .map((line) => line.split(','));
};
function getEncoding(contentType) {
    const match = contentType.match(/charset=([^;]+)/);
    return match ? match[1].trim().toLowerCase() : 'utf-8';
}
/**
 * Parser that reads the entire response body and yields it as a single
 * concatenated {@link Uint8Array}.
 */
const readFull = async function* (response) {
    if (!response.body) {
        throw new Error(`${LOG_PREFIX} Response body for ${response.url || 'unknown'} is not readable`);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let totalLength = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done)
            break;
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
function jsonp(url, callbackParam = 'callback') {
    return createStream('jsonp', async function* (signal) {
        if (typeof document === "undefined" ||
            typeof window === "undefined" ||
            !document.head) {
            throw new Error("JSONP requires a browser environment");
        }
        const resolvedUrl = isPromiseLike(url) ? await url : url;
        const resolvedCallbackParam = isPromiseLike(callbackParam) ? await callbackParam : callbackParam;
        const uniqueCallbackName = `${resolvedCallbackParam}_${Math.random().toString(36).slice(2)}`;
        const script = document.createElement('script');
        const fullUrl = `${resolvedUrl}${resolvedUrl.includes('?') ? '&' : '?'}${resolvedCallbackParam}=${encodeURIComponent(uniqueCallbackName)}`;
        // Promise that resolves when JSONP callback fires or rejects on error
        const dataPromise = new Promise((resolve, reject) => {
            window[uniqueCallbackName] = (data) => resolve(data);
            script.onerror = () => reject(new Error(`JSONP request failed: ${fullUrl}`));
        });
        script.src = fullUrl;
        document.head.appendChild(script);
        // Helper to cleanup
        const cleanup = () => {
            delete window[uniqueCallbackName];
            if (script.parentNode) {
                script.parentNode.removeChild(script);
            }
        };
        const abortPromise = new Promise((_, reject) => {
            if (signal?.aborted) {
                reject(new Error('Aborted'));
            }
            else {
                signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
            }
        });
        try {
            // Race the dataPromise against abort signal
            yield await Promise.race([dataPromise, abortPromise]);
        }
        finally {
            cleanup();
        }
    });
}

/**
 * WebSocket readyState constants.
 */
const WS_CONNECTING = 0;
const WS_OPEN = 1;
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
function webSocket(url, factory = (u) => new WebSocket(u)) {
    /**
     * Buffered incoming messages waiting to be consumed.
     */
    const messageQueue = [];
    /**
     * Buffered outgoing messages waiting for socket open.
     */
    const sendQueue = [];
    /**
     * Active WebSocket instance.
     */
    let socket = null;
    /**
     * Current pending async consumer.
     */
    let pendingNext = null;
    /**
     * Cleanup callback for socket listeners.
     */
    let cleanupHandlers = null;
    /**
     * Whether the socket is currently open.
     */
    let isOpen = false;
    /**
     * Whether the stream has terminated.
     */
    let closed = false;
    /**
     * Terminal stream error.
     */
    let terminalError = null;
    /**
     * Safely closes the current socket.
     */
    const closeSocket = () => {
        if (socket && (socket.readyState === WS_CONNECTING || socket.readyState === WS_OPEN)) {
            socket.close();
        }
    };
    /**
     * Resolves the pending consumer with a closed notification.
     */
    const resolveClosed = () => {
        pendingNext?.resolve({ kind: "closed" });
        pendingNext = null;
    };
    /**
     * Rejects the current pending consumer.
     *
     * @param error Error cause.
     */
    const rejectPending = (error) => {
        pendingNext?.reject(error);
        pendingNext = null;
    };
    /**
     * Transitions the stream into a failed state.
     *
     * @param error Terminal stream error.
     */
    const fail = (error) => {
        terminalError = error;
        closed = true;
        isOpen = false;
        rejectPending(error);
    };
    /**
     * Gracefully finishes the stream.
     */
    const finish = () => {
        closed = true;
        isOpen = false;
        resolveClosed();
    };
    /**
     * Attaches WebSocket event handlers.
     *
     * @param ws Target WebSocket instance.
     */
    const setupSocketHandlers = (ws) => {
        /**
         * Flush queued outgoing messages once connected.
         */
        const onOpen = () => {
            if (closed) {
                closeSocket();
                return;
            }
            isOpen = true;
            while (sendQueue.length && ws.readyState === WS_OPEN) {
                const message = sendQueue.shift();
                try {
                    ws.send(JSON.stringify(message));
                }
                catch (error) {
                    console.warn("Failed to send queued WebSocket message:", error);
                }
            }
        };
        /**
         * Handles incoming socket messages.
         *
         * @param ev Browser message event.
         */
        const onMessage = (ev) => {
            if (closed)
                return;
            try {
                const value = JSON.parse(ev.data);
                if (pendingNext) {
                    pendingNext.resolve({
                        kind: "message",
                        value,
                    });
                    pendingNext = null;
                }
                else {
                    messageQueue.push(value);
                }
            }
            catch (error) {
                fail(error);
            }
        };
        /**
         * Handles graceful socket closure.
         */
        const onClose = () => {
            finish();
        };
        /**
         * Handles socket-level failures.
         */
        const onError = () => {
            fail(new Error("WebSocket error"));
        };
        ws.addEventListener("open", onOpen);
        ws.addEventListener("message", onMessage);
        ws.addEventListener("close", onClose);
        ws.addEventListener("error", onError);
        cleanupHandlers = () => {
            ws.removeEventListener("open", onOpen);
            ws.removeEventListener("message", onMessage);
            ws.removeEventListener("close", onClose);
            ws.removeEventListener("error", onError);
        };
    };
    /**
     * Starts socket initialization immediately so callers can interact with the
     * underlying WebSocket before the first subscription pull.
     */
    const initPromise = (async () => {
        try {
            const resolvedUrl = isPromiseLike(url) ? await url : url;
            const created = factory(resolvedUrl);
            socket = isPromiseLike(created)
                ? await created
                : created;
            setupSocketHandlers(socket);
            if (closed) {
                closeSocket();
            }
        }
        catch (error) {
            sendQueue.length = 0;
            fail(error);
            throw error;
        }
    })();
    /**
     * Internal stream generator implementation.
     *
     * @param signal Optional cancellation signal.
     */
    async function* generator(signal) {
        /**
         * Handles external cancellation.
         */
        const onAbort = () => {
            closed = true;
            isOpen = false;
            closeSocket();
            resolveClosed();
        };
        signal?.addEventListener("abort", onAbort, {
            once: true,
        });
        try {
            await initPromise;
            if (terminalError) {
                throw terminalError;
            }
            while (!closed && !signal?.aborted) {
                if (messageQueue.length) {
                    yield messageQueue.shift();
                    continue;
                }
                const next = await new Promise((resolve, reject) => {
                    pendingNext = {
                        resolve,
                        reject,
                    };
                });
                if (next.kind === "closed") {
                    return;
                }
                yield next.value;
            }
        }
        finally {
            signal?.removeEventListener("abort", onAbort);
            cleanupHandlers?.();
            cleanupHandlers = null;
            closeSocket();
        }
    }
    /**
     * Base reactive stream instance.
     */
    const stream = createStream("webSocket", generator);
    /**
     * Sends a message through the WebSocket.
     *
     * Messages are automatically queued while the socket is connecting.
     */
    stream.send = (message) => {
        if (closed) {
            return;
        }
        if (isOpen && socket?.readyState === WS_OPEN) {
            try {
                socket.send(JSON.stringify(message));
            }
            catch (error) {
                console.warn("Failed to send WebSocket message:", error);
            }
            return;
        }
        if (!socket || socket.readyState !== WS_OPEN) {
            sendQueue.push(message);
            return;
        }
    };
    /**
     * Closes the stream and underlying socket.
     */
    stream.close = () => {
        if (closed) {
            return;
        }
        closed = true;
        isOpen = false;
        sendQueue.length = 0;
        resolveClosed();
        closeSocket();
        cleanupHandlers?.();
        cleanupHandlers = null;
    };
    return stream;
}

/*
 * Public API Surface of streamix networking
 */

/**
 * Generated bundle index. Do not edit.
 */

export { createHttpClient, jsonp, readArrayBuffer, readBase64Chunk, readBinaryChunk, readBlob, readChunks, readCsvChunk, readFull, readJson, readJsonChunk, readNdjsonChunk, readStatus, readText, readTextChunk, useAccept, useBase, useCustom, useFallback, useHeader, useLogger, useOauth, useParams, useRedirect, useRetry, useStripHeaders, useTimeout, webSocket };
//# sourceMappingURL=epikodelabs-streamix-networking.mjs.map
