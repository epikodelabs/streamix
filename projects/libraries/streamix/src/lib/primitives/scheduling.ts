/**
 * Low-level microtask scheduler used across Streamix internals.
 *
 * Prefers the platform-native `queueMicrotask` when available and falls back to
 * `Promise.resolve().then(...)` otherwise.
 *
 * This is intentionally exported so other Streamix packages (and power users)
 * can share a consistent scheduling primitive.
 */
export const performMicrotask = typeof queueMicrotask === "function"
  ? queueMicrotask
  : (fn: () => void) => void Promise.resolve().then(fn);

/**
 * Enqueues a callback to run in a microtask.
 *
 * @param fn Callback to schedule.
 */
export function enqueueMicrotask(fn: () => void): void {
  performMicrotask(fn);
}

/**
 * Runs a callback in a microtask and returns its result as a Promise.
 *
 * Unlike calling `Promise.resolve().then(fn)` directly, this helper ensures that
 * synchronous throws from `fn` are converted into a rejected Promise.
 *
 * @template T Return type.
 * @param fn Callback to run in a microtask.
 * @returns A Promise that resolves to the callback result.
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
