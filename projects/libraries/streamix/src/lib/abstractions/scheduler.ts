import { isPromiseLike } from "./operator";

export type Scheduler = {
  enqueue: <T>(fn: () => Promise<T> | T) => Promise<T>;
  flush: () => Promise<void>;
};

/**
 * Creates a cooperative asynchronous scheduler that serializes operations
 * in a global queue.
 */
export function createScheduler(): Scheduler {
  type Task<T = any> = () => Promise<T> | T;
  const queue: { task: Task; resolve: (val: any) => void; reject: (err: any) => void }[] = [];
  let isRunning = false;
  let flushResolvers: (() => void)[] = [];

  const processNext = async (): Promise<void> => {
    // If there's nothing left to do
    if (queue.length === 0) {
      isRunning = false;
      // Resolve all pending flushes because the queue is truly exhausted
      const currentResolvers = [...flushResolvers];
      flushResolvers = [];
      currentResolvers.forEach((resolve) => resolve());
      return;
    }

    isRunning = true;
    const { task, resolve, reject } = queue.shift()!;

    try {
      const result = task();
      const value = isPromiseLike(result) ? await result : result;
      resolve(value);
    } catch (error) {
      // We reject the task's specific promise
      reject(error);
      // We do NOT throw globally (no setTimeout). 
      // This allows the scheduler to move to the next task in the queue.
    } finally {
      // Use a microtask to allow any immediate enqueues (from inside the task) 
      // to hit the queue before we decide if we are "finished".
      queueMicrotask(() => processNext());
    }
  };

  const enqueue = <T>(fn: Task<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      queue.push({ task: fn, resolve, reject });

      if (!isRunning) {
        isRunning = true;
        // Start processing in the next microtask
        queueMicrotask(() => processNext());
      }
    });
  };

  const flush = (): Promise<void> => {
    // If idle and queue empty, resolve immediately
    if (!isRunning && queue.length === 0) {
      return Promise.resolve();
    }

    // Otherwise, join the list of resolvers to be notified when the queue empties
    return new Promise<void>((resolve) => {
      flushResolvers.push(resolve);
    });
  };

  return { enqueue, flush };
}

export const scheduler = createScheduler();