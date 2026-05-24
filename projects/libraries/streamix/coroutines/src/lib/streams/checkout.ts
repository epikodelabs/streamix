import { createStream, type MaybePromise, type Stream } from "@epikodelabs/streamix";
import type { CoroutineMessage } from "../worker/messages";
import type { CheckedOutWorker, WorkerPool } from "../worker/types";

/**
 * Optional configuration for the `checkout` stream.
 */
export type CheckoutOptions = {
  /**
   * Maximum time in milliseconds to hold the worker before auto-releasing.
   * If omitted, the worker is held until `release()` is called.
   */
  timeout?: number;
};

/**
 * Checks out a dedicated worker from a worker pool and exposes it as a stream.
 *
 * The stream yields a single `CheckedOutWorker` that can be used to send tasks directly
 * to the same worker instance. The worker is returned to the pool when the stream
 * is unsubscribed, the worker is released, or the optional timeout expires.
 *
 * The pool must expose `WorkerPool` methods. If you need actor messaging, use
 * `postMessageToWorker` directly on the pool.
 *
 * **Important:** The consumer must call `worker.release()` when done, or
 * provide a `timeout`, otherwise the worker will be held indefinitely.
 *
 * @template T The type of task input.
 * @template R The type of task output.

 * @param pool The worker pool to check out from.
 * @param onMessage Handler for messages emitted by the checked-out worker.
 * @param onError Handler for errors emitted by the checked-out worker.
 * @param options Optional configuration for checkout behavior.
 * @returns A stream that yields one `CheckedOutWorker`.
 */
export function checkout<T = any, R = any>(
  pool: WorkerPool<T, R>,
  onMessage: (message: CoroutineMessage) => MaybePromise<void>,
  onError: (error: Error) => MaybePromise<void>,
  options?: CheckoutOptions
): Stream<CheckedOutWorker<T, R>> {
  return createStream("checkout", async function* () {
    const worker = await pool.getIdleWorker();
    const workerId = (worker as any).__id as number;
    let disposed = false;
    let fatalWorkerError = false;
    let fatalWorkerReason: Error | undefined;
    const ac = new AbortController();
    const signal = ac.signal;
    let releaseResolve: (() => void) | undefined;

    const messageHandler = async (event: MessageEvent<CoroutineMessage>) => {
      if (event.data.workerId === workerId) {
        await onMessage(event.data);
      }
    };
    const errorHandler = async (event: ErrorEvent) => {
      fatalWorkerError = true;
      fatalWorkerReason =
        event.error instanceof Error ? event.error : new Error(String(event.error));
      await onError(fatalWorkerReason);
      if (!disposed) {
        ac.abort();
        releaseResolve?.();
      }
    };

    const cleanup = () => {
      if (!disposed) {
        disposed = true;
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        worker.removeEventListener("message", messageHandler);
        worker.removeEventListener("error", errorHandler);
        if (fatalWorkerError) {
          pool.discardWorker(
            worker,
            fatalWorkerReason ?? new Error(`Worker ${workerId} emitted an error event`)
          );
        } else {
          pool.returnWorker(worker);
        }
        ac.abort();
        releaseResolve?.();
      }
    };

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeout !== undefined && options.timeout > 0) {
      timeoutId = setTimeout(() => {
        if (!disposed) {
          console.warn(`[checkout] Worker ${workerId} auto-released after ${options.timeout}ms timeout`);
          cleanup();
        }
      }, options.timeout);
    }

    worker.addEventListener("message", messageHandler);
    worker.addEventListener("error", errorHandler);

    const checkedOutWorker: CheckedOutWorker<T, R> = {
      worker,
      sendTask: (data: T) => pool.assignTask(worker, data),
      release: cleanup,
    };

    try {
      yield checkedOutWorker;

      // Wait until release, error, timeout, or iterator is abandoned
      await new Promise<void>((resolve) => {
        releaseResolve = resolve;
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    } finally {
      cleanup();
    }
  });
}
