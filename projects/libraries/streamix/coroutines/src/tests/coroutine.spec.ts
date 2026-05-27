import { createStream } from "@epikodelabs/streamix";
import {
    ChannelClosedError,
    ContextCancelledError,
    background,
    channel,
    coroutine,
    otherwise,
    receive,
    select,
    send,
    withCancel,
    withDeadline,
    withTimeout
} from "@epikodelabs/streamix/coroutines";
import { idescribe } from "./env.spec";
import { createTaskPool } from "../lib/worker/pool";
import type { WorkerProtocolMessage } from "../lib/worker/messages";

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
              const event: MessageEvent<WorkerProtocolMessage> = {
                data: { workerId: message.workerId, taskId: message.taskId, type: "notify", payload }
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
                const event: MessageEvent<WorkerProtocolMessage> = {
                  data: { ...msg, type: 'response', payload: finalResult }
                } as any;
                this.onmessage?.(event);
                this.listeners['message']?.forEach(fn => fn(event));
              }).catch(err => {
                const event: MessageEvent<WorkerProtocolMessage> = {
                  data: { ...msg, type: 'error', error: err.message }
                } as any;
                this.onmessage?.(event);
                this.listeners['message']?.forEach(fn => fn(event));
              });
              
            } catch (err: any) {
              const event: MessageEvent<WorkerProtocolMessage> = {
                data: { ...msg, type: 'error', error: err.message }
              } as any;
              this.onmessage?.(event);
              this.listeners['message']?.forEach(fn => fn(event));
            }
          } else if (msg.type === "notify") {
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

  it('should allow runOnWorker directly on an acquired worker', async () => {
    const mainTask = (x: number) => x * 2;
    (globalThis as any).currentMainTask = mainTask;

    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    const worker = await pool.acquireWorker();
    const result = await pool.runOnWorker(worker, 5);

    expect(result).toBe(10);
    pool.releaseWorker(worker);
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
    const worker = await pool.acquireWorker();
    pool.releaseWorker(worker);

    await pool.finalize();

    // After finalize, getting a new worker should work
    const newWorker = await pool.acquireWorker();
    expect((newWorker as any).__id).toBeGreaterThan(0);

    // Clean up
    pool.releaseWorker(newWorker);
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

  it('should fall back to 4 workers when navigator.hardwareConcurrency is not set', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, "hardwareConcurrency");

    try {
      Object.defineProperty(navigator, "hardwareConcurrency", { value: 0, configurable: true });

      const mainTask = (x: number) => x + 1;
      (globalThis as any).currentMainTask = mainTask;

      const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });
      const worker = await pool.acquireWorker();
      pool.releaseWorker(worker);
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

          const event: MessageEvent<WorkerProtocolMessage> = {
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

  it('should include helper function names when generating worker script', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;

    function helperNamed() {
      return 1;
    }

    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [helperNamed, function () { return 2; }], generateWorkerScript: () => '' });
    const worker = await pool.acquireWorker();
    pool.releaseWorker(worker);
    await pool.finalize();
  });

  it('should ignore response/error messages when no pending task exists', async () => {
    const warn = spyOn(console, "warn");

    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    const worker = await pool.acquireWorker();
    const workerId = (worker as any).__id as number;
    const handler = (worker as any).listeners.message[0] as (ev: any) => void;

    handler({ data: { type: "response", workerId, taskId: "missing", payload: 1 } });
    handler({ data: { type: "error", workerId, taskId: "missing", error: "nope" } });

    expect(warn).toHaveBeenCalled();

    pool.releaseWorker(worker);
    await pool.finalize();
  });

  it('should queue acquireWorker requests once max workers are reached', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    const max = (navigator as any).hardwareConcurrency || 4;
    const acquired: Worker[] = [];

    for (let i = 0; i < max; i++) {
      acquired.push(await pool.acquireWorker());
    }

    const waiting = pool.acquireWorker();

    // Return one worker to satisfy the waiting request.
    pool.releaseWorker(acquired[0]);
    const extra = await waiting;

    expect((extra as any).__id).toBe((acquired[0] as any).__id);

    // Cleanup: return everything to the pool.
    for (const entry of acquired.slice(1)) {
      pool.releaseWorker(entry);
    }
    pool.releaseWorker(extra);

    await pool.finalize();
  });

  it('should reject queued acquireWorker requests when finalized', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    const max = (navigator as any).hardwareConcurrency || 4;
    const acquired: Worker[] = [];

    for (let i = 0; i < max; i++) {
      acquired.push(await pool.acquireWorker());
    }

    const waiting = pool.acquireWorker();
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
      acquired.push(await pool.acquireWorker());
    }

    await pool.finalize();

    const worker = await pool.acquireWorker();
    expect((worker as any).__id).toBeGreaterThan(0);

    pool.releaseWorker(worker);
    await pool.finalize();
  });

  it('releaseWorker warns when workerId is unknown', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    const warn = spyOn(console, "warn");
    pool.releaseWorker({} as Worker);

    expect(warn).toHaveBeenCalled();

    await pool.finalize();
  });

  it('runOnWorker throws when workerId is unknown', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const pool = createTaskPool({ name: 'test', main: mainTask, functions: [], generateWorkerScript: () => '' });

    await expectAsync(pool.runOnWorker({} as Worker, 1)).toBeRejectedWithError(/not found/i);
    await pool.finalize();
  });

  it('finalize is safe when called before any worker is created', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const co = coroutine(mainTask);

    await co.finalize();
  });

});
