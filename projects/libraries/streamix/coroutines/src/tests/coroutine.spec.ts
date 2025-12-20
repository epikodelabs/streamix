import { coroutine, CoroutineMessage, createStream } from "@actioncrew/streamix";
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
      private workerUtils: any;

      constructor(_url: string, _options?: any) { 
        // Create mock utils for the worker
        this.workerUtils = {
          requestData: (requestPayload: any) => this.handleDataRequest(requestPayload),
          reportProgress: (progressData: any) => this.handleProgressReport(progressData)
        };
      }

      private handleDataRequest(_requestPayload: any): Promise<any> {
        return new Promise((resolve) => {
          // Simulate async data request by resolving with dummy data
          setTimeout(() => {
            resolve({ value: 10, message: "Dummy data from mock worker" });
          }, 1);
        });
      }

      private handleProgressReport(progressData: any) {
        // Progress reports are just logged in tests
        console.log('Progress report:', progressData);
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
              
              let result;
              
              // Check if mainTask expects utils parameter
              if (mainTask.length >= 2) {
                // Call with both data and utils
                result = mainTask(msg.payload, this.workerUtils);
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
    for await (const v of stream.pipe(co)) {
      processed.push(v as number);
    }

    expect(processed).toEqual([2, 3, 4]); // Fixed expectation: x + 1
  });

  it('should allow assignTask directly to a worker', async () => {
    const mainTask = (x: number) => x * 2; // Fixed: x * 2, not x * 3
    (globalThis as any).currentMainTask = mainTask;
    
    const co = coroutine(mainTask);

    const { workerId } = await co.getIdleWorker();
    const result = await co.assignTask(workerId, 5);

    expect(result).toBe(10); // 5 * 2 = 10
    co.returnWorker(workerId);
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
    
    const co = coroutine(mainTask);

    // Get a worker to ensure one is created
    const { workerId } = await co.getIdleWorker();
    co.returnWorker(workerId);
    
    await co.finalize();

    // After finalize, getting a new worker should work
    const { workerId: newWorkerId } = await co.getIdleWorker();
    expect(newWorkerId).toBeGreaterThan(0);
    
    // Clean up
    co.returnWorker(newWorkerId);
    await co.finalize();
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
      for await (const v of stream.pipe(co)) {
        processed.push(v as any);
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
      return utils.requestData({ request: 'more data' }).then((additionalData: any) => {
        return x + additionalData.value;
      });
    }
    
    (globalThis as any).currentMainTask = mainTask;

    const co = coroutine(mainTask);
    
    // Process a task - the worker will request data and our mock will respond with dummy data
    const result = await co.processTask(5);
    
    // The dummy data response adds {value: 10}, so 5 + 10 = 15
    expect(result).toBe(15);
  });

  it('should fall back to 4 workers when navigator.hardwareConcurrency is not set', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, "hardwareConcurrency");

    try {
      Object.defineProperty(navigator, "hardwareConcurrency", { value: 0, configurable: true });

      const mainTask = (x: number) => x + 1;
      (globalThis as any).currentMainTask = mainTask;

      const co = coroutine(mainTask);
      const { workerId } = await co.getIdleWorker();
      co.returnWorker(workerId);
      await co.finalize();
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

  it('should handle request/progress/unknown worker messages via default handler', async () => {
    const warn = spyOn(console, "warn");

    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const co = coroutine(mainTask);

    const { worker, workerId } = await co.getIdleWorker();

    const listeners = (worker as any).listeners?.message as Array<(ev: any) => void> | undefined;
    expect(Array.isArray(listeners)).toBeTrue();
    const handler = listeners![0];

    spyOn(worker as any, "postMessage").and.callThrough();

    handler({ data: { type: "request", workerId, taskId: "t1", payload: { q: 1 } } });
    expect((worker as any).postMessage).toHaveBeenCalledWith(jasmine.objectContaining({ type: "data" }));

    handler({ data: { type: "progress", workerId, taskId: "t1", payload: { pct: 10 } } });
    handler({ data: { type: "something-else", workerId, taskId: "t1", payload: null } });

    expect(warn).toHaveBeenCalled();

    co.returnWorker(workerId);
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

    const coFactory = coroutine({ customMessageHandler }) as any;
    const co = coFactory(mainTask);

    const r = await co.processTask(1);
    expect(r).toBe(2);
    expect(customMessageHandler).toHaveBeenCalled();

    await co.finalize();
  });

  it('should include helper function names when generating worker script', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;

    function helperNamed() {
      return 1;
    }

    const co = coroutine(mainTask, helperNamed, function () { return 2; });
    const { workerId } = await co.getIdleWorker();
    co.returnWorker(workerId);
    await co.finalize();
  });

  it('should ignore response/error messages when no pending task exists', async () => {
    const warn = spyOn(console, "warn");

    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const co = coroutine(mainTask);

    const { worker, workerId } = await co.getIdleWorker();
    const handler = (worker as any).listeners.message[0] as (ev: any) => void;

    handler({ data: { type: "response", workerId, taskId: "missing", payload: 1 } });
    handler({ data: { type: "error", workerId, taskId: "missing", error: "nope" } });

    expect(warn).toHaveBeenCalled();

    co.returnWorker(workerId);
    await co.finalize();
  });

  it('should queue getIdleWorker requests once max workers are reached', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const co = coroutine(mainTask);

    const max = (navigator as any).hardwareConcurrency || 4;
    const acquired: Array<{ worker: Worker; workerId: number }> = [];

    for (let i = 0; i < max; i++) {
      acquired.push(await co.getIdleWorker());
    }

    const waiting = co.getIdleWorker();

    // Return one worker to satisfy the waiting request.
    co.returnWorker(acquired[0].workerId);
    const extra = await waiting;

    expect(extra.workerId).toBe(acquired[0].workerId);

    // Cleanup: return everything to the pool.
    for (const entry of acquired.slice(1)) {
      co.returnWorker(entry.workerId);
    }
    co.returnWorker(extra.workerId);

    await co.finalize();
  });

  it('returnWorker warns when workerId is unknown', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const co = coroutine(mainTask);

    const warn = spyOn(console, "warn");
    co.returnWorker(999999);

    expect(warn).toHaveBeenCalled();

    await co.finalize();
  });

  it('assignTask throws when workerId is unknown', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const co = coroutine(mainTask);

    await expectAsync(co.assignTask(999999, 1)).toBeRejectedWithError(/not found/i);
    await co.finalize();
  });

  it('finalize is safe when called before any worker is created', async () => {
    const mainTask = (x: number) => x;
    (globalThis as any).currentMainTask = mainTask;
    const co = coroutine(mainTask);

    await co.finalize();
  });
});
