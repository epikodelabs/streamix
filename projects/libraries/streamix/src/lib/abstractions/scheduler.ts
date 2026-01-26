import { isPromiseLike } from "./operator"; // Adjust path as needed

export type Scheduler = {
  enqueue: <T>(fn: () => Promise<T> | T) => Promise<T>;
  flush: () => Promise<void>;
  await: <T>(promise: Promise<T>) => Promise<T>;
  delay: (ms: number) => Promise<void>;
};

export function createScheduler(): Scheduler {
  const tasks: Array<{ fn: () => any; stack?: string }> = [];
  const resolves: Array<(v: any) => void> = [];
  const rejects: Array<(e: any) => void> = [];

  let flushResolvers: Array<() => void> = [];
  let pumping = false;
  let executionStack = 0;

  /**
   * Resolves any pending flush() calls if there is no more work.
   * We check tasks.length and executionStack. We do NOT check 
   * the 'pumping' flag here to avoid hanging during the transition 
   * from pumping to idle.
   */
  const resolveFlushIfIdle = (): void => {
    if (tasks.length === 0 && executionStack === 0) {
      if (flushResolvers.length > 0) {
        const current = flushResolvers;
        flushResolvers = [];
        for (const resolve of current) resolve();
      }
    }
  };

  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;

    try {
      while (tasks.length > 0) {
        const taskObj = tasks.shift()!;
        const resolve = resolves.shift()!;
        const reject = rejects.shift()!;

        try {
          executionStack++;
          const result = taskObj.fn();
          // If the task is a promise, we await it here.
          // This is a yield point where other microtasks can run.
          const value = isPromiseLike(result) ? await result : result;
          resolve(value);
        } catch (err) {
          reject(err);
        } finally {
          executionStack--;
        }

        // Forced yield to prevent starvation and allow microtasks to run.
        await Promise.resolve();
      }
    } finally {
      pumping = false;
      resolveFlushIfIdle();
    }
  };

  const enqueue = <T>(fn: () => Promise<T> | T): Promise<T> => {
    /**
     * RE-ENTRANCY LOGIC:
     * If we are already executing a task, run this immediately.
     * This prevents deadlocks during synchronous observer chains.
     */
    if (executionStack > 0) {
      try {
        const result = fn();
        return isPromiseLike(result) ? result : Promise.resolve(result);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    return new Promise<T>((resolve, reject) => {
      tasks.push({ fn: fn as any });
      resolves.push(resolve as any);
      rejects.push(reject as any);

      if (!pumping) {
        // Start the pump on the next microtask turn.
        queueMicrotask(() => void pump());
      }
    });
  };

  const flush = (): Promise<void> => {
    /**
     * IDLE CHECK:
     * If there are no tasks and no current execution, we are idle.
     * We ignore the 'pumping' flag status to avoid the "exit gap" hang.
     */
    const waitForDrain = () =>
      new Promise<void>((resolve) => {
        flushResolvers.push(resolve);

        // If work exists but pump is off, start it.
        if (!pumping && tasks.length > 0) {
          void pump();
        }
      });

    // `enqueue()` may execute work immediately when called re-entrantly
    // (executionStack > 0). That immediate work can await promises that
    // resolve on the microtask queue without adding new scheduler tasks.
    // To make `flush()` reliable as "wait until callbacks settle", we yield
    // at least one microtask turn after the queue drains.
    return (async () => {
      if (tasks.length > 0) {
        await waitForDrain();
      }

      await Promise.resolve();

      if (tasks.length > 0) {
        await waitForDrain();
        await Promise.resolve();
      }
    })();
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
