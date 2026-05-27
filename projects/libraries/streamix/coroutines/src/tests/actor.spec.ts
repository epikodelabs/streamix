import {
  actor,
  background,
  channel,
  ContextCancelledError,
  isActorBusMessage,
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
  let actorCounter = 0;

  const nextActorName = () => `actor-${++actorCounter}`;

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
        const post = (payload: any) => {
          const event = {
            data: { workerId: message.workerId, taskId: message.taskId, type: "notify", payload }
          } as any;
          this.onmessage?.(event);
          this.listeners["message"]?.forEach(fn => fn(event));
        };
        const outbox = {
          request: (to: string | string[], topic: string, requestPayload: any) => {
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
                    to,
                    topic,
                    type: "request",
                    payload: requestPayload,
                  }
                } as any;
                this.onmessage?.(reqEvent);
                this.listeners["message"]?.forEach(fn => fn(reqEvent));
              }, 1);
            });
          },
          send: (to: string | string[], topic: string, payload: any) => {
            post({ kind: "actor-bus", to, topic, payload });
          },
        };
        return {
          outbox,
          inbox: {
            listen: (signal?: AbortSignal) => this.workerInbox.receive(signal),
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
          },
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
    actorCounter = 0;
    main.bus.clear();
  });

  it("should eagerly initialize behavior actor with state", async () => {
    async function behavior(msg: string, state: number) {
      return state + (msg === "inc" ? 1 : -1);
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(nextActorName(), 0);
    await new Promise(r => setTimeout(r, 10));
    expect(a.running).toBe(true);

    main.send(a, "inc");
    await new Promise(r => setTimeout(r, 10));
    expect(a.running).toBe(true);

    await main.outbox.stop(a);
  });

  it("should process multiple sends and update state", async () => {
    async function behavior(msg: { type: string; n: number }, state: number) {
      if (msg.type === "add") return state + msg.n;
      if (msg.type === "sub") return state - msg.n;
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(nextActorName(), 10);
    main.send(a, { type: "add", n: 5 });
    main.send(a, { type: "sub", n: 3 });
    main.send(a, { type: "add", n: 2 });

    const state = await main.outbox.request(a, { type: "add", n: 0 });
    expect(state).toBe(14);

    await main.outbox.stop(a);
  });

  it("should request and receive updated state", async () => {
    async function behavior(msg: number, state: number) {
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(nextActorName(), 0);

    const s1 = await main.outbox.request(a, 5);
    expect(s1).toBe(5);

    const s2 = await main.outbox.request(a, 3);
    expect(s2).toBe(8);

    await main.outbox.stop(a);
  });

  it("should deliver direct bus messages to main listeners", async () => {
    const messages: Array<{ topic: string; payload: string; from?: string }> = [];

    async function behavior(msg: string, state: number, utils: any) {
      if (msg === "ping") {
        utils.outbox.send("main", "reply", "pong");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(nextActorName(), 0);
    const unsubscribe = main.bus.listen("main", (message) => {
      messages.push({ topic: message.topic, payload: message.payload, from: message.from });
    });

    main.send(a, "ping");
    await new Promise(r => setTimeout(r, 20));

    expect(messages).toEqual([{ topic: "reply", payload: "pong", from: a.name }]);
    unsubscribe();
    await main.outbox.stop(a);
  });

  it("should allow unsubscribing from direct main bus listeners", async () => {
    const messages: string[] = [];

    async function behavior(msg: string, state: number, utils: any) {
      if (msg === "ping") {
        utils.outbox.send("main", "reply", "pong");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(nextActorName(), 0);
    const unsubscribe = main.bus.listen("main", (message) => {
      messages.push(message.payload);
    });
    unsubscribe();

    main.send(a, "ping");
    await new Promise(r => setTimeout(r, 20));

    expect(messages).toEqual([]);
    await main.outbox.stop(a);
  });

  it("should stop behavior actor gracefully", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(nextActorName(), 0);
    main.send(a, "anything");
    await new Promise(r => setTimeout(r, 10));
    expect(a.running).toBe(true);

    await main.outbox.stop(a);
    expect(a.running).toBe(false);
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

    const a = actor(behavior as any)(nextActorName(), 42);
    const result = await main.outbox.request(a, "go") as any;

    expect(result.state).toBe(42);
    expect(result.r1).toBe(1);
    expect(result.r2).toBe(2);
    expect(["s", "r", "def"]).toContain(result.selName);
    await main.outbox.stop(a);
  });

  it("should reject request after stop", async () => {
    async function behavior(_msg: any, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(nextActorName(), 0);
    main.send(a, "x");
    await new Promise(r => setTimeout(r, 10));

    await main.outbox.stop(a);
    await expectAsync(main.outbox.request(a, "y")).toBeRejectedWithError("Actor stopped");
  });

  it("should reject in-flight requests when stopped", async () => {
    async function behavior(msg: string, state: number) {
      if (msg === "wait") {
        return new Promise<number>(() => {});
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(nextActorName(), 0);
    const pending = main.outbox.request(a, "wait");

    await new Promise(r => setTimeout(r, 10));
    await main.outbox.stop(a);

    await expectAsync(pending).toBeRejectedWithError("Actor stopped");
  });

  it("should support trailing actor options", async () => {
    async function behavior(msg: number, state: number) {
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior, {})(nextActorName(), 5);

    const state = await main.outbox.request(a, 10);
    expect(state).toBe(15);
    await main.outbox.stop(a);
  });

  it('should call the source actor request handler when worker requests "main"', async () => {
    const onRequest = jasmine.createSpy("onRequest").and.callFake((topic: string, payload: string) => {
      expect(topic).toBe("echo");
      return payload.toUpperCase();
    });
    const responses: string[] = [];

    async function behavior(msg: string, state: number, utils: any) {
      const response = await utils.outbox.request("main", "echo", msg);
      utils.outbox.send("main", "response", response);
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior, { onRequest })(nextActorName(), 0);
    const unsubscribe = main.bus.listen("main", (message) => {
      if (message.topic === "response") {
        responses.push(message.payload);
      }
    });
    main.send(a, "hello");
    await new Promise(r => setTimeout(r, 20));

    expect(onRequest).toHaveBeenCalled();
    expect(responses).toEqual(["HELLO"]);
    unsubscribe();
    await main.outbox.stop(a);
  });

  it("should keep global and direct main bus listeners independent", async () => {
    const allMessages: string[] = [];
    const directMessages: string[] = [];

    async function behavior(msg: string, state: number, utils: any) {
      if (msg === "go") {
        utils.outbox.send("main", "ping", "ping");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(nextActorName(), 0);
    const unsubscribeAll = main.bus.listen((message) => {
      if (message.to === "main" && message.topic === "ping") {
        allMessages.push(message.payload);
      }
    });
    const unsubscribeDirect = main.bus.listen("main", (message) => {
      if (message.topic === "ping") {
        directMessages.push(message.payload);
      }
    });

    main.send(a, "go");
    await new Promise(r => setTimeout(r, 20));

    expect(allMessages).toEqual(["ping"]);
    expect(directMessages).toEqual(["ping"]);
    unsubscribeAll();
    unsubscribeDirect();
    await main.outbox.stop(a);
  });

  it("should deliver multiple direct bus messages to main in order", async () => {
    const seen: string[] = [];

    async function behavior(msg: string, state: number, utils: any) {
      if (msg === "double") {
        utils.outbox.send("main", "step", "first");
        utils.outbox.send("main", "step", "second");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)("global-source", 0);
    const unsubscribe = main.bus.listen("main", (message) => {
      if (message.topic === "step") {
        seen.push(message.payload);
      }
    });

    main.send(a, "double");
    await new Promise(r => setTimeout(r, 20));

    expect(seen).toEqual(["first", "second"]);

    unsubscribe();
    await main.outbox.stop(a);
  });

  it("should route worker requests to named actor request handlers", async () => {
    const responses: string[] = [];

    async function requesterBehavior(msg: string, state: number, utils: any) {
      if (msg === "ask") {
        const response = await utils.outbox.request("responder", "greet", "hello");
        utils.outbox.send("main", "response", response);
      }
      return state;
    }

    async function responderBehavior(_msg: unknown, state: number) {
      return state;
    }

    (globalThis as any).currentMainTask = requesterBehavior;

    const requester = actor(requesterBehavior)("requester", 0);
    const responder = actor(responderBehavior, {
      onRequest: (topic: string, payload: string) => {
        expect(topic).toBe("greet");
        return payload.toUpperCase();
      },
    })("responder", 0);
    const unsubscribe = main.bus.listen("main", (message) => {
      if (message.topic === "response") {
        responses.push(message.payload);
      }
    });

    main.send(requester, "ask");
    await new Promise(r => setTimeout(r, 20));

    expect(responses).toEqual(["HELLO"]);

    unsubscribe();
    await Promise.all([main.outbox.stop(requester), main.outbox.stop(responder)]);
  });

  it("should target explicit actors through utils.outbox.send", async () => {
    type State = { role: "sender" | "receiver"; hits: number[] };

    async function behavior(msg: unknown, state: State, utils: any) {
      if (state.role === "sender" && msg === "direct") {
        utils.outbox.send("beta", "direct", 7);
        return state;
      }

      if (state.role === "receiver" && isActorBusMessage<number>(msg) && msg.topic === "direct") {
        return {
          ...state,
          hits: [...state.hits, msg.payload],
        };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const senderActor = actor(behavior)("sender", { role: "sender", hits: [] });
    const alpha = actor(behavior)("alpha", { role: "receiver", hits: [] });
    const beta = actor(behavior)("beta", { role: "receiver", hits: [] });

    main.send(senderActor, "direct");
    await new Promise(r => setTimeout(r, 20));

    const [alphaState, betaState] = await Promise.all([
      main.outbox.request<unknown, State>(alpha, "read"),
      main.outbox.request<unknown, State>(beta, "read"),
    ]);

    expect(alphaState.hits).toEqual([]);
    expect(betaState.hits).toEqual([7]);

    await Promise.all([main.outbox.stop(senderActor), main.outbox.stop(alpha), main.outbox.stop(beta)]);
  });

  it("should publish from main.bus to every actor", async () => {
    type State = { hits: string[] };

    async function behavior(msg: unknown, state: State) {
      if (isActorBusMessage<string>(msg) && msg.topic === "announce") {
        return {
          hits: [...state.hits, msg.payload],
        };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const alpha = actor(behavior)("alpha", { hits: [] });
    const beta = actor(behavior)("beta", { hits: [] });
    main.bus.publish("announce", "yes");
    await new Promise(r => setTimeout(r, 20));

    const [alphaState, betaState] = await Promise.all([
      main.outbox.request<unknown, State>("alpha", "read"),
      main.outbox.request<unknown, State>("beta", "read"),
    ]);

    expect(alphaState.hits).toEqual(["yes"]);
    expect(betaState.hits).toEqual(["yes"]);

    await Promise.all([main.outbox.stop(alpha), main.outbox.stop(beta)]);
  });

  it("should deliver direct bus messages to main by name", async () => {
    const seen: Array<{ topic: string; payload: string; from?: string }> = [];

    async function behavior(msg: string, state: number, utils: any) {
      if (msg === "report") {
        utils.outbox.send("main", "status", "ready");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const reporter = actor(behavior)("reporter", 0);
    const unsubscribe = main.bus.listen("main", (message) => {
      seen.push({ topic: message.topic, payload: message.payload, from: message.from });
    });

    main.send("reporter", "report");
    await new Promise(r => setTimeout(r, 20));

    expect(seen).toEqual([{ topic: "status", payload: "ready", from: "reporter" }]);

    unsubscribe();
    await main.outbox.stop(reporter);
  });
});
