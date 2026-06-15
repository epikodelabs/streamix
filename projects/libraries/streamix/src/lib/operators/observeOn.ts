import { createOperator, DONE, isPromiseLike, type MaybePromise, type Operator, atom, iterate } from "../atoms";

/**
 * Creates a stream operator that schedules the emission of each value from the source
 * stream on a specified JavaScript task queue.
 *
 * This operator is a scheduler. It decouples the timing of value production from
 * its consumption, allowing you to control when values are emitted to downstream
 * operators. This is essential for preventing long-running synchronous operations
 * from blocking the main thread and for prioritizing different types of work.
 *
 * The operator supports three contexts:
 * - `"microtask"`: Emits the value at the end of the current task using `queueMicrotask`.
 * - `"macrotask"`: Emits the value in the next event loop cycle using `setTimeout(0)`.
 * - `"idle"`: Emits the value when the browser is idle using `requestIdleCallback`.
 *
 * @template T The type of the values in the source and output streams.
 * @param context The JavaScript task queue context to schedule emissions on.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const observeOn = <T = any>(context: MaybePromise<"microtask" | "macrotask" | "idle">) => {
  return createOperator<T, T>('observeOn', function (this: Operator, source) {
    const output = atom<T>();
    const outputIterator = iterate(output)[Symbol.asyncIterator]();
    let pendingCount = 0;
    let allDoneResolve: (() => void) | null = null;
    let stopped = false;
    const pendingCancels = new Set<() => void>();

    const waitForPending = (): Promise<void> => {
      if (pendingCount === 0) return Promise.resolve();
      return new Promise<void>((resolve) => { allDoneResolve = resolve; });
    };

    const settlePending = () => {
      pendingCount--;
      if (pendingCount === 0 && allDoneResolve) {
        allDoneResolve();
        allDoneResolve = null;
      }
    };

    void (async () => {
      try {
        const contextValue = isPromiseLike(context) ? await context : context;
        const schedule = contextValue === 'microtask'
          ? (fn: () => void) => {
              let settled = false;
              const cancel = () => {
                if (settled) return;
                settled = true;
                settlePending();
              };
              queueMicrotask(() => {
                if (settled || stopped) return;
                settled = true;
                try {
                  fn();
                } finally {
                  settlePending();
                }
              });
              return cancel;
            }
          : contextValue === 'macrotask'
            ? (fn: () => void) => {
                let settled = false;
                const timeoutId = setTimeout(() => {
                  if (settled || stopped) return;
                  settled = true;
                  try {
                    fn();
                  } finally {
                    settlePending();
                  }
                }, 0);

                return () => {
                  if (settled) return;
                  settled = true;
                  clearTimeout(timeoutId);
                  settlePending();
                };
              }
            : (fn: () => void) => {
                let settled = false;
                const fallback = () => {
                  const timeoutId = setTimeout(() => {
                    if (settled || stopped) return;
                    settled = true;
                    try {
                      fn();
                    } finally {
                      settlePending();
                    }
                  }, 0);

                  return () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeoutId);
                    settlePending();
                  };
                };

                if (typeof requestIdleCallback !== 'function') {
                  return fallback();
                }

                const idleId = requestIdleCallback(() => {
                  if (settled || stopped) return;
                  settled = true;
                  try {
                    fn();
                  } finally {
                    settlePending();
                  }
                });

                return () => {
                  if (settled) return;
                  settled = true;
                  if (typeof cancelIdleCallback === 'function') {
                    cancelIdleCallback(idleId);
                  }
                  settlePending();
                };
              };

        while (true) {
          const result = await source.next();
          if (result.done) break;
          pendingCount++;
          const capturedResult = result;
          const cancel = schedule(() => {
            pendingCancels.delete(cancel);
            output.next(capturedResult.value);
          });
          pendingCancels.add(cancel);
        }

        // Wait for all scheduled emissions before completing
        await waitForPending();
      } catch (err) {
        output.error(err);
      } finally {
        if (!output.disposed) output.dispose();
      }
    })();

    let completed = false;

    const iterator: AsyncIterator<T> = {
      async next() {
        while (true) {
          if (completed) return DONE;

          const result = await outputIterator.next();
          if (result.done) {
            completed = true;
            return DONE;
          }
          return { done: false as const, value: result.value };
        }
      },

      async return(value?: any) {
        completed = true;
        stopped = true;
        for (const cancel of pendingCancels) {
          cancel();
        }
        pendingCancels.clear();
        try {
          await source.return?.(value);
        } catch {}
        if (!output.disposed) output.dispose();
        return DONE;
      },

      async throw(err: any) {
        completed = true;
        stopped = true;
        for (const cancel of pendingCancels) {
          cancel();
        }
        pendingCancels.clear();
        try {
          await source.return?.();
        } catch {}
        if (!output.disposed) output.error(err);
        throw err;
      }
    };

    return iterator;
  });
};
