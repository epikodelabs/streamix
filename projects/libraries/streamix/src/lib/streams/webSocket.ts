import { createStream, MaybePromise, Stream } from "../abstractions";

/**
 * A stream that represents a WebSocket-like interface.
 * Extends a standard Stream with a `.send()` method to send messages.
 *
 * @template T The type of messages sent and received.
 */
export type WebSocketStream<T = any> = Stream<T> & {
  /** Sends a JSON-serializable message to the WebSocket server. */
  send: (message: T) => void;
  /** Close the WebSocket and stop the generator */
  close: () => void;
};

/** Factory type for dependency injection of WebSocket (mockable in tests) */
export type WebSocketFactory = (url: string) => WebSocket;

/**
 * Creates a WebSocket stream for bidirectional communication with a server.
 *
 * Incoming messages from the WebSocket are emitted as stream values.
 * Outgoing messages are sent via the `.send()` method.
 * Messages sent before the connection is open are queued automatically.
 *
 * @template T - Type of messages to send and receive.
 * @param url The WebSocket URL (can be a Promise).
 * @param factory Optional WebSocket factory for dependency injection (useful for testing, can be a Promise).
 * @returns {WebSocketStream<T>} A WebSocketStream that can be used to
 * send and receive messages of type T.
 */
export function webSocket<T = any>(
  url: MaybePromise<string>,
  factory: MaybePromise<WebSocketFactory> = (u: string) => new WebSocket(u)
): WebSocketStream<T> {
  const messageQueue: T[] = [];
  const sendQueue: T[] = [];
  let resolveNext: ((value: T) => void) | null = null;
  let rejectNext: ((error: any) => void) | null = null;
  let isOpen = false;
  let done = false;
  let socket: WebSocket | null = null;

  // Helper to initialize the WebSocket
  const initWebSocket = async () => {
    try {
      const [resolvedUrl, resolvedFactory] = await Promise.all([
        Promise.resolve(url),
        Promise.resolve(factory)
      ]);
      
      socket = resolvedFactory(resolvedUrl);
      setupSocketHandlers();
    } catch (error) {
      done = true;
      if (rejectNext) {
        rejectNext(error);
        resolveNext = rejectNext = null;
      }
    }
  };

  // Check if we can initialize synchronously
  const urlIsPromise = url && typeof (url as any).then === 'function';
  const factoryIsPromise = factory && typeof (factory as any).then === 'function';
  
  const setupSocketHandlers = () => {
    if (!socket) return;

    const onOpen = () => {
      isOpen = true;
      while (sendQueue.length) {
        try {
          socket!.send(JSON.stringify(sendQueue.shift()!));
        } catch (error) {
          console.warn("Failed to send queued message:", error);
        }
      }
    };

    const onMessage = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        messageQueue.push(data);
        if (resolveNext) {
          resolveNext(messageQueue.shift()!);
          resolveNext = rejectNext = null;
        }
      } catch (err) {
        if (rejectNext) {
          rejectNext(err);
          resolveNext = rejectNext = null;
        }
      }
    };

    const onClose = () => {
      done = true;
      isOpen = false;
      if (rejectNext) {
        rejectNext(new Error("WebSocket closed"));
        resolveNext = rejectNext = null;
      }
    };

    const onError = () => {
      done = true;
      isOpen = false;
      if (rejectNext) {
        rejectNext(new Error("WebSocket error"));
        resolveNext = rejectNext = null;
      }
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
  };

  if (!urlIsPromise && !factoryIsPromise) {
    // Synchronous initialization
    try {
      const syncUrl = url as string;
      const syncFactory = factory as WebSocketFactory;
      socket = syncFactory(syncUrl);
      setupSocketHandlers();
    } catch (error) {
      done = true;
      // Error will be thrown when generator tries to yield
    }
  } else {
    // Asynchronous initialization - start it but don't wait
    initWebSocket();
  }

  async function* generator() {
    try {
      // Wait for socket initialization if it's happening asynchronously
      if (!socket && !done) {
        await new Promise<void>((resolve) => {
          const checkSocket = () => {
            if (socket || done) {
              resolve();
            } else {
              setTimeout(checkSocket, 0);
            }
          };
          checkSocket();
        });
      }

      if (done) {
        throw new Error("WebSocket failed to initialize");
      }

      while (!done) {
        if (messageQueue.length) {
          yield messageQueue.shift()!;
        } else {
          yield await new Promise<T>((resolve, reject) => {
            resolveNext = resolve;
            rejectNext = reject;
          });
        }
      }
    } finally {
      if (socket) {
        // Clean up event listeners
        const cleanup = () => {
          const listeners = socket!;
          listeners.close();
        };
        
        cleanup();
      }
    }
  };

  const stream = createStream<T>("webSocket", generator) as WebSocketStream<T>;

  // Send method
  stream.send = (msg: T) => {
    if (done) {
      return;
    }

    if (isOpen && socket) {
      try {
        socket.send(JSON.stringify(msg));
      } catch (error) {
        console.warn("Failed to send message:", error);
      }
    } else if (socket && socket.readyState === WebSocket.CONNECTING) {
      sendQueue.push(msg);
    } else if (!socket) {
      // Socket not initialized yet - queue the message
      sendQueue.push(msg);
    } else {
      console.warn("Cannot send message: WebSocket is not open");
    }
  };

  stream.close = () => {
    done = true;
    isOpen = false;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
    if (rejectNext) {
      rejectNext(new Error("WebSocket closed"));
      resolveNext = rejectNext = null;
    }
  };

  return stream;
}