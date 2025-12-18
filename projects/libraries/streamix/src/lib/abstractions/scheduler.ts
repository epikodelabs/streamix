import { isPromiseLike } from "./operator";

/**
 * Functional Scheduler
 *
 * - Serializes tasks (FIFO, one-at-a-time)
 * - Supports sync + async tasks
 * - Errors reject the enqueue() promise but do NOT poison the queue
 * - flush() is microtask-stable: it resolves only after the queue stays empty
 *   across a microtask turn (prevents "flush lies" when tasks enqueue in microtasks)
 *
 * Optimizations:
 * - Minimal per-task allocation: store (fn, resolve, reject) in parallel arrays
 *   instead of allocating an object per entry.
 * - Single pump in flight (no redundant processNext chains)
 * - flush waiters stored as a compact array
 */
export type Scheduler = {
  enqueue: <T>(fn: () => Promise<T> | T) => Promise<T>;
  flush: () => Promise<void>;
};

export function createScheduler(): Scheduler {
  // Parallel arrays reduce object allocations vs {task, resolve, reject} entries.
  const tasks: Array<() => any> = [];
  const resolves: Array<(v: any) => void> = [];
  const rejects: Array<(e: any) => void> = [];

  // Multiple concurrent flush callers are supported.
  let flushResolvers: Array<() => void> = [];

  // True while a pump is running or scheduled.
  let pumping = false;

  // Schedules a microtask without capturing unnecessary state.
  const scheduleMicrotask = (cb: () => void) => queueMicrotask(cb);

  const resolveFlushIfIdleMicrotaskStable = (): void => {
    // Important: don't resolve flush immediately when tasks become empty,
    // because the just-finished task may enqueue more tasks in microtasks.
    scheduleMicrotask(() => {
      if (!pumping && tasks.length === 0 && flushResolvers.length) {
        const current = flushResolvers;
        flushResolvers = [];
        for (let i = 0; i < current.length; i++) current[i]();
      }
    });
  };

  const pump = async (): Promise<void> => {
    // If another pump is already running/scheduled, do nothing.
    if (pumping) return;
    pumping = true;

    try {
      while (tasks.length > 0) {
        // Shift from parallel arrays.
        const task = tasks.shift()!;
        const resolve = resolves.shift()!;
        const reject = rejects.shift()!;

        try {
          const res = task();
          const val = isPromiseLike(res) ? await res : res;
          resolve(val);
        } catch (err) {
          // Reject the task promise but keep pumping the rest.
          reject(err);
        }

        // Yield between tasks so enqueues coming from promise continuations
        // can interleave fairly and prevent deep synchronous loops.
        // (Still preserves FIFO: newly enqueued items go to the end.)
        await Promise.resolve();
      }
    } finally {
      pumping = false;
      resolveFlushIfIdleMicrotaskStable();
    }
  };

  const ensurePump = (): void => {
    // Schedule pump on a microtask boundary to avoid re-entrancy surprises.
    if (!pumping) {
      scheduleMicrotask(() => {
        // pump() will guard with `pumping` again.
        void pump();
      });
    }
  };

  const enqueue = <T>(fn: () => Promise<T> | T): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      tasks.push(fn as any);
      resolves.push(resolve as any);
      rejects.push(reject as any);
      ensurePump();
    });
  };

  const flush = (): Promise<void> => {
    // Fast-path
    if (!pumping && tasks.length === 0) return Promise.resolve();

    return new Promise<void>((resolve) => {
      flushResolvers.push(resolve);
      // If the queue is non-empty but pump isn't scheduled (edge cases),
      // ensure it runs.
      ensurePump();
      // Also attempt a microtask-stable resolve in case we were already idle
      // but pumping was true transiently.
      resolveFlushIfIdleMicrotaskStable();
    });
  };

  return { enqueue, flush };
}

export const scheduler = createScheduler();
