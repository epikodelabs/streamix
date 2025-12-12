import { isPromiseLike } from "./operator";

/**
 * Functional Scheduler
 *
 * Provides enqueue/run behavior without exposing internal mutable state.
 * State is held in a closure, and operations are returned as pure functions.
 */
export type Scheduler = {
  enqueue: <T>(fn: () => Promise<T> | T) => Promise<T>;
  flush: () => Promise<void>;
};

/**
 * Creates a cooperative asynchronous scheduler that serializes operations
 * in a global queue.
 *
 * This scheduler ensures that tasks scheduled via `enqueue` are executed
 * in the order they were added, one at a time. If a task throws an error,
 * it is rethrown asynchronously to avoid blocking subsequent tasks in the queue.
 *
 * @returns {Scheduler} An object with methods to enqueue tasks and flush the queue.
 * @property {(fn: () => Promise<T> | T) => Promise<T>} enqueue
 *   Adds a task to the queue. The task may be synchronous or asynchronous.
 * @property {() => Promise<void>} flush
 *   Waits until all scheduled tasks have completed execution.
 */
export function createScheduler(): Scheduler {
  type Task<T = void> = () => Promise<T> | T;
  const queue: Task[] = [];
  let isRunning = false;
  let pendingFlush: (() => void) | null = null;

  const processNext = async (): Promise<void> => {
    if (isRunning || queue.length === 0) {
      return;
    }

    isRunning = true;
    const task = queue.shift()!;

    try {
      await task();
    } catch (error) {
      // Re-throw error asynchronously to avoid blocking the queue
      setTimeout(() => { throw error; }, 0);
    } finally {
      isRunning = false;
      
      // Check if there are more tasks or if someone is waiting for flush
      if (queue.length > 0) {
        void processNext();
      } else if (pendingFlush) {
        pendingFlush();
        pendingFlush = null;
      }
    }
  };

  const enqueue = <T>(fn: Task<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      // Wrap the user function to capture its result
      const wrappedTask: Task = async () => {
        try {
          const result = fn();
          // Handle both synchronous and asynchronous functions
          const value = isPromiseLike(result) ? await result : result;
          resolve(value);
        } catch (error) {
          reject(error);
          throw error; // Re-throw for the scheduler's error handling
        }
      };

      queue.push(wrappedTask);
      
      // Start processing if not already running
      if (!isRunning) {
        void processNext();
      }
    });
  };

  const flush = (): Promise<void> => {
    if (queue.length === 0 && !isRunning) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      pendingFlush = () => resolve();
      // Ensure processing starts if it's stalled
      if (!isRunning && queue.length > 0) {
        void processNext();
      }
    });
  };

  return { enqueue, flush };
}

export const scheduler = createScheduler();