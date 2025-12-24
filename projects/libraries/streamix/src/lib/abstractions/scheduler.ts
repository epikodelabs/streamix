import { isPromiseLike } from "./operator";

/**
 * Functional Scheduler
 *
 * Guarantees:
 * - FIFO execution (one task at a time)
 * - Supports synchronous and asynchronous tasks
 * - Errors reject the task promise but do NOT stop the queue
 * - `flush()` is microtask-stable:
 *   it resolves only after the queue stays empty
 *   across a microtask turn (prevents ???flush lies???)
 *
 * Performance optimizations:
 * - Parallel arrays instead of per-task objects
 * - At most one pump in flight
 * - Compact storage for flush waiters
 */
export type Scheduler = {
  /**
   * Enqueue a task for serialized execution.
   *
   * The task may return a value or a promise.
   * The returned promise resolves or rejects with the task result.
   */
  enqueue: <T>(fn: () => Promise<T> | T) => Promise<T>;

  /**
   * Resolves when the scheduler becomes idle and
   * remains idle across a microtask boundary.
   */
  flush: () => Promise<void>;
};

/**
 * Function createScheduler.
 */
export function createScheduler(): Scheduler {
  /**
   * Parallel arrays storing the task queue.
   *
   * This avoids allocating `{ fn, resolve, reject }` objects
   * per task and significantly reduces GC pressure.
   */
  const tasks: Array<() => any> = [];
  const resolves: Array<(v: any) => void> = [];
  const rejects: Array<(e: any) => void> = [];

  /**
   * Resolvers for pending `flush()` calls.
   * Multiple concurrent flush callers are supported.
   */
  let flushResolvers: Array<() => void> = [];

  /**
   * Indicates whether a pump is currently running
   * or scheduled to run.
   */
  let pumping = false;

  /**
   * Schedules a microtask.
   *
   * Wrapped for clarity and to avoid capturing extra state.
   */
  const scheduleMicrotask = (cb: () => void) => queueMicrotask(cb);

  /**
   * Resolves all pending flush promises if the scheduler
   * is idle AND remains idle across a microtask turn.
   *
   * This avoids a subtle bug where a task finishes,
   * the queue appears empty, but new tasks are enqueued
   * in a promise continuation.
   */
  const resolveFlushIfIdleMicrotaskStable = (): void => {
    scheduleMicrotask(() => {
      if (!pumping && tasks.length === 0 && flushResolvers.length) {
        const current = flushResolvers;
        flushResolvers = [];
        for (let i = 0; i < current.length; i++) current[i]();
      }
    });
  };

  /**
   * Main execution loop.
   *
   * Pulls tasks from the queue one-by-one and executes them.
   * Errors reject the corresponding task promise but do not
   * stop the pump.
   */
  const pump = async (): Promise<void> => {
    // Guard against multiple concurrent pumps.
    if (pumping) return;
    pumping = true;

    try {
      while (tasks.length > 0) {
        // Dequeue from parallel arrays.
        const task = tasks.shift()!;
        const resolve = resolves.shift()!;
        const reject = rejects.shift()!;

        try {
          const result = task();
          const value = isPromiseLike(result) ? await result : result;
          resolve(value);
        } catch (err) {
          // Reject only this task; continue pumping.
          reject(err);
        }

        /**
         * Yield between tasks.
         *
         * This allows:
         * - promise continuations to enqueue new tasks
         * - fair interleaving of async work
         * - avoidance of deep synchronous recursion
         *
         * FIFO order is still preserved.
         */
        await Promise.resolve();
      }
    } finally {
      pumping = false;
      resolveFlushIfIdleMicrotaskStable();
    }
  };

  /**
   * Ensures the pump is scheduled.
   *
   * Scheduling occurs on a microtask boundary to:
   * - avoid re-entrancy
   * - keep execution predictable
   */
  const ensurePump = (): void => {
    if (!pumping) {
      scheduleMicrotask(() => {
        // pump() rechecks `pumping` internally
        void pump();
      });
    }
  };

  /**
   * Enqueues a task for execution.
   */
  const enqueue = <T>(fn: () => Promise<T> | T): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      tasks.push(fn as any);
      resolves.push(resolve as any);
      rejects.push(reject as any);
      ensurePump();
    });
  };

  /**
   * Resolves once the scheduler becomes fully idle.
   *
   * If already idle, resolves immediately.
   * Otherwise, waits until the queue is empty
   * and remains empty across a microtask turn.
   */
  const flush = (): Promise<void> => {
    // Fast path: already idle.
    if (!pumping && tasks.length === 0) return Promise.resolve();

    return new Promise<void>((resolve) => {
      flushResolvers.push(resolve);

      // Ensure progress even in edge cases.
      ensurePump();

      // Handle cases where pumping flips to false
      // before this flush registers.
      resolveFlushIfIdleMicrotaskStable();
    });
  };

  return { enqueue, flush };
}

/**
 * Global scheduler instance used by Streamix.
 */
export const scheduler = createScheduler();
