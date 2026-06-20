import {
  flow,
  isPromiseLike,
  normalizeError,
  type MaybePromise,
  type AtomBase,
} from "@epikodelabs/streamix";

/**
 * A bidirectional stream built on top of WebSocket.
 *
 * Incoming WebSocket messages are emitted through the stream,
 * while outgoing messages can be sent using {@link WebSocketStream.send}.
 *
 * @template T Message payload type.
 */
export type WebSocketStream<T = any> = AtomBase<T> & {
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
 * Internal pending consumer state for async iteration.
 *
 * Used when the generator is waiting for the next WebSocket message.
 *
 * @template T Message payload type.
 */
type PendingNext<T> = {
  /**
   * Resolves the pending consumer with either:
   * - a message value
   * - or a closed notification.
   */
  resolve: (value: { kind: "message"; value: T } | { kind: "closed" }) => void;

  /**
   * Rejects the pending consumer with an error.
   */
  reject: (error: unknown) => void;
};

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
export function webSocket<T = any>(
  url: MaybePromise<string>,
  factory: (url: string) => MaybePromise<WebSocket> = (u: string) => new WebSocket(u)
): WebSocketStream<T> {
  /**
   * Buffered incoming messages waiting to be consumed.
   */
  const messageQueue: T[] = [];

  /**
   * Buffered outgoing messages waiting for socket open.
   */
  const sendQueue: T[] = [];

  /**
   * Active WebSocket instance.
   */
  let socket: WebSocket | null = null;

  /**
   * Current pending async consumer.
   */
  let pendingNext: PendingNext<T> | null = null;

  /**
   * Cleanup callback for socket listeners.
   */
  let cleanupHandlers: (() => void) | null = null;

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
  let terminalError: unknown = null;

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
  const rejectPending = (error: unknown) => {
    pendingNext?.reject(error);
    pendingNext = null;
  };

  /**
   * Transitions the stream into a failed state.
   *
   * @param error Terminal stream error.
   */
  const fail = (error: unknown) => {
    const err = normalizeError(error);
    terminalError = err;
    closed = true;
    isOpen = false;

    rejectPending(err);
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
  const setupSocketHandlers = (ws: WebSocket) => {
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
        const message = sendQueue.shift()!;

        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          console.warn("Failed to send queued WebSocket message:", error);
        }
      }
    };

    /**
     * Handles incoming socket messages.
     *
     * @param ev Browser message event.
     */
    const onMessage = (ev: MessageEvent) => {
      if (closed) return;

      try {
        const value = JSON.parse(ev.data) as T;

        if (pendingNext) {
          pendingNext.resolve({
            kind: "message",
            value,
          });

          pendingNext = null;
        } else {
          messageQueue.push(value);
        }
      } catch (error) {
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
    } catch (error) {
      sendQueue.length = 0;
      const err = normalizeError(error);
      fail(err);
      throw err;
    }
  })();

  /**
   * Internal stream generator implementation.
   *
   * @param signal Optional cancellation signal.
   */
  async function* generator(signal?: AbortSignal) {
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
          yield messageQueue.shift()!;
          continue;
        }

        const next = await new Promise<
          { kind: "message"; value: T } | { kind: "closed" }
        >((resolve, reject) => {
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
    } finally {
      signal?.removeEventListener("abort", onAbort);

      cleanupHandlers?.();
      cleanupHandlers = null;

      closeSocket();
    }
  }

  /**
   * Base reactive stream instance.
   */
  const stream = flow<T>(generator) as WebSocketStream<T>;

  /**
   * Sends a message through the WebSocket.
   *
   * Messages are automatically queued while the socket is connecting.
   */
  stream.send = (message: T) => {
    if (closed) {
      return;
    }

    if (isOpen && socket?.readyState === WS_OPEN) {
      try {
        socket.send(JSON.stringify(message));
      } catch (error) {
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
