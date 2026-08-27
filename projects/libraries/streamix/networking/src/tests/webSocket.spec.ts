import {
  jsonWebSocketCodec,
  textWebSocketCodec,
  webSocket,
  type WebSocketCodec,
} from '@epikodelabs/streamix/networking';
import { idescribe } from './env.spec';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  throwOnSend = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(event: string, handler: any) {
    (this as any)[`on${event}`] = handler;
  }

  removeEventListener(event: string, _handler: any) {
    (this as any)[`on${event}`] = null;
  }

  send(data: unknown) {
    if (this.throwOnSend) throw new Error('Send failed');
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  triggerOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  triggerMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  triggerRawMessage(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }

  triggerClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  triggerError() {
    this.onerror?.(new Event('error'));
  }
}

idescribe('webSocket', () => {
  let lastWs: MockWebSocket;
  let factory: jasmine.Spy;

  beforeEach(() => {
    factory = jasmine.createSpy('WebSocketFactory').and.callFake((url: string) => {
      lastWs = new MockWebSocket(url);
      return lastWs as any;
    });
  });

  it('emits incoming JSON messages with the JSON codec', async () => {
    const stream = webSocket<any>('ws://test', { factory, codec: jsonWebSocketCodec });
    const iterator = stream[Symbol.asyncIterator]();

    setTimeout(() => {
      lastWs.triggerMessage({ msg: 123 });
      lastWs.triggerClose();
    }, 1);

    const value = await iterator.next();
    expect(value.value).toEqual({ msg: 123 });
  });

  it('sends queued JSON messages after open', () => {
    const stream = webSocket<any>('ws://test', { factory, codec: jsonWebSocketCodec });

    stream.send({ cmd: 'first' });
    stream.send({ cmd: 'second' });
    lastWs.triggerOpen();

    expect(lastWs.sent).toEqual([
      JSON.stringify({ cmd: 'first' }),
      JSON.stringify({ cmd: 'second' }),
    ]);
  });

  it('supports the text codec', async () => {
    const stream = webSocket('ws://test', {
      factory,
      codec: textWebSocketCodec,
    });
    const iterator = stream[Symbol.asyncIterator]();

    stream.send('hello');
    lastWs.triggerOpen();
    expect(lastWs.sent).toEqual(['hello']);

    setTimeout(() => {
      lastWs.triggerRawMessage('world');
      lastWs.triggerClose();
    }, 1);

    expect((await iterator.next()).value).toBe('world');
  });

  it('supports a custom codec', async () => {
    type Message = { value: number };
    const codec: WebSocketCodec<Message> = {
      encode: (message) => `v:${message.value}`,
      decode: (data) => ({ value: Number(String(data).slice(2)) }),
    };

    const stream = webSocket<Message>('ws://test', { factory, codec });
    const iterator = stream[Symbol.asyncIterator]();

    stream.send({ value: 7 });
    lastWs.triggerOpen();
    expect(lastWs.sent).toEqual(['v:7']);

    setTimeout(() => {
      lastWs.triggerRawMessage('v:9');
      lastWs.triggerClose();
    }, 1);

    expect((await iterator.next()).value).toEqual({ value: 9 });
  });


  it('propagates factory failures without creating an unhandled initialization path', async () => {
    const failedFactory = jasmine
      .createSpy('WebSocketFactory')
      .and.rejectWith(new Error('synapse failed'));
    const stream = webSocket<any>('ws://test', { factory: failedFactory, codec: jsonWebSocketCodec });

    await expectAsync(stream[Symbol.asyncIterator]().next()).toBeRejectedWithError(
      'synapse failed',
    );
  });

  it('rejects non-text frames when using the JSON codec', async () => {
    const stream = webSocket<any>('ws://test', { factory, codec: jsonWebSocketCodec });
    const next = stream[Symbol.asyncIterator]().next();

    setTimeout(() => lastWs.triggerRawMessage(new Uint8Array([1, 2, 3])), 1);

    await expectAsync(next).toBeRejectedWithError('Expected a text WebSocket message');
  });

  it('propagates socket errors', async () => {
    const stream = webSocket<any>('ws://test', { factory, codec: jsonWebSocketCodec });
    const next = stream[Symbol.asyncIterator]().next();

    setTimeout(() => lastWs.triggerError(), 1);

    await expectAsync(next).toBeRejectedWithError('WebSocket error');
  });

  it('propagates decode errors', async () => {
    const stream = webSocket<any>('ws://test', { factory, codec: jsonWebSocketCodec });
    const next = stream[Symbol.asyncIterator]().next();

    setTimeout(() => lastWs.triggerRawMessage('{'), 1);

    await expectAsync(next).toBeRejected();
  });

  it('warns and drops messages that fail to encode', () => {
    const codec: WebSocketCodec<string> = {
      encode: () => {
        throw new Error('encode failed');
      },
      decode: String,
    };
    const warn = spyOn(console, 'warn');
    const stream = webSocket('ws://test', { factory, codec });

    stream.send('boom');
    lastWs.triggerOpen();

    expect(warn).toHaveBeenCalled();
    expect(lastWs.sent).toEqual([]);
  });

  it('warns if socket.send throws for an open socket', () => {
    const stream = webSocket<any>('ws://test', { factory, codec: jsonWebSocketCodec });
    lastWs.triggerOpen();
    lastWs.throwOnSend = true;
    const warn = spyOn(console, 'warn');

    stream.send({ cmd: 'boom' });

    expect(warn).toHaveBeenCalled();
  });

  it('warns if flushing a queued message fails', () => {
    const stream = webSocket<any>('ws://test', { factory, codec: jsonWebSocketCodec });
    stream.send({ cmd: 'queued' });
    lastWs.throwOnSend = true;
    const warn = spyOn(console, 'warn');

    lastWs.triggerOpen();

    expect(warn).toHaveBeenCalled();
  });

  it('does not queue sends after the native socket starts closing', () => {
    const stream = webSocket<any>('ws://test', { factory, codec: jsonWebSocketCodec });
    lastWs.readyState = 2;

    stream.send({ cmd: 'nope' });

    expect(lastWs.sent).toEqual([]);
  });

  it('drains buffered messages before graceful socket completion', async () => {
    const stream = webSocket<any>('ws://test', { factory, codec: jsonWebSocketCodec });
    const iterator = stream[Symbol.asyncIterator]();

    lastWs.triggerMessage({ buffered: true });
    lastWs.triggerClose();

    expect((await iterator.next()).value).toEqual({ buffered: true });
    expect((await iterator.next()).done).toBe(true);
  });

  it('completes gracefully when stream.close() is called', async () => {
    const stream = webSocket<any>('ws://test', { factory, codec: jsonWebSocketCodec });
    const iterator = stream[Symbol.asyncIterator]();
    const next = iterator.next();

    stream.close();

    expect((await next).done).toBe(true);
  });

  it('does not send after stream.close()', () => {
    const stream = webSocket<any>('ws://test', { factory, codec: jsonWebSocketCodec });
    lastWs.triggerOpen();

    stream.close();
    stream.send({ cmd: 'after-close' });

    expect(lastWs.sent).toEqual([]);
  });

  it('closes and drops queued messages when close() is called before open', () => {
    const stream = webSocket<any>('ws://test', { factory, codec: jsonWebSocketCodec });
    spyOn(lastWs, 'close').and.callThrough();

    stream.send({ cmd: 'queued' });
    stream.close();

    expect(lastWs.close).toHaveBeenCalled();
    expect(lastWs.sent).toEqual([]);
  });

  it('closes a socket created after close() when the factory resolves asynchronously', async () => {
    let resolveSocket!: (value: WebSocket) => void;
    const delayedFactory = jasmine.createSpy('WebSocketFactory').and.returnValue(
      new Promise<WebSocket>((resolve) => {
        resolveSocket = resolve;
      }),
    );

    const stream = webSocket<any>('ws://test', { factory: delayedFactory, codec: jsonWebSocketCodec });
    stream.close();

    const ws = new MockWebSocket('ws://test');
    resolveSocket(ws as any);
    await Promise.resolve();
    await Promise.resolve();

    expect(ws.readyState).toBe(3);
  });

  it('uses the default factory when none is provided', async () => {
    const originalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = MockWebSocket as any;

    try {
      const stream = webSocket<any>('ws://test-default', { codec: jsonWebSocketCodec });
      const iterator = stream[Symbol.asyncIterator]();
      const ws = MockWebSocket.instances.at(-1)!;

      setTimeout(() => {
        ws.triggerMessage({ ok: true });
        ws.triggerClose();
      }, 1);

      expect((await iterator.next()).value).toEqual({ ok: true });
    } finally {
      (globalThis as any).WebSocket = originalWebSocket;
    }
  });
});
