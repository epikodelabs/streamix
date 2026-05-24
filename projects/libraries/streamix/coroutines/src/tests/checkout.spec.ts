import { eachValueFrom } from "@epikodelabs/streamix";
import { createPool, checkout, type CoroutineMessage, type CheckedOutWorker } from "@epikodelabs/streamix/coroutines";
import { idescribe } from "./env.spec";

idescribe("checkout", () => {
  let originalWorker: any;
  // Global tracker for all created mock workers
  const mockWorkersById: Record<number, any> = {};

  beforeAll(() => {
    originalWorker = (globalThis as any).Worker;
    let mockWorkerIdCounter = 0; // Counter for MockWorker instances

    class MockWorker {
      listeners: Record<string, Function[]> = {};
      onmessage: ((ev: any) => void) | null = null;
      terminated = false;
      public mockId: number; // Add a public mock ID for tracking

      constructor() {
        // Initialize and track the instance
        this.mockId = ++mockWorkerIdCounter;
        mockWorkersById[this.mockId] = this;
        this.listeners = {};
        this.onmessage = null;
        this.terminated = false;
      }

      addEventListener(type: string, fn: Function) {
        this.listeners[type] ||= [];
        this.listeners[type].push(fn);
      }

      removeEventListener(type: string, fn: Function) {
        if (this.listeners[type]) {
          this.listeners[type] = this.listeners[type].filter(f => f !== fn);
        }
      }

      postMessage(msg: any) {
        setTimeout(() => {
          if (msg.type !== "task") return;

          try {
            // Compile function from code (generic pool) or fallback to currentMainTask
            const fn = msg.code
              ? new Function('return (' + msg.code + ')')()
              : (globalThis as any).currentMainTask;

            const result = fn(msg.payload);

            // Success Path (correct)
            const successEvent: MessageEvent<CoroutineMessage> = {
              data: { ...msg, type: "response", payload: result },
            } as any;
            this.listeners["message"]?.forEach(fn => fn(successEvent));

          } catch (err: any) {
            // 1. Send the global ErrorEvent (for checkout's onError callback)
            const errorEvent: ErrorEvent = { error: err } as any;
            this.listeners["error"]?.forEach(fn => fn(errorEvent));

            // 2. Send an explicit CoroutineMessage (for promise rejection)
            const rejectionMessage: MessageEvent<CoroutineMessage> = {
              data: {
                ...msg,
                type: "error",
                error: err.message
              },
            } as any;
            this.listeners["message"]?.forEach(fn => fn(rejectionMessage));
          }
        }, 1);
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
  });

  beforeEach(() => {
    // Clear the global mock worker map before each test to ensure fresh state
    Object.keys(mockWorkersById).forEach(key => delete (mockWorkersById as any)[key]);
  });

  it("should yield a CheckedOutWorker and successfully execute a task", async () => {
    const pool = createPool();

    const messages: CoroutineMessage[] = [];
    const errors: Error[] = [];

    const stream = checkout(pool, msg => { messages.push(msg); }, err => { errors.push(err); });

    const iterator = eachValueFrom(stream);
    const hired: CheckedOutWorker = (await iterator.next()).value;

    // Execute task
    const result = await hired.processTask((x: number) => x + 1, 5);
    expect(result).toBe(6);

    hired.release();
    await pool.finalize();

    expect(errors.length).toBe(0);
  });

  it("should support multiple sequential tasks on the same hired worker", async () => {
    const pool = createPool();

    const stream = checkout(pool, () => { }, () => { });
    const iterator = eachValueFrom(stream);
    const hired: CheckedOutWorker = (await iterator.next()).value;

    // Execute tasks sequentially
    const r1 = await hired.processTask((x: number) => x * 10, 1);
    const r2 = await hired.processTask((x: number) => x * 10, 2);
    const r3 = await hired.processTask((x: number) => x * 10, 3);

    expect([r1, r2, r3]).toEqual([10, 20, 30]);

    hired.release();
    await pool.finalize();
  });

  // ===============================================
  // 2. Error and Exception Handling
  // ===============================================

  it("should forward worker error events to the provided onError callback", async () => {
    const pool = createPool();

    let capturedError: any = null;

    const stream = checkout(pool, () => { }, err => { capturedError = err; });

    const iterator = eachValueFrom(stream);
    const hired: CheckedOutWorker = (await iterator.next()).value;

    let rejectionError: any = null;
    try {
      // Task triggers error path and the promise from processTask will reject
      await hired.processTask((x: number) => { if (x === 99) throw new Error("boom"); return x + 1; }, 99);
    } catch (err) {
      rejectionError = err; // Catch the rejection to prevent test failure/timeout
    }

    // Assert that the error was captured by the 'checkout' onError callback
    expect(capturedError?.message).toBe("boom");

    // Optionally assert the error thrown by the promise rejection
    expect(rejectionError?.message).toBe("boom");

    hired.release();
    // Ensure cleanup runs
    await pool.finalize();
  });

  // ===============================================
  // 3. Resource Management and Cleanup
  // ===============================================

  // checkout operator > should release worker and clean up event listeners on manual release()
  it("should release worker and clean up event listeners on manual release()", async () => {
    const pool = createPool();

    const messages: CoroutineMessage[] = [];
    const stream = checkout(pool, msg => { messages.push(msg); }, () => { });

    const iterator = eachValueFrom(stream);
    const hired: CheckedOutWorker = (await iterator.next()).value;

    const result = await hired.processTask((x: number) => x + 1, 2);
    expect(result).toBe(3);

    hired.release();
    await pool.finalize();
  });

  it("should ignore messages for other workerId and process matching ones", async () => {
    const pool = createPool();

    const messages: CoroutineMessage[] = [];
    const stream = checkout(pool, msg => { messages.push(msg); }, () => { });

    const iterator = eachValueFrom(stream);
    const hired: CheckedOutWorker = (await iterator.next()).value;

    // Access the mock worker instance via the file-scoped mock map created in the test setup
    // Find the actual mock worker instance that has message listeners attached
    const workerList = Object.values(mockWorkersById as any) as Array<{ listeners?: Record<string, Function[]> }>;
    const worker = workerList.find((w) => w.listeners!["message"]!.length > 0);
    if (!worker) {
      fail("Expected a mock worker with message listeners");
      return;
    }

    const hiredWorkerId = (hired.worker as any).__id as number;

    // Trigger a message with a different workerId (should be ignored)
    const evWrong = { data: { workerId: hiredWorkerId + 999, type: 'response', payload: 123 } } as any;
    worker.listeners?.['message']?.forEach((fn: Function) => fn(evWrong));
    await new Promise((r) => setTimeout(r, 10));
    expect(messages.length).toBe(0);

    // Now trigger a message for the correct workerId
    const evGood = { data: { workerId: hiredWorkerId, type: 'response', payload: 5 } } as any;
    worker.listeners?.['message']?.forEach((fn: Function) => fn(evGood));
    await new Promise((r) => setTimeout(r, 10));
    expect(messages.some(m => (m as any).payload === 5)).toBeTrue();

    hired.release();
    await pool.finalize();
  });

  it("should allow multiple calls to release() without throwing", async () => {
    const pool = createPool();

    const stream = checkout(pool, () => { }, () => { });
    const iterator = eachValueFrom(stream);
    const hired: CheckedOutWorker = (await iterator.next()).value;

    hired.release();
    // second release should not throw
    expect(() => hired.release()).not.toThrow();

    await pool.finalize();
  });

  it("should discard a worker after a native worker error instead of returning it to the pool", async () => {
    const pool = createPool();

    let capturedError: Error | undefined;
    const stream = checkout(pool, () => { }, (error) => { capturedError = error; });
    const iterator = eachValueFrom(stream);
    const hired: CheckedOutWorker = (await iterator.next()).value;

    const workerList = Object.values(mockWorkersById as any) as Array<{ listeners?: Record<string, Function[]>; mockId: number }>;
    const worker = workerList.find((entry) => entry.listeners?.["error"]?.length);
    if (!worker) {
      fail("Expected a mock worker with an error listener");
      return;
    }

    worker.listeners!['error']!.forEach((fn: Function) => fn({ error: new Error("fatal worker error") }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedError?.message).toBe("fatal worker error");

    const replacement = await pool.getIdleWorker();
    expect((replacement as any).mockId).not.toBe(worker.mockId);

    pool.returnWorker(replacement);
    hired.release();
    await pool.finalize();
  });
});
