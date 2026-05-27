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
          publish: (topic: string, payload: any) => {
            outbox.send({ kind: "actor-bus", topic, payload });
          },
          sendTo: (to: string | string[], topic: string, payload: any) => {
            outbox.send({ kind: "actor-bus", to, topic, payload });
          },
        };
        return {
          outbox,
          inbox: {
            receive: (signal?: AbortSignal) => this.workerInbox.receive(signal),
            channel: this.workerInbox,
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

    main.outbox.send(a, "inc");
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
    main.outbox.send(a, { type: "add", n: 5 });
    main.outbox.send(a, { type: "sub", n: 3 });
    main.outbox.send(a, { type: "add", n: 2 });

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

  it("should deliver worker messages to onMessage subscribers", async () => {
    const messages: string[] = [];

    async function behavior(msg: string, state: number, utils: any) {
      if (msg === "ping") {
        utils.outbox.send("pong");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)(nextActorName(), 0);
    main.inbox.listen(a, (msg: string) => messages.push(msg));

    main.outbox.send(a, "ping");
    await new Promise(r => setTimeout(r, 20));

    expect(messages).toEqual(["pong"]);
    await main.outbox.stop(a);
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

    const a = actor(behavior)(nextActorName(), 0);
    const unsubscribe = main.inbox.listen(a, (msg: string) => messages.push(msg));
    unsubscribe();

    main.outbox.send(a, "ping");
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
    main.outbox.send(a, "anything");
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
    main.outbox.send(a, "x");
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

  it("should support factory invocation with config", async () => {
    async function behavior(msg: number, state: number) {
      return state + msg;
    }

    (globalThis as any).currentMainTask = behavior;

    const factory = actor({});
    const a = factory(behavior)(nextActorName(), 5);

    const state = await main.outbox.request(a, 10);
    expect(state).toBe(15);
    await main.outbox.stop(a);
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

    const a = actor({ onRequest })(behavior)(nextActorName(), 0);
    main.outbox.send(a, "hello");
    await new Promise(r => setTimeout(r, 20));

    expect(onRequest).toHaveBeenCalled();
    await main.outbox.stop(a);
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
    const a = factory(behavior)(nextActorName(), 0);
    main.inbox.listen(a, (msg: string) => instanceMessages.push(msg));

    main.outbox.send(a, "go");
    await new Promise(r => setTimeout(r, 20));

    expect(configMessages).toEqual(["ping"]);
    expect(instanceMessages).toEqual(["ping"]);
    await main.outbox.stop(a);
  });

  it("should resolve multiple queued global inbox receives", async () => {
    async function behavior(msg: string, state: number, utils: any) {
      if (msg === "double") {
        utils.outbox.send("first");
        utils.outbox.send("second");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const a = actor(behavior)("global-source", 0);
    const first = main.inbox.listen();
    const second = main.inbox.listen();

    main.outbox.send(a, "double");

    const [entry1, entry2] = await Promise.all([first, second]);
    expect(entry1.actor).toBe(a);
    expect(entry1.name).toBe("global-source");
    expect(entry1.payload).toBe("first");
    expect(entry2.actor).toBe(a);
    expect(entry2.name).toBe("global-source");
    expect(entry2.payload).toBe("second");

    await main.outbox.stop(a);
  });

  it("should route worker bus publishes through main.bus", async () => {
    type State = { role: "publisher" | "receiver"; events: string[] };
    const seen: Array<{ topic: string; payload: string; from?: string }> = [];
    const workerEvents: string[] = [];

    async function behavior(msg: unknown, state: State, utils: any) {
      if (state.role === "publisher" && msg === "emit") {
        utils.outbox.publish("greet", "hello");
        return state;
      }

      if (state.role === "receiver" && isActorBusMessage<string>(msg) && msg.topic === "greet") {
        return {
          ...state,
          events: [...state.events, msg.payload],
        };
      }

      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const publisher = actor(behavior)("publisher", { role: "publisher", events: [] });
    const receiver = actor(behavior)("receiver", { role: "receiver", events: [] });
    const unsubscribe = main.bus.listen((message) => {
      seen.push({ topic: message.topic, payload: message.payload, from: message.from });
    });

    main.inbox.listen("publisher", (payload: string) => workerEvents.push(payload));

    main.outbox.send(publisher, "emit");
    await new Promise(r => setTimeout(r, 20));

    const state = await main.outbox.request<unknown, State>(receiver, "read");
    expect(seen).toEqual([{ topic: "greet", payload: "hello", from: "publisher" }]);
    expect(state.events).toEqual(["hello"]);
    expect(workerEvents).toEqual([]);

    unsubscribe();
    await Promise.all([main.outbox.stop(publisher), main.outbox.stop(receiver)]);
  });

  it("should target explicit actors through utils.outbox.sendTo", async () => {
    type State = { role: "sender" | "receiver"; hits: number[] };

    async function behavior(msg: unknown, state: State, utils: any) {
      if (state.role === "sender" && msg === "direct") {
        utils.outbox.sendTo("beta", "direct", 7);
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

    main.outbox.send(senderActor, "direct");
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
        utils.outbox.sendTo("main", "status", "ready");
      }
      return state;
    }

    (globalThis as any).currentMainTask = behavior;

    const reporter = actor(behavior)("reporter", 0);
    const unsubscribe = main.bus.listen("main", (message) => {
      seen.push({ topic: message.topic, payload: message.payload, from: message.from });
    });

    main.outbox.send("reporter", "report");
    await new Promise(r => setTimeout(r, 20));

    expect(seen).toEqual([{ topic: "status", payload: "ready", from: "reporter" }]);

    unsubscribe();
    await main.outbox.stop(reporter);
  });
});
