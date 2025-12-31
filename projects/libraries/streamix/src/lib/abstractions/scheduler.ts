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
 *   across a microtask turn (prevents "flush lies")
 *
 * Performance optimizations:
 * - Parallel arrays instead of per-task objects
 * - At most one pump in flight
 * - Compact storage for flush waiters
 * - Explicit yielding mechanism for non-blocking awaits
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

  /**
   * Awaits a promise without blocking the queue.
   * 
   * Designed for use within async tasks. When awaited,
   * it allows the queue to continue processing other tasks
   * while waiting for the promise to resolve.
   * 
   * @example
   * scheduler.enqueue(async () => {
   *   const data = await scheduler.await(fetch('/api'));
   *   // Queue was not blocked during fetch
   * });
   */
  await: <T>(promise: Promise<T>) => Promise<T>;

  /**
   * Waits for the specified duration without blocking the queue.
   *
   * Useful for throttling or spacing work in async flows
   * while allowing other queued tasks to continue running.
   *
   * @example
   * scheduler.enqueue(async () => {
   *   await scheduler.delay(100);
   *   // Queue kept processing during the delay
   * });
   */
  delay: (ms: number) => Promise<void>;
};

/**
 * Function createScheduler.
 */
export function createScheduler(): Scheduler {
  const tasks: Array<() => any> = [];
  const resolves: Array<(v: any) => void> = [];
  const rejects: Array<(e: any) => void> = [];
  let flushResolvers: Array<() => void> = [];

  let pumping = false;
  let pumpScheduled = false;
  let currentYield: null | (() => void) = null;

  const scheduleMicrotask = (cb: () => void) => queueMicrotask(cb);

  const resolveFlushIfIdle = (): void => {
    scheduleMicrotask(() => {
      // Check if we are truly idle: no pump running, no pump scheduled, no tasks
      if (!pumping && !pumpScheduled && tasks.length === 0 && flushResolvers.length > 0) {
        const current = flushResolvers;
        flushResolvers = [];
        for (let i = 0; i < current.length; i++) current[i]();
      }
    });
  };

  const pump = (): void => {
    pumpScheduled = false;
    if (pumping || tasks.length === 0) return;

    pumping = true;

    const task = tasks.shift()!;
    const resolve = resolves.shift()!;
    const reject = rejects.shift()!;

    let yielded = false;
    let yieldResolve!: () => void;
    const yieldPromise = new Promise<void>((res) => {
      yieldResolve = () => {
        if (!yielded) {
          yielded = true;
          res();
        }
      };
    });
    const previousYield = currentYield;
    currentYield = yieldResolve;

    // Execute the task
    try {
      const result = task();

      if (isPromiseLike(result)) {
        const settled = Promise.resolve(result).then(
          (value) => ({ status: "resolved" as const, value }),
          (error) => ({ status: "rejected" as const, error })
        );

        Promise.race([
          settled,
          yieldPromise.then(() => ({ status: "yielded" as const })),
        ]).then((winner) => {
          currentYield = previousYield;

          if (winner.status === "resolved") {
            resolve(winner.value);
            next();
            return;
          }

          if (winner.status === "rejected") {
            reject(winner.error);
            next();
            return;
          }

          // Task yielded - wait for it to complete but continue processing queue
          result.then(resolve, reject);
          next();
        });
      } else {
        currentYield = previousYield;
        resolve(result);
        // Even for sync tasks, yield to allow flushes/new enqueues
        scheduleMicrotask(next);
      }
    } catch (err) {
      currentYield = previousYield;
      reject(err);
      next();
    }
  };

  const next = () => {
    pumping = false;
    if (tasks.length > 0) {
      ensurePump();
    } else {
      resolveFlushIfIdle();
    }
  };

  const ensurePump = (): void => {
    if (!pumping && !pumpScheduled) {
      pumpScheduled = true;
      scheduleMicrotask(pump);
    }
  };

  const enqueue = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const promise = new Promise<T>((resolve, reject) => {
      tasks.push(fn as any);
      resolves.push(resolve as any);
      rejects.push(reject as any);
    });
    ensurePump();
    return promise;
  };

  const flush = (): Promise<void> => {
    if (!pumping && !pumpScheduled && tasks.length === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      flushResolvers.push(resolve);
      ensurePump();
      resolveFlushIfIdle();
    });
  };

  /**
   * Awaits a promise without blocking the queue.
   * 
   * If called outside an enqueued task (no currentYield), returns the promise directly.
   * 
   * If called inside an enqueued task:
   * 1. Signals the pump to yield via currentYield()
   * 2. When the promise resolves, re-enqueues a task that returns the value
   * 3. Returns a promise that resolves when that re-enqueued task completes
   */
  const awaitNonBlocking = <T>(promise: Promise<T>): Promise<T> => {
    // If not in a task context, just return the promise
    if (!currentYield) {
      return promise;
    }

    const yieldFn = currentYield;

    return new Promise<T>((resolve, reject) => {
      promise.then(
        (value) => {
          // Re-enqueue a task that returns the resolved value
          enqueue(() => value).then(resolve, reject);
        },
        (error) => {
          // Re-enqueue a task that returns the rejected error
          enqueue(() => Promise.reject(error)).then(resolve, reject);
        }
      );

      // Signal the pump that we're yielding
      yieldFn();
    });
  };

  const delay = (ms: number): Promise<void> =>
    awaitNonBlocking(new Promise<void>((res) => setTimeout(res, ms)));

  return {
    enqueue,
    flush,
    await: awaitNonBlocking,
    delay
  };
}

/**
 * Global scheduler instance used by Streamix.
 */
export const scheduler = createScheduler();