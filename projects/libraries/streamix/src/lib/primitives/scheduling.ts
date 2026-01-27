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
