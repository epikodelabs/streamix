import {
  actor,
  background,
  channel,
  ContextCancelledError,
  main,
  otherwise,
  receive,
  select,
  send,
  withCancel,
} from "@epikodelabs/streamix/coroutines";
import {
  idescribe
} from "./env.spec";

idescribe("actor", () => {
  let originalWorker: any;
  let _originalLog: typeof console.log;
  let _originalError: typeof console.error;
  let _originalWarn: typeof console.warn;

  beforeAll(() => {
    originalWorker = (globalThis as any).Worker;
    _originalLog = console.log;
    _originalError = console.error;
    _originalWarn = console.warn;
    (globalThis as any).currentMainTask = undefined;

    class MockWorker {
      onmessage: ((ev: any) => void) | null = null;
      listeners: Record<string, ((ev: any) => void)[]> = {};
      terminated = false;
      private workerInbox = channel<any>();
      private actorState: any = undefined;
      private actorRunning = false;
      private workerId = 1;
      private taskId = "";
      private pendingWorkerRequests = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
      private requestCounter = 0;

      constructor(_url: string, _options?: any) {
        this.workerId = Math.floor(Math.random() * 100000);
      }

      private createWorkerUtils(message: { workerId: number; taskId: string }) {
        const outbox = {
          send: (payload: any) => {
            const event = {
              data: { workerId: message.workerId, taskId: message.taskId, type: "notify", payload }
            } as any;
            this.onmessage?.(event);
            this.listeners["message"]?.forEach(fn => fn(event));
          },
          request: (requestPayload: any) => {
            return new Promise((resolve, reject) => {
              this.requestCounter += 1;
              const requestId = message.taskId + ":request:" + this.requestCounter;
              this.pendingWorkerRequests.set(requestId, { resolve, reject });

              setTimeout(() => {
                const reqEvent = {
                  data: {
                    workerId: message.workerId,
                    taskId: message.taskId,
                    requestId,
                    type: "request",
                    payload: requestPayload,
                  }
                } as any;
                this.onmessage?.(reqEvent);
                this.listeners["message"]?.forEach(fn => fn(reqEvent));
              }, 1);
            });
          },
        };
        return {
          outbox,
          inbox: {
            receive: (signal?: AbortSignal) => this.workerInbox.receive(signal),
            channel: this.workerInbox,
          },
          get main() { return outbox; },
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

      private async runBehaviorLoop(_msg: any) {
        const utils = this.createWorkerUtils({ workerId: this.workerId, taskId: this.taskId });
        const mainTask = (globalThis as any).currentMainTask;
        if (!mainTask) return;

        while (this.actorRunning && !this.terminated) {
          const envelope = await this.workerInbox.receive();
          if (!envelope) break;

          let item = envelope;
          let requestId = null;

          if (envelope && typeof envelope === "object" && "requestId" in envelope) {
            requestId = envelope.requestId;
            item = envelope.msg;
          }

          try {
            const result = await Promise.resolve(mainTask(item, this.actorState, utils));
            this.actorState = result;

            if (requestId) {
              const event = {
                data: { workerId: this.workerId, taskId: this.taskId, requestId, type: "response", payload: result }
              } as any;
              this.onmessage?.(event);
              this.listeners["message"]?.forEach(fn => fn(event));
            }
          } catch (err: any) {
            if (requestId) {
              const event = {
                data: { workerId: this.workerId, taskId: this.taskId, requestId, type: "error", error: err.message }
              } as any;
              this.onmessage?.(event);
              this.listeners["message"]?.forEach(fn => fn(event));
            } else {
              const event = {
                data: { workerId: this.workerId, taskId: this.taskId, type: "notify", payload: { type: "error", error: err.message } }
              } as any;
              this.onmessage?.(event);
              this.listeners["message"]?.forEach(fn => fn(event));
            }
          }
        }

        this.actorRunning = false;
        const stoppedEvent = { data: { workerId: this.workerId, taskId: this.taskId, type: "stopped" } } as any;
        this.onmessage?.(stoppedEvent);
        this.listeners["message"]?.forEach(fn => fn(stoppedEvent));
      }

      postMessage(msg: any) {
        setTimeout(() => {
          if (this.terminated) return;

          if (msg.type === "init") {
            this.taskId = msg.taskId;
            this.actorState = msg.payload;
            this.actorRunning = true;
            this.runBehaviorLoop(msg);
          } else if (msg.type === "stop") {
            this.actorRunning = false;
            this.workerInbox.close();
          } else if (msg.type === "notify") {
            this.workerInbox.send(msg.payload).catch(() => {});
          } else if (msg.type === "request" && msg.requestId) {
            this.workerInbox.send({ msg: msg.payload, requestId: msg.requestId }).catch(() => {});
          } else if (msg.type === "request") {
            this.workerInbox.send(msg.payload).catch(() => {});
          } else if ((msg.type === "response" || msg.type === "error") && msg.requestId) {
            const pending = this.pendingWorkerRequests.get(msg.requestId);
            if (pending) {
              this.pendingWorkerRequests.delete(msg.requestId);
              if (msg.type === "response") {
                pending.resolve(msg.payload);
              } else {
                pending.reject(new Error(msg.error || "Mock worker request failed"));
              }
            }
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
        this.actorRunning = false;
        this.workerInbox.close();
        this.listeners = {};
        this.onmessage = null;
      }
    }

    (globalThis as any).Worker = MockWorker;
  });

  afterAll(() => {
    (globalThis as any).Worker = originalWorker;
    console.log = _originalLog;
    console.error = _originalError;
    console.warn = _originalWarn;
    delete (globalThis as any).currentMainTask;
  });

  beforeEach(() => {
    (globalThis as any).currentMainTask = undefined;
  });

  it("should eagerly initialize behavior actor with state", async () => {
    async function behavior(msg: string, state: number) {
      return state + (msg === "inc" ? 1 : -1);
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(0);
    await new Promise(r => setTimeout(r, 10));
    expect(a.running).toBe(true);

    main.outbox.send(a, "inc");
    await new Promise(r => setTimeout(r, 10));
    expect(a.running).toBe(true);

    await a.finalize();
  });

  it("should process multiple sends and update state", async () => {
    async function behavior(msg: { type: string; n: number }, state: number) {
      if (msg.type === "add") return state + msg.n;
      if (msg.type === "sub") return state - msg.n;
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(10);
    main.outbox.send(a, { type: "add", n: 5 });
    main.outbox.send(a, { type: "sub", n: 3 });
    main.outbox.send(a, { type: "add", n: 2 });

    const state = await main.outbox.request(a, { type: "add", n: 0 });
    expect(state).toBe(14);

    await a.finalize();
  });

  it("should request and receive updated state", async () => {
    async function behavior(msg: number, state: number) {
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(0);

    const s1 = await main.outbox.request(a, 5);
    expect(s1).toBe(5);

    const s2 = await main.outbox.request(a, 3);
    expect(s2).toBe(8);

    await a.finalize();
  });

  it("should deliver worker messages to onMessage subscribers", async () => {
    const messages: string[] = [];

    async function behavior(msg: string, state: number, utils: any) {
      if (msg === "ping") {
        utils.outbox.send("pong");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(0);
    main.inbox.receive(a, (msg: string) => messages.push(msg));

    main.outbox.send(a, "ping");
    await new Promise(r => setTimeout(r, 20));

    expect(messages).toEqual(["pong"]);
    await a.finalize();
  });

  it("should allow unsubscribing from onMessage", async () => {
    const messages: string[] = [];

    async function behavior(msg: string, state: number, utils: any) {
      if (msg === "ping") {
        utils.outbox.send("pong");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(0);
    const unsubscribe = main.inbox.receive(a, (msg: string) => messages.push(msg));
    unsubscribe();

    main.outbox.send(a, "ping");
    await new Promise(r => setTimeout(r, 20));

    expect(messages).toEqual([]);
    await a.finalize();
  });

  it("should stop behavior actor gracefully", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(0);
    main.outbox.send(a, "anything");
    await new Promise(r => setTimeout(r, 10));
    expect(a.running).toBe(true);

    a.stop();
    await new Promise(r => setTimeout(r, 50));
    expect(a.running).toBe(false);

    await a.finalize();
  });

  it("should use concurrency utils inside behavior actor", async () => {
    async function behavior(_msg: any, state: number, utils: any) {
      const { channel: ch, receive, send, select, otherwise } = utils.concurrency;
      const c = ch(2);
      await c.send(1);
      await c.send(2);
      const r1 = await c.receive();
      const r2 = await c.receive();
      const s = send(c, 3, "s");
      const rc = receive(c, "r");
      const sel = await select([s, rc, otherwise("def")]);
      return { state, r1, r2, selName: sel.name };
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior as any)(42);
    const result = await main.outbox.request(a, "go") as any;

    expect(result.state).toBe(42);
    expect(result.r1).toBe(1);
    expect(result.r2).toBe(2);
    expect(["s", "r", "def"]).toContain(result.selName);
    await a.finalize();
  });

  it("should reject request after stop", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(0);
    main.outbox.send(a, "x");
    await new Promise(r => setTimeout(r, 10));

    a.stop();
    await expectAsync(main.outbox.request(a, "y")).toBeRejectedWithError("Actor stopped");
    await a.finalize();
  });

  it("should support factory invocation with config", async () => {
    async function behavior(msg: number, state: number) {
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;

    const factory = actor({});
    const a = factory(behavior)(5);

    const state = await main.outbox.request(a, 10);
    expect(state).toBe(15);
    await a.finalize();
  });

  it("should call onRequest handler when worker calls utils.outbox.request()", async () => {
    const onRequest = jasmine.createSpy("onRequest").and.callFake((payload: string) => {
      return payload.toUpperCase();
    });

    async function behavior(msg: string, state: number, utils: any) {
      const response = await utils.outbox.request(msg);
      utils.outbox.send(response);
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor({ onRequest })(behavior)(0);
    main.outbox.send(a, "hello");
    await new Promise(r => setTimeout(r, 20));

    expect(onRequest).toHaveBeenCalled();
    await a.finalize();
  });

  it("should keep config.onMessage and instance.onMessage independent", async () => {
    const configMessages: string[] = [];
    const instanceMessages: string[] = [];

    async function behavior(msg: string, state: number, utils: any) {
      if (msg === "go") {
        utils.outbox.send("ping");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const factory = actor({
      onMessage: (payload: string) => void configMessages.push(payload),
    });
    const a = factory(behavior)(0);
    main.inbox.receive(a, (msg: string) => instanceMessages.push(msg));

    main.outbox.send(a, "go");
    await new Promise(r => setTimeout(r, 20));

    expect(configMessages).toEqual(["ping"]);
    expect(instanceMessages).toEqual(["ping"]);
    await a.finalize();
  });
});
