import { isPromiseLike } from "./operator";

export const performMicrotask = typeof queueMicrotask === "function"
  ? queueMicrotask
  : (fn: () => void) => void Promise.resolve().then(fn);

export function enqueueMicrotask(fn: () => void): void {
  performMicrotask(fn);
}

export function runInMicrotask<T>(fn: () => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    performMicrotask(() => {
      Promise.resolve()
        .then(fn)
        .then(resolve, reject);
    });
  });
}

/**
 * Functional Scheduler
 *
 * Guarantees:
 * - FIFO execution (one task at a time)
 * - Supports synchronous and asynchronous tasks
 * - Errors reject the task promise but do NOT stop the queue
 * - `flush()` is microtask-stable:
 *   it resolves only after the queue stays empty
 *   across a microtask turn (prevents "flush lies")
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
   * Backwards-compatible alias for `enqueue` used by some tests/consumers.
   */
  schedule?: <T>(fn: () => Promise<T> | T) => Promise<T>;

  /**
   * Resolves when the scheduler becomes idle and
   * remains idle across a microtask boundary.
   */
  flush: () => Promise<void>;

  /**
   * Awaits a promise without blocking the queue.
   * 
   * Designed for use within generators. When yielded,
   * it allows the queue to continue processing other tasks
   * while waiting for the promise to resolve.
   * 
   * @example
   * function* myGenerator() {
   *   yield* scheduler.await(fetch('/api'));
   *   // Queue was not blocked during fetch
   * }
   */
  await: <T>(promise: Promise<T>) => Promise<T>;

  /**
   * Waits for the specified duration without blocking the queue.
   *
   * Useful for throttling or spacing work in generators or async flows
   * while allowing other queued tasks to continue running.
   *
   * @example
   * function* task() {
   *   yield scheduler.delay(100);
   *   // Queue kept processing during the delay
   * }
   */
  delay: (ms: number) => Promise<void>;
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
         * Yield between tasks (only if more work is already queued).
         *
         * IMPORTANT: yielding when the queue becomes empty leaves `pumping=true`
         * until the next microtask, which can delay tasks enqueued later in the
         * same call stack and cause ordering races in async-subject pipelines.
         */
        if (tasks.length > 0) {
          await Promise.resolve();
        }
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
      // Start pumping immediately so the first queued task runs in the same
      // call stack turn (until the pump hits its first `await`). This avoids
      // reordering bugs where later enqueues (e.g. from another Subject) can
      // execute before earlier commits.
      //
      // `pump()` still yields between tasks (`await Promise.resolve()`), so the
      // queue remains fair and microtask-friendly.
      void pump();
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

  /**
   * Awaits a promise without blocking the queue.
   * 
   * This method releases the current task slot, allowing
   * other tasks to execute while waiting for the promise.
   * Once the promise resolves, it re-enqueues to continue
   * execution in FIFO order.
   * 
   * For use with yield in generators:
   * 
   * @example
   * function* task() {
   *   const data = yield scheduler.await(fetchData());
   *   // Queue was not blocked during fetch
   * }
   * 
   * // Or with async/await syntax
   * const data = await scheduler.await(fetchData());
   */
  const awaitNonBlocking = <T>(promise: Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      // Wait for the promise outside the queue
      promise.then(
        (value) => {
          // Re-enqueue to continue in FIFO order
          enqueue(() => value).then(resolve, reject);
        },
        (error) => {
          // Re-enqueue the error
          enqueue(() => {
            throw error;
          }).catch(reject);
        }
      );
    });
  };

  /**
   * Delays execution without blocking the queue.
   * 
   * Uses awaitNonBlocking internally to release the queue
   * during the timeout period.
   */
  const delay = (ms: number): Promise<void> => {
    return awaitNonBlocking(
      new Promise<void>((resolve) => setTimeout(resolve, ms))
    );
  };

  const schedule = enqueue;

  return { enqueue, schedule, flush, await: awaitNonBlocking, delay };
}

/**
 * Global scheduler instance used by Streamix.
 */
export const scheduler = createScheduler();
