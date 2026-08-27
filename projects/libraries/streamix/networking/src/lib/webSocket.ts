import { AsyncQueue, flow, normalizeError, type MaybePromise, type Stream } from './stream';

const CONNECTING = 0;
const OPEN = 1;

export type WebSocketData = Parameters<WebSocket['send']>[0];

export type WebSocketCodec<T> = {
  encode(value: T): WebSocketData;
  decode(data: unknown): T;
};

export type WebSocketFactory = (url: string) => MaybePromise<WebSocket>;

export type WebSocketOptions<T> = {
  codec: WebSocketCodec<T>;
  factory?: WebSocketFactory;
};

export type WebSocketStream<T = unknown> = Stream<T> & {
  send(message: T): void;
  close(): void;
};

const isPromiseLike = <T>(value: MaybePromise<T>): value is PromiseLike<T> =>
  value !== null &&
  (typeof value === 'object' || typeof value === 'function') &&
  typeof (value as PromiseLike<T>).then === 'function';

export const jsonWebSocketCodec: WebSocketCodec<unknown> = {
  encode: (value) => JSON.stringify(value),
  decode: (data) => {
    if (typeof data !== 'string') {
      throw new TypeError('Expected a text WebSocket message');
    }
    return JSON.parse(data);
  },
};

export const textWebSocketCodec: WebSocketCodec<string> = {
  encode: (value) => value,
  decode: (data) => {
    if (typeof data !== 'string') {
      throw new TypeError('Expected a text WebSocket message');
    }
    return data;
  },
};

export function webSocket<T>(
  url: string,
  options: WebSocketOptions<T>,
): WebSocketStream<T> {
  const { codec } = options;
  const factory = options.factory ?? ((target: string) => new WebSocket(target));
  const incoming = new AsyncQueue<T>();
  const outgoing: WebSocketData[] = [];

  let socket: WebSocket | undefined;
  let cleanup: (() => void) | undefined;
  let closed = false;
  let failure: Error | undefined;

  const closeSocket = () => {
    if (socket && (socket.readyState === CONNECTING || socket.readyState === OPEN)) {
      socket.close();
    }
  };

  const release = () => {
    cleanup?.();
    cleanup = undefined;
  };

  const finish = () => {
    if (closed) return;
    closed = true;
    outgoing.length = 0;
    incoming.close();
    release();
  };

  const fail = (error: unknown) => {
    if (closed) return;
    failure = normalizeError(error);
    closed = true;
    outgoing.length = 0;
    incoming.fail(failure);
    release();
    closeSocket();
  };

  const sendEncoded = (data: WebSocketData, queued: boolean) => {
    try {
      socket!.send(data);
    } catch (error) {
      console.warn(
        queued
          ? 'Failed to send queued WebSocket message:'
          : 'Failed to send WebSocket message:',
        error,
      );
    }
  };

  const attachSocket = (ws: WebSocket) => {
    socket = ws;

    const onOpen = () => {
      if (closed) {
        closeSocket();
        return;
      }

      while (outgoing.length && ws.readyState === OPEN) {
        sendEncoded(outgoing.shift()!, true);
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (closed) return;
      try {
        incoming.push(codec.decode(event.data));
      } catch (error) {
        fail(error);
      }
    };

    const onClose = () => finish();
    const onError = () => fail(new Error('WebSocket error'));

    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);

    cleanup = () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
    };

    if (closed) {
      closeSocket();
    }
  };

  let init: Promise<void>;
  try {
    const created = factory(url);

    if (isPromiseLike(created)) {
      init = Promise.resolve(created)
        .then((ws) => {
          if (ws) attachSocket(ws);
        })
        .catch((error) => {
          fail(error);
        });
    } else {
      attachSocket(created);
      init = Promise.resolve();
    }
  } catch (error) {
    fail(error);
    init = Promise.resolve();
  }

  const stream = flow<T>(async function* (signal) {
    const abort = () => {
      finish();
      closeSocket();
    };

    signal.addEventListener('abort', abort, { once: true });

    try {
      await init;
      if (failure) throw failure;

      while (!signal.aborted) {
        const result = await incoming.next();
        if (result.done) return;
        yield result.value;
      }
    } finally {
      signal.removeEventListener('abort', abort);
      release();
      closeSocket();
    }
  }) as WebSocketStream<T>;

  stream.send = (message) => {
    if (closed) return;

    let data: WebSocketData;
    try {
      data = codec.encode(message);
    } catch (error) {
      console.warn('Failed to encode WebSocket message:', error);
      return;
    }

    if (!socket || socket.readyState === CONNECTING) {
      outgoing.push(data);
      return;
    }

    if (socket.readyState === OPEN) {
      sendEncoded(data, false);
    }
  };

  stream.close = () => {
    if (closed) return;
    finish();
    closeSocket();
    release();
  };

  return stream;
}
