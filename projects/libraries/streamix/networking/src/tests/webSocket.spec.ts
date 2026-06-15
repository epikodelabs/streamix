import { iterate } from "@epikodelabs/streamix";
import { webSocket } from "@epikodelabs/streamix/networking";
import { idescribe } from "./env.spec";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  throwOnSend = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    this.readyState = 0;
  }

  addEventListener(event: string, handler: any) {
    (this as any)[`on${event}`] = handler;
  }
  removeEventListener(event: string, _handler: any) {
    (this as any)[`on${event}`] = null;
  }
  send(data: string) {
    if (this.throwOnSend) {
      throw new Error("Send failed");
    }
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  // Helpers to simulate WebSocket events
  triggerOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  triggerMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
  triggerRawMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }
  triggerClose() {
    this.readyState = 3;
    this.onclose?.();
  }
  triggerError() {
    this.onerror?.(new Event("error"));
  }
}

idescribe("webSocket", () => {
  let lastWs: MockWebSocket;
  let factory: jasmine.Spy;

  beforeEach(() => {
    factory = jasmine.createSpy("WebSocketFactory").and.callFake((url: string) => {
      lastWs = new MockWebSocket(url);
      return lastWs as any;
    });
  });

  it("should emit incoming messages", async () => {
    const stream = webSocket<any>("ws://test", factory);
    const iterator = iterate(stream)[Symbol.asyncIterator]();

    setTimeout(() => {
      lastWs.triggerMessage({ msg: 123 });
      lastWs.triggerClose();
    }, 1);

    const value = await iterator.next();
    expect(value.value).toEqual({ msg: 123 });
  });

  it("should send queued messages after open", async () => {
    const stream = webSocket<any>("ws://test", factory);

    stream.send({ cmd: "first" });
    stream.send({ cmd: "second" });

    lastWs.triggerOpen();

    expect(lastWs.sent.length).toBe(2);
    expect(lastWs.sent).toEqual([
      JSON.stringify({ cmd: "first" }),
      JSON.stringify({ cmd: "second" }),
    ]);
  });

  it("should propagate errors", async () => {
    const stream = webSocket<any>("ws://test", factory);
    const iterator = iterate(stream)[Symbol.asyncIterator]();

    setTimeout(() => lastWs.triggerError(), 1);

    try {
      await iterator.next();
      fail("Expected error to be thrown");
    } catch (err: any) {
      expect(err).toEqual(jasmine.any(Error));
      expect(err.message).toBe("WebSocket error");
    }
  });

  it("should close and cleanup on iterator return", async () => {
    const stream = webSocket<any>("ws://test", factory);
    const iterator = iterate(stream)[Symbol.asyncIterator]();

    lastWs.triggerOpen();
    spyOn(lastWs, "close").and.callThrough();

    await iterator.return?.(undefined);
    stream.close();
    expect(lastWs.close).toHaveBeenCalled();
  });

  it("should close a connecting socket on iterator return", async () => {
    const stream = webSocket<any>("ws://test", factory);
    const iterator = stream[Symbol.asyncIterator]();
    spyOn(lastWs, "close").and.callThrough();

    const pending = iterator.next();
    await iterator.return?.(undefined);
    await pending.catch(() => {});

    expect(lastWs.close).toHaveBeenCalled();
    expect(lastWs.readyState).toBe(3);
  });

  it("should reject when incoming message is not valid JSON", async () => {
    const stream = webSocket<any>("ws://test", factory);
    const iterator = iterate(stream)[Symbol.asyncIterator]();

    const next = iterator.next();
    setTimeout(() => lastWs.triggerRawMessage("{"), 1);

    await expectAsync(next).toBeRejected();
  });

  it("should complete gracefully when stream.close() is called", async () => {
    const stream = webSocket<any>("ws://test", factory);
    const iterator = iterate(stream)[Symbol.asyncIterator]();

    const next = iterator.next();
    stream.close();

    const result = await next;
    expect(result.done).toBe(true);
  });

  it("should not send after stream is closed", async () => {
    const stream = webSocket<any>("ws://test", factory);
    lastWs.triggerOpen();

    stream.close();
    stream.send({ cmd: "after-close" });

    expect(lastWs.sent).toEqual([]);
  });

  it("should warn if socket.send throws (open socket)", async () => {
    const stream = webSocket<any>("ws://test", factory);
    lastWs.triggerOpen();
    lastWs.throwOnSend = true;

    const warn = spyOn(console, "warn");
    stream.send({ cmd: "boom" });

    expect(warn).toHaveBeenCalled();
  });

  it("should warn if flushing queued messages fails on open", async () => {
    const stream = webSocket<any>("ws://test", factory);

    stream.send({ cmd: "queued" });
    lastWs.throwOnSend = true;

    const warn = spyOn(console, "warn");
    lastWs.triggerOpen();

    expect(warn).toHaveBeenCalled();
  });

  it("should queue messages when socket is not open", async () => {
    const stream = webSocket<any>("ws://test", factory);
    lastWs.readyState = 2; // CLOSING

    stream.send({ cmd: "nope" });
    lastWs.triggerOpen();

    expect(lastWs.sent).toEqual([JSON.stringify({ cmd: "nope" })]);
  });

  it("should close connecting sockets and drop queued messages when stream.close() is called", async () => {
    const stream = webSocket<any>("ws://test", factory);
    spyOn(lastWs, "close").and.callThrough();

    stream.send({ cmd: "queued" });
    stream.close();
    lastWs.triggerOpen();

    expect(lastWs.close).toHaveBeenCalled();
    expect(lastWs.sent).toEqual([]);
  });

  it("should close sockets created after close() when factory resolves asynchronously", async () => {
    let ws: MockWebSocket | undefined;
    const asyncFactory = jasmine.createSpy("asyncFactory").and.callFake((url: string) => {
      ws = new MockWebSocket(url);
      return Promise.resolve(ws as any);
    });

    const stream = webSocket<any>("ws://test", asyncFactory);
    stream.close();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ws).toBeDefined();
    expect(ws!.readyState).toBe(3);
  });

  it("should error if socket fails to initialize (rejected URL promise)", async () => {
    const stream = webSocket<any>(Promise.reject(new Error("bad url")), factory);
    const iterator = iterate(stream)[Symbol.asyncIterator]();

    await expectAsync(iterator.next()).toBeRejectedWithError("bad url");
  });

  it("should use the default factory when none is provided", async () => {
    const originalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = MockWebSocket as any;

    try {
      const stream = webSocket<any>("ws://test-default");
      const iterator = iterate(stream)[Symbol.asyncIterator]();

      const ws = MockWebSocket.instances.at(-1)!;
      setTimeout(() => {
        ws.triggerMessage({ ok: true });
        ws.triggerClose();
      }, 1);

      const value = await iterator.next();
      expect(value.value).toEqual({ ok: true });
    } finally {
      (globalThis as any).WebSocket = originalWebSocket;
    }
  });

  it("should await an async factory result", async () => {
    let ws: MockWebSocket | undefined;
    const asyncFactory = jasmine.createSpy("asyncFactory").and.callFake((url: string) => {
      ws = new MockWebSocket(url);
      return Promise.resolve(ws as any);
    });

    const stream = webSocket<any>("ws://test", asyncFactory);
    const iterator = iterate(stream)[Symbol.asyncIterator]();

    setTimeout(() => {
      ws!.triggerMessage({ v: 1 });
      ws!.triggerClose();
    }, 1);

    const value = await iterator.next();
    expect(value.value).toEqual({ v: 1 });
  });
});


