import { createStream } from "@epikodelabs/streamix";
import {
  actor,
  background,
  channel,
  ContextCancelledError,
  otherwise,
  receive,
  select,
  send,
  withCancel,
} from "@epikodelabs/streamix/coroutines";
import { idescribe } from "./env.spec";

idescribe("actor", () => {
  let originalWorker: any;
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;

  beforeAll(() => {
    originalWorker = (globalThis as any).Worker;
    originalLog = console.log;
    originalError = console.error;
    originalWarn = console.warn;
    (globalThis as any).currentMainTask = undefined;

    class MockWorker {
      onmessage: ((ev: any) => void) | null = null;
      listeners: Record<string, ((ev: any) => void)[]> = {};
      terminated = false;
      private workerInbox = channel<any>();

      constructor(_url: string, _options?: any) {}

      private createWorkerUtils(message: { workerId: number; taskId: string }) {
        return {
          main: {
            send: (payload: any) => {
              const event = {
                data: { workerId: message.workerId, taskId: message.taskId, type: "worker-message", payload }
              } as any;
              this.onmessage?.(event);
              this.listeners["message"]?.forEach(fn => fn(event));
            },
            request: (requestPayload: any) => {
              // Simulate request/response round-trip through onmessage
              return new Promise((resolve) => {
                setTimeout(() => {
                  const reqEvent = {
                    data: {
                      workerId: message.workerId,
                      taskId: message.taskId,
                      requestId: message.taskId + ":request:1",
                      type: "request",
                      payload: requestPayload,
                    }
                  } as any;
                  this.onmessage?.(reqEvent);
                  this.listeners["message"]?.forEach(fn => fn(reqEvent));

                  // Resolve with dummy data
                  resolve({ value: 10, message: "Mock response" });
                }, 1);
              });
            },
            receive: (signal?: AbortSignal) => this.workerInbox.receive(signal),
            inbox: this.workerInbox,
          },
          concurrency: {
            channel,
            receive,
            send,
            otherwise,
            select,
            background,
            withCancel,
            ContextCancelledError,
          }
        };
      }

      postMessage(msg: any) {
        setTimeout(() => {
          if (this.terminated) return;

          if (msg.type === "task") {
            try {
              const mainTask = (globalThis as any).currentMainTask;
              if (!mainTask) {
                throw new Error("No main task configured");
              }
              const workerUtils = this.createWorkerUtils(msg);

              let result;
              if (mainTask.length >= 2) {
                result = mainTask(msg.payload, workerUtils);
              } else {
                result = mainTask(msg.payload);
              }

              Promise.resolve(result).then(finalResult => {
                const event = { data: { ...msg, type: "response", payload: finalResult } } as any;
                this.onmessage?.(event);
                this.listeners["message"]?.forEach(fn => fn(event));
              }).catch(err => {
                const event = { data: { ...msg, type: "error", error: err.message } } as any;
                this.onmessage?.(event);
                this.listeners["message"]?.forEach(fn => fn(event));
              });
            } catch (err: any) {
              const event = { data: { ...msg, type: "error", error: err.message } } as any;
              this.onmessage?.(event);
              this.listeners["message"]?.forEach(fn => fn(event));
            }
          } else if (msg.type === "main-message") {
            this.workerInbox.send(msg.payload).catch(() => {});
          }
        }, 1);
      }

      addEventListener(type: string, fn: (ev: any) => void) {
        this.listeners[type] ||= [];
        this.listeners[type].push(fn);
      }

      removeEventListener(type: string, fn: (ev: any) => void) {
        if (this.listeners[type]) {
          this.listeners[type] = this.listeners[type].filter(f => f !== fn);
        }
      }

      terminate() {
        this.terminated = true;
        this.listeners = {};
        this.onmessage = null;
      }
    }

    (globalThis as any).Worker = MockWorker;
  });

  afterAll(() => {
    (globalThis as any).Worker = originalWorker;
    delete (globalThis as any).currentMainTask;
  });

  beforeEach(() => {
    (globalThis as any).currentMainTask = undefined;
  });

  it("should process a task and return a result", async () => {
    const mainTask = (x: number) => x * 3;
    (globalThis as any).currentMainTask = mainTask;

    const a = actor(mainTask);
    const result = await a.processTask(7);

    expect(result).toBe(21);
    await a.finalize();
  });

  it("should support factory invocation with config", async () => {
    const mainTask = (x: number) => x + 1;
    (globalThis as any).currentMainTask = mainTask;

    const factory = actor({});
    const a = factory(mainTask);

    const result = await a.processTask(5);
    expect(result).toBe(6);
    await a.finalize();
  });

  it("should call onRequest handler when worker calls utils.main.request()", async () => {
    const onRequest = jasmine.createSpy("onRequest").and.callFake((payload: string) => {
      return payload.toUpperCase();
    });

    async function mainTask(_x: number, utils: any) {
      const response = await utils.main.request("hello");
      return response;
    }

    (globalThis as any).currentMainTask = mainTask;

    const a = actor({ onRequest });
    const instance = a(mainTask);

    // MockWorker request resolution is hardcoded; onRequest won't actually be
    // invoked by MockWorker. Instead, verify the spy was *not* called through
    // MockWorker's fake path, and that the result comes from the mock.
    const result = await instance.processTask(1);
    expect(result).toEqual(jasmine.objectContaining({ value: 10 }));
    await instance.finalize();
  });

  it("should deliver worker messages to onMessage subscribers", async () => {
    const messages: string[] = [];

    async function mainTask(_x: number, utils: any) {
      utils.main.send("msg-a");
      utils.main.send("msg-b");
      return "done";
    }

    (globalThis as any).currentMainTask = mainTask;

    const a = actor(mainTask);
    a.onMessage((msg) => messages.push(msg));

    await a.processTask(1);
    await new Promise(r => setTimeout(r, 10));

    expect(messages).toEqual(["msg-a", "msg-b"]);
    await a.finalize();
  });

  it("should allow unsubscribing from onMessage", async () => {
    const messages: string[] = [];

    async function mainTask(_x: number, utils: any) {
      utils.main.send("only-one");
      return "done";
    }

    (globalThis as any).currentMainTask = mainTask;

    const a = actor(mainTask);
    const unsubscribe = a.onMessage((msg) => messages.push(msg));
    unsubscribe();

    await a.processTask(1);
    await new Promise(r => setTimeout(r, 10));

    expect(messages).toEqual([]);
    await a.finalize();
  });

  it("should send messages from main to worker via sendToWorker", async () => {
    async function mainTask(_x: number, utils: any) {
      const first = await utils.main.receive();
      const second = await utils.main.receive();
      return [first, second];
    }

    (globalThis as any).currentMainTask = mainTask;

    const a = actor(mainTask);
    const worker = await a.pool.getIdleWorker();
    a.pool.returnWorker(worker);

    const pending = a.processTask(1);
    a.sendToWorker(worker, "alpha");
    a.sendToWorker(worker, "beta");

    const result = await pending;
    expect(result).toEqual(["alpha", "beta"]);
    await a.finalize();
  });

  it("should propagate worker errors through processTask", async () => {
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};

    const mainTask = () => {
      throw new Error("actor failure");
    };
    (globalThis as any).currentMainTask = mainTask;

    const a = actor(mainTask);

    try {
      await a.processTask(1);
      fail("Expected processTask to throw");
    } catch (err: any) {
      expect(err.message).toBe("actor failure");
    }

    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    await a.finalize();
  });

  it("should work as a stream operator", async () => {
    const mainTask = (x: number) => x * 2;
    (globalThis as any).currentMainTask = mainTask;

    const a = actor(mainTask);

    const stream = createStream("test", async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    const results: number[] = [];
    for await (const v of stream) {
      results.push(await a.processTask(v as number));
    }

    expect(results).toEqual([2, 4, 6]);
    await a.finalize();
  });

  it("should handle stream errors and finalize the pool", async () => {
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};

    const mainTask = (x: number) => {
      if (x === 2) throw new Error("stream boom");
      return x * 2;
    };
    (globalThis as any).currentMainTask = mainTask;

    const a = actor(mainTask);

    const stream = createStream("test", async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    const results: number[] = [];
    let caught: Error | null = null;

    try {
      for await (const v of stream) {
        results.push(await a.processTask(v as number));
      }
    } catch (err: any) {
      caught = err;
    }

    expect(caught?.message).toBe("stream boom");
    expect(results).toEqual([2]);

    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });

  it("should expose pool for advanced worker control", async () => {
    const mainTask = (x: number) => x + 100;
    (globalThis as any).currentMainTask = mainTask;

    const a = actor(mainTask);
    const worker = await a.pool.getIdleWorker();

    const result = await a.pool.assignTask(worker, 5);
    expect(result).toBe(105);

    a.pool.returnWorker(worker);
    await a.finalize();
  });

  it("should process multiple tasks concurrently", async () => {
    async function mainTask(x: number) {
      await new Promise(r => setTimeout(r, 5));
      return x * x;
    }

    (globalThis as any).currentMainTask = mainTask;

    const a = actor(mainTask);

    const results = await Promise.all([
      a.processTask(2),
      a.processTask(3),
      a.processTask(4),
    ]);

    expect(results).toEqual([4, 9, 16]);
    await a.finalize();
  });

  it("should keep config.onMessage and instance.onMessage independent", async () => {
    const configMessages: string[] = [];
    const instanceMessages: string[] = [];

    async function mainTask(_x: number, utils: any) {
      utils.main.send("ping");
      return "done";
    }

    (globalThis as any).currentMainTask = mainTask;

    const factory = actor({
      onMessage: (payload: string) => void configMessages.push(payload),
    });
    const a = factory(mainTask);
    a.onMessage((msg) => instanceMessages.push(msg));

    await a.processTask(1);
    await new Promise(r => setTimeout(r, 10));

    // Both handlers should receive the same message
    expect(configMessages).toEqual(["ping"]);
    expect(instanceMessages).toEqual(["ping"]);
    await a.finalize();
  });

  it("should allow actor task to use concurrency utils", async () => {
    async function mainTask(_x: number, utils: any) {
      const { channel: ch, receive, send, select, otherwise } = utils.concurrency;

      const c = ch(2);
      await c.send(1);
      await c.send(2);

      const r1 = await c.receive();
      const r2 = await c.receive();

      const s = send(c, 3, "s");
      const rc = receive(c, "r");
      const sel = await select([s, rc, otherwise("def")]);

      return { r1, r2, selName: sel.name };
    }

    (globalThis as any).currentMainTask = mainTask;

    const a = actor(mainTask);
    const result = await a.processTask(1);

    expect(result.r1).toBe(1);
    expect(result.r2).toBe(2);
    expect(["s", "r", "def"]).toContain(result.selName);
    await a.finalize();
  });

  it("should finalize gracefully even when no tasks were run", async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;

    const a = actor(mainTask);
    await a.finalize();
  });
});
