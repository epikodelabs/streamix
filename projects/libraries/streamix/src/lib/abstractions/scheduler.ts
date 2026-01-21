import { isPromiseLike } from "./operator"; // Adjust path as needed

export type Scheduler = {
  enqueue: <T>(fn: () => Promise<T> | T) => Promise<T>;
  flush: () => Promise<void>;
  await: <T>(promise: Promise<T>) => Promise<T>;
  delay: (ms: number) => Promise<void>;
};

export function createScheduler(): Scheduler {
  const tasks: Array<() => any> = [];
  const resolves: Array<(v: any) => void> = [];
  const rejects: Array<(e: any) => void> = [];

  let flushResolvers: Array<() => void> = [];
  let pumping = false;
  
  /**
   * Tracks how many tasks are currently on the stack.
   * If > 0, we are in a re-entrant state.
   */
  let executionStack = 0;

  const scheduleMicrotask = (cb: () => void) => queueMicrotask(cb);

  const resolveFlushIfIdle = (): void => {
    scheduleMicrotask(() => {
      // Ensure we are truly idle across a microtask turn
      if (!pumping && tasks.length === 0 && flushResolvers.length > 0) {
        const current = flushResolvers;
        flushResolvers = [];
        for (const resolve of current) resolve();
      }
    });
  };

  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;

    try {
      while (tasks.length > 0) {
        const task = tasks.shift()!;
        const resolve = resolves.shift()!;
        const reject = rejects.shift()!;

        try {
          executionStack++;
          const result = task();
          const value = isPromiseLike(result) ? await result : result;
          resolve(value);
        } catch (err) {
          reject(err);
        } finally {
          executionStack--;
        }

        // Yield to allow microtask-queued tasks (like promise .thens) 
        // to re-populate the queue before the next loop iteration.
        await Promise.resolve();
      }
    } finally {
      pumping = false;
      resolveFlushIfIdle();
    }
  };

  const ensurePump = (): void => {
    if (!pumping) {
      scheduleMicrotask(() => void pump());
    }
  };

  const enqueue = <T>(fn: () => Promise<T> | T): Promise<T> => {
    /**
     * RE-ENTRANCY LOGIC:
     * If we are already executing a task (executionStack > 0), 
     * we run this immediately. This prevents deadlocks in 
     * Subject.next() -> Receiver.next() -> Unsubscribe() flows.
     */
    if (executionStack > 0) {
      try {
        const result = fn();
        return isPromiseLike(result) ? result : Promise.resolve(result);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    // Standard FIFO queuing
    return new Promise<T>((resolve, reject) => {
      tasks.push(fn as any);
      resolves.push(resolve as any);
      rejects.push(reject as any);
      ensurePump();
    });
  };

  const flush = (): Promise<void> => {
    if (!pumping && tasks.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      flushResolvers.push(resolve);
      ensurePump();
      resolveFlushIfIdle();
    });
  };

  const awaitNonBlocking = <T>(promise: Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      promise.then(
        (value) => enqueue(() => value).then(resolve, reject),
        (error) => enqueue(() => { throw error; }).catch(reject)
      );
    });
  };

  const delay = (ms: number): Promise<void> => {
    return awaitNonBlocking(new Promise((res) => setTimeout(res, ms)));
  };

  return { enqueue, flush, await: awaitNonBlocking, delay };
}

export const scheduler = createScheduler();