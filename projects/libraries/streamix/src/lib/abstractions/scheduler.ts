import { createSubject, type Subject } from "../subjects/subject";

/**
 * Schedules a callback to be executed in the next microtask.
 * Uses `queueMicrotask` if available, otherwise falls back to `Promise.resolve().then()`.
 * @param fn The callback to execute.
 */
export const performMicrotask = typeof queueMicrotask === "function"
  ? queueMicrotask
  : (fn: () => void) => void Promise.resolve().then(fn);

/**
 * Runs a function within a microtask and returns a Promise that resolves with its result.
 * This ensures the function executes asynchronously relative to the current stack,
 * but with higher priority than macrotasks (setTimeout, etc.).
 * 
 * @template T The return type of the function.
 * @param fn The function to execute.
 * @returns A Promise that resolves to the function's return value.
 */
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
 * A unit of work to be executed by the scheduler.
 */
export type Task = {
  execute: () => void | Promise<void>;
  ownerId?: string;
  kind?: string;
};

/**
 * A scheduler that accepts tasks via `schedule` (push) and allows
 * execution via async iteration (pull).
 */
export type Scheduler = Subject<Task> & {
  /**
   * Schedules a task for execution.
   * @param task The function or task object to execute.
   */
  schedule(task: Task | (() => void | Promise<void>)): void;
};

// Use native microtasks for the scheduler's own internal coordination
// to avoid recursive dependency on itself.
const subject = createSubject<Task>({
  scheduleCommit: (commitFn) => performMicrotask(commitFn)
});

/**
 * The global scheduler instance.
 * - Push tasks using `scheduler.schedule(fn)` or `scheduler.next(fn)`.
 * - Pull/Execute tasks using `for await (const task of scheduler) { await task(); }`.
 * 
 * Note: The scheduler loop is started automatically when this module is imported.
 */
export const scheduler: Scheduler = {
  ...subject,
  schedule: (task) => {
    if (typeof task === "function") {
      subject.next({ execute: task });
    } else {
      subject.next(task);
    }
  },
};

/**
 * Starts a pull-based execution loop for the given scheduler.
 * This function allows the scheduler to process tasks one by one.
 * @param sched The scheduler to run (defaults to the global scheduler).
 * @param filter Optional predicate to filter tasks. If the predicate returns false,
 *               the task is NOT executed (dropped).
 */
export async function runScheduler(
  sched: Scheduler = scheduler,
  filter?: (task: Task) => boolean
): Promise<void> {
  for await (const task of sched) {
    try {
      if (filter && !filter(task)) {
        continue;
      }
      await task.execute();
    } catch (err) {
      console.error("Scheduler task failed:", err);
    }
  }
}

// Automatically start the global scheduler.
// We catch errors to prevent unhandled promise rejections, though the loop itself catches task errors.
runScheduler().catch(err => console.error("Global scheduler loop crashed:", err));
