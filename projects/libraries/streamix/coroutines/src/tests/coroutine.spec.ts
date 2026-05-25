import { createStream } from "@epikodelabs/streamix";
import {
    ChannelClosedError,
    ContextCancelledError,
    actor,
    background,
    channel,
    coroutine,
    createTaskPool,
    otherwise,
    receive,
    select,
    send,
    withCancel,
    withDeadline,
    withTimeout,
    type CoroutineMessage,
    type PendingTaskMap
} from "@epikodelabs/streamix/coroutines";
import { idescribe } from "./env.spec";

idescribe('coroutine', () => {
  let originalWorker: any;
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;

  beforeAll(() => {
    // Store the original Worker
    originalWorker = (globalThis as any).Worker;

    // Save originals
    originalLog = console.log;
    originalError = console.error;
    originalWarn = console.warn;

    // Set up globalThis variable for main task
    (globalThis as any).currentMainTask = undefined;

    class MockWorker {
      onmessage: ((ev: any) => void) | null = null;
      listeners: Record<string, ((ev: any) => void)[]> = {};
      terminated = false;
      private workerInbox = channel<any>();

      constructor(_url: string, _options?: any) {}

      private handleDataRequest(_requestPayload: any): Promise<any> {
        return new Promise((resolve) => {
          // Simulate async data request by resolving with dummy data
          setTimeout(() => {
            resolve({ value: 10, message: "Dummy data from mock worker" });
          }, 1);
        });
      }

      private createWorkerUtils(message: { workerId: number; taskId: string }) {
        return {
          main: {
            send: (payload: any) => {
              const event: MessageEvent<CoroutineMessage> = {
                data: { workerId: message.workerId, taskId: message.taskId, type: "worker-message", payload }
              } as any;
              this.onmessage?.(event);
              this.listeners["message"]?.forEach(fn => fn(event));
            },
            request: (requestPayload: any) => this.handleDataRequest(requestPayload),
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
            withTimeout,
            withDeadline,
            ChannelClosedError,
            ContextCancelledError,
          }
        };
      }

      postMessage(msg: any) {
        setTimeout(() => {
          if (this.terminated) return;
          
          if (msg.type === 'task') {
            try {
              const mainTask = (globalThis as any).currentMainTask;
              if (!mainTask) {
                throw new Error('No main task configured');
              }
              const workerUtils = this.createWorkerUtils(msg);
              
              let result;
              
              // Check if mainTask expects utils parameter
              if (mainTask.length >= 2) {
                // Call with both data and utils
                result = mainTask(msg.payload, workerUtils);
              } else {
                // Call with only data
                result = mainTask(msg.payload);
              }
              
              // Handle both sync and async results
              Promise.resolve(result).then(finalResult => {
                const event: MessageEvent<CoroutineMessage> = {
                  data: { ...msg, type: 'response', payload: finalResult }
                } as any;
                this.onmessage?.(event);
                this.listeners['message']?.forEach(fn => fn(event));
              }).catch(err => {
                const event: MessageEvent<CoroutineMessage> = {
                  data: { ...msg, type: 'error', error: err.message }
                } as any;
                this.onmessage?.(event);
                this.listeners['message']?.forEach(fn => fn(event));
              });
              
            } catch (err: any) {
              const event: MessageEvent<CoroutineMessage> = {
                data: { ...msg, type: 'error', error: err.message }
              } as any;
              this.onmessage?.(event);
              this.listeners['message']?.forEach(fn => fn(event));
            }
          } else if (msg.type === "main-message") {
            this.workerInbox.send(msg.payload).catch(() => {});
          } else if (msg.type === 'data') {
            // Handle responses to worker data requests (if needed)
            console.log('MockWorker received data response:', msg);
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
    // Reset before each test
    (globalThis as any).currentMainTask = undefined;
  });

  it('should process tasks and return results', async () => {
    const mainTask = (x: number) => x + 1;
    (globalThis as any).currentMainTask = mainTask;
    
    const co = coroutine(mainTask);

    const stream = createStream('test', async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    const processed: number[] = [];
    for await (const v of stream) {
      processed.push(await co.processTask(v as number));
    }

    expect(processed).toEqual([2, 3, 4]); // Fixed expectation: x + 1
  });

  it('should allow assignTask directly to a worker', async () => {
    const mainTask = (x: number) => x * 2;
    (globalThis as any).currentMainTask = mainTask;

    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    const worker = await pool.getIdleWorker();
    const result = await pool.assignTask(worker, 5);

    expect(result).toBe(10);
    pool.returnWorker(worker);
    await pool.finalize();
  });

  it('should process multiple tasks in sequence', async () => {
    const mainTask = (x: number) => x * 2; // Fixed: consistent task logic
    (globalThis as any).currentMainTask = mainTask;
    
    const co = coroutine(mainTask);

    const results = await Promise.all([
      co.processTask(1),
      co.processTask(2),
      co.processTask(3),
    ]);

    expect(results).toEqual([2, 4, 6]); // Fixed expectation: x * 2
  });

  it('should finalize and terminate all workers', async () => {
    const mainTask = (x: number) => x * 2;
    (globalThis as any).currentMainTask = mainTask;

    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    // Get a worker to ensure one is created
    const worker = await pool.getIdleWorker();
    pool.returnWorker(worker);

    await pool.finalize();

    // After finalize, getting a new worker should work
    const newWorker = await pool.getIdleWorker();
    expect((newWorker as any).__id).toBeGreaterThan(0);

    // Clean up
    pool.returnWorker(newWorker);
    await pool.finalize();
  });

  it('should throw error from processTask directly', async () => {
    // Silence them
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};

    const mainTask = () => {
      throw new Error('boom');
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);

    try {
      await co.processTask(1);
      fail('Expected processTask to throw error');
    } catch (err: any) {
      expect(err.message).toBe('boom');
    }

    // Restore originals
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });

  it('should handle worker errors gracefully in stream', async () => {
     // Silence them
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    
    const mainTask = (x: number) => {
      if (x === 2) {
        throw new Error('boom');
      }
      return x * 2;
    };
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);

    const stream = createStream('test', async function* () {
      yield 1;
      yield 2; // This will cause an error
      yield 3;
    });

    const processed: number[] = [];
    let errorCaught = false;

    try {
      for await (const v of stream) {
        processed.push(await co.processTask(v as number));
      }
    } catch (err: any) {
      errorCaught = true;
      expect(err.message).toBe('boom');
    }

    expect(errorCaught).toBe(true);
    expect(processed).toEqual([2]); // Only the first value processed successfully
    
    // Restore originals
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });

  it('should handle data requests from workers', async () => {
    // Define the main task as a proper function (not arrow function if that causes issues)
    function mainTask(x: number, utils: any) {
      // Request additional data from main thread
      return utils.main.request({ request: 'more data' }).then((additionalData: any) => {
        return x + additionalData.value;
      });
    }
    
    (globalThis as any).currentMainTask = mainTask;

    const co = actor(mainTask);
    
    // Process a task - the worker will request data and our mock will respond with dummy data
    const result = await co.processTask(5);
    
    // The dummy data response adds {value: 10}, so 5 + 10 = 15
    expect(result).toBe(15);
  });

  it('should deliver main-thread messages through utils.main.receive()', async () => {
    async function mainTask(_x: number, utils: any) {
      return utils.main.receive();
    }

    (globalThis as any).currentMainTask = mainTask;

    const co = actor(mainTask);
    const worker = await co.pool.getIdleWorker();
    co.pool.returnWorker(worker);
    const pending = co.processTask(11);
    co.sendToWorker(worker, 99);
    await expectAsync(pending).toBeResolvedTo(99);
    await co.finalize();
  });

  it('should expose concurrency utils on actor worker utils', async () => {
    async function mainTask(_x: number, utils: any) {
      const { channel: _channel, receive, send, otherwise, select, background, withCancel, ChannelClosedError, ContextCancelledError } = utils.concurrency;

      const ch = channel<number>(1);
      await ch.send(7);
      const first = await ch.receive();

      const sendCase = send(ch, 9, "send");
      const receiveCase = receive(ch, "receive");
      const selected = await select([sendCase, receiveCase, otherwise("default")]);

      const [ctx, cancel] = withCancel(background());
      cancel(new ContextCancelledError("stop"));

      let cancelled = false;
      try {
        await select([sendCase], ctx);
      } catch (error) {
        cancelled =
          error instanceof ContextCancelledError ||
          error instanceof ChannelClosedError ||
          error instanceof Error;
      }

      return {
        first,
        selectedOp: selected.op,
        cancelled,
        hasErrors:
          typeof ChannelClosedError === "function" &&
          typeof ContextCancelledError === "function"
      };
    }

    (globalThis as any).currentMainTask = mainTask;

    const co = actor(mainTask);
    const result = await co.processTask(1);

    expect(result).toEqual(jasmine.objectContaining({
      first: 7,
      cancelled: true,
      hasErrors: true,
    }));
    expect(["send", "receive", "default"]).toContain(result.selectedOp);

    await co.finalize();
  });

  it('should keep losing main-thread select receive cases from consuming values', async () => {
    const left = channel<number>(1);
    const right = channel<number>(1);

    const pending = select([receive(left, "left"), receive(right, "right")]);

    await Promise.all([left.send(1), right.send(2)]);

    const selected = await pending;
    const remaining = [left.tryReceive(), right.tryReceive()].filter((item) => item !== undefined);

    expect(selected.ok).toBeTrue();
    expect(remaining.length).toBe(1);
    expect(remaining[0]).toEqual(jasmine.objectContaining({ ok: true }));
  });

  it('should keep losing worker-side select receive cases from consuming values', async () => {
    const suiteWorker = (globalThis as any).Worker;
    (globalThis as any).Worker = originalWorker;

    try {
      async function mainTask(_x: number, utils: any) {
        const { channel, receive, select } = utils.concurrency;
        const left = (channel as any)(1);
        const right = (channel as any)(1);

        const pending = select([receive(left, "left"), receive(right, "right")]);
        await Promise.all([left.send(1), right.send(2)]);
        const selected = await pending;

        return {
          selectedName: selected.name,
          selectedOk: selected.ok,
          remainingLeft: left.tryReceive(),
          remainingRight: right.tryReceive(),
        };
      }

      const co = actor(mainTask);
      const result = await co.processTask(1);
      const remaining = [result.remainingLeft, result.remainingRight].filter((item: any) => item !== undefined);

      expect(["left", "right"]).toContain(result.selectedName);
      expect(result.selectedOk).toBeTrue();
      expect(remaining.length).toBe(1);
      expect(remaining[0]).toEqual(jasmine.objectContaining({ ok: true }));

      await co.finalize();
    } finally {
      (globalThis as any).Worker = suiteWorker;
    }
  });

  it('should fall back to 4 workers when navigator.hardwareConcurrency is not set', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, "hardwareConcurrency");

    try {
      Object.defineProperty(navigator, "hardwareConcurrency", { value: 0, configurable: true });

      const mainTask = (x: number) => x + 1;
      (globalThis as any).currentMainTask = mainTask;

      const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });
      const worker = await pool.getIdleWorker();
      pool.returnWorker(worker);
      await pool.finalize();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(navigator, "hardwareConcurrency", originalDescriptor);
      }
    }
  });

  it('should support higher-order invocation with undefined config', async () => {
    const mainTask = (x: number) => x + 1;
    (globalThis as any).currentMainTask = mainTask;

    const make = (coroutine as any)(undefined) as (m: any) => ReturnType<typeof coroutine>;
    const co = make(mainTask);

    const r = await co.processTask(1);
    expect(r).toBe(2);

    await co.finalize();
  });

  it('should handle request/message/unknown worker messages via default handler', async () => {
    const warn = spyOn(console, "warn");

    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const co = actor(mainTask);

    const worker = await co.pool.getIdleWorker();
    const workerId = (worker as any).__id as number;

    const listeners = (worker as any).listeners?.message as Array<(ev: any) => void> | undefined;
    expect(Array.isArray(listeners)).toBeTrue();
    const handler = listeners![0];

    spyOn(worker as any, "postMessage").and.callThrough();

    handler({ data: { type: "request", workerId, taskId: "t1", requestId: "r1", payload: { q: 1 } } });
    handler({ data: { type: "request", workerId, taskId: "t1", requestId: "r2", payload: { q: 2 } } });
    expect((worker as any).postMessage).toHaveBeenCalledWith(jasmine.objectContaining({ type: "error", requestId: "r1" }));
    expect((worker as any).postMessage).toHaveBeenCalledWith(jasmine.objectContaining({ type: "error", requestId: "r2" }));

    handler({ data: { type: "worker-message", workerId, taskId: "t1", payload: { pct: 10 } } });
    handler({ data: { type: "something-else", workerId, taskId: "t1", payload: null } });

    expect(warn).toHaveBeenCalled();

    co.pool.returnWorker(worker);
    await co.finalize();
  });

  it('should reject with "Unknown worker error" when worker error message is missing', async () => {
    const originalWorker = (globalThis as any).Worker;

    class ErrorNoMessageWorker {
      listeners: Record<string, ((ev: any) => void)[]> = {};
      terminated = false;

      constructor(_url: string, _options?: any) {}

      addEventListener(type: string, fn: (ev: any) => void) {
        this.listeners[type] ||= [];
        this.listeners[type].push(fn);
      }

      removeEventListener(type: string, fn: (ev: any) => void) {
        if (this.listeners[type]) {
          this.listeners[type] = this.listeners[type].filter(f => f !== fn);
        }
      }

      postMessage(msg: any) {
        setTimeout(() => {
          if (this.terminated) return;
          if (msg.type !== "task") return;

          const event: MessageEvent<CoroutineMessage> = {
            data: { ...msg, type: "error" } // no `error` field on purpose
          } as any;

          this.listeners["message"]?.forEach(fn => fn(event));
        }, 1);
      }

      terminate() {
        this.terminated = true;
        this.listeners = {};
      }
    }

    (globalThis as any).Worker = ErrorNoMessageWorker;

    try {
      const mainTask = (x: number) => x;
      (globalThis as any).currentMainTask = mainTask;

      const co = coroutine(mainTask);

      await expectAsync(co.processTask(1)).toBeRejectedWithError("Unknown worker error");
      await co.finalize();
    } finally {
      (globalThis as any).Worker = originalWorker;
    }
  });

  it('should use customMessageHandler when provided', async () => {
    const mainTask = (x: number) => x + 1;
    (globalThis as any).currentMainTask = mainTask;

    const customMessageHandler = jasmine
      .createSpy("customMessageHandler")
      .and.callFake((event: MessageEvent<CoroutineMessage>, _worker: Worker, pending: Map<string, any>) => {
        const msg = event.data;
        if (msg.type !== "response") return;
        const p = pending.get(msg.taskId);
        if (!p) return;
        pending.delete(msg.taskId);
        p.resolve(msg.payload);
      });

    const coFactory = actor({ customMessageHandler }) as any;
    const co = coFactory(mainTask);

    const r = await co.processTask(1);
    expect(r).toBe(2);
    expect(customMessageHandler).toHaveBeenCalled();

    await co.finalize();
  });

  it('should clean pending tasks when worker.postMessage throws synchronously', async () => {
    const suiteWorker = (globalThis as any).Worker;
    let capturedPending: PendingTaskMap | undefined;

    class ThrowingPostMessageWorker {
      listeners: Record<string, ((ev: any) => void)[]> = {};
      postCount = 0;

      constructor(_url: string, _options?: any) {}

      addEventListener(type: string, fn: (ev: any) => void) {
        this.listeners[type] ||= [];
        this.listeners[type].push(fn);
      }

      removeEventListener(type: string, fn: (ev: any) => void) {
        if (this.listeners[type]) {
          this.listeners[type] = this.listeners[type].filter((listener) => listener !== fn);
        }
      }

      postMessage(msg: any) {
        this.postCount += 1;
        if (this.postCount === 1) {
          throw new DOMException("DataCloneError", "DataCloneError");
        }

        setTimeout(() => {
          const event: MessageEvent<CoroutineMessage> = {
            data: { ...msg, type: "response", payload: msg.payload },
          } as any;

          this.listeners['message']?.forEach((listener) => listener(event));
        }, 1);
      }

      terminate() {
        this.listeners = {};
      }
    }

    (globalThis as any).Worker = ThrowingPostMessageWorker;

    try {
      const coFactory = actor({
        customMessageHandler: (_event, _worker, pending) => {
          capturedPending = pending;
          const response = _event.data;
          if (response.type !== "response") {
            return;
          }
          const entry = pending.get(response.taskId);
          if (!entry) {
            return;
          }
          pending.delete(response.taskId);
          entry.resolve(response.payload);
        },
      }) as any;
      const co = coFactory((x: number) => x);

      await expectAsync(co.processTask(1)).toBeRejected();
      await expectAsync(co.processTask(2)).toBeResolvedTo(2);
      expect(capturedPending?.size).toBe(0);

      await co.finalize();
    } finally {
      (globalThis as any).Worker = suiteWorker;
    }
  });

  it('should include helper function names when generating worker script', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;

    function helperNamed() {
      return 1;
    }

    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [helperNamed, function () { return 2; }], generateWorkerScript: () => '' });
    const worker = await pool.getIdleWorker();
    pool.returnWorker(worker);
    await pool.finalize();
  });

  it('should ignore response/error messages when no pending task exists', async () => {
    const warn = spyOn(console, "warn");

    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    const worker = await pool.getIdleWorker();
    const workerId = (worker as any).__id as number;
    const handler = (worker as any).listeners.message[0] as (ev: any) => void;

    handler({ data: { type: "response", workerId, taskId: "missing", payload: 1 } });
    handler({ data: { type: "error", workerId, taskId: "missing", error: "nope" } });

    expect(warn).toHaveBeenCalled();

    pool.returnWorker(worker);
    await pool.finalize();
  });

  it('should queue getIdleWorker requests once max workers are reached', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    const max = (navigator as any).hardwareConcurrency || 4;
    const acquired: Worker[] = [];

    for (let i = 0; i < max; i++) {
      acquired.push(await pool.getIdleWorker());
    }

    const waiting = pool.getIdleWorker();

    // Return one worker to satisfy the waiting request.
    pool.returnWorker(acquired[0]);
    const extra = await waiting;

    expect((extra as any).__id).toBe((acquired[0] as any).__id);

    // Cleanup: return everything to the pool.
    for (const entry of acquired.slice(1)) {
      pool.returnWorker(entry);
    }
    pool.returnWorker(extra);

    await pool.finalize();
  });

  it('should reject queued getIdleWorker requests when finalized', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    const max = (navigator as any).hardwareConcurrency || 4;
    const acquired: Worker[] = [];

    for (let i = 0; i < max; i++) {
      acquired.push(await pool.getIdleWorker());
    }

    const waiting = pool.getIdleWorker();
    await pool.finalize();

    await expectAsync(waiting).toBeRejectedWithError(/finalized before a worker became available/);
  });

  it('should allow reusing the pool after finalize even when max workers were created', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    const max = (navigator as any).hardwareConcurrency || 4;
    const acquired: Worker[] = [];

    for (let i = 0; i < max; i++) {
      acquired.push(await pool.getIdleWorker());
    }

    await pool.finalize();

    const worker = await pool.getIdleWorker();
    expect((worker as any).__id).toBeGreaterThan(0);

    pool.returnWorker(worker);
    await pool.finalize();
  });

  it('returnWorker warns when workerId is unknown', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    const warn = spyOn(console, "warn");
    pool.returnWorker({} as Worker);

    expect(warn).toHaveBeenCalled();

    await pool.finalize();
  });

  it('assignTask throws when workerId is unknown', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    await expectAsync(pool.assignTask({} as Worker, 1)).toBeRejectedWithError(/not found/i);
    await pool.finalize();
  });

  it('finalize is safe when called before any worker is created', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const co = coroutine(mainTask);

    await co.finalize();
  });

  it('should steer a worker via sendToWorker in a command loop (kitchen pattern)', async () => {
    async function mainTask(room: string, utils: any) {
      while (true) {
        const cmd = await utils.main.receive();
        if (cmd === 'dock') return 'docked in ' + room;
        if (cmd === 'panic') return 'hiding under couch in ' + room;
      }
    }

    (globalThis as any).currentMainTask = mainTask;

    const vacuum = actor(mainTask);
    const worker = await vacuum.pool.getIdleWorker();

    const pending = vacuum.pool.assignTask(worker, 'kitchen');
    vacuum.sendToWorker(worker, 'dock');

    const result = await pending;
    expect(result).toBe('docked in kitchen');

    vacuum.pool.returnWorker(worker);
    await vacuum.finalize();
  });
});
