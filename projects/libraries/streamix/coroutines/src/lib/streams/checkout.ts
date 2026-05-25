import { createStream, type MaybePromise, type Stream } from "@epikodelabs/streamix";
import type { CoroutineMessage } from "../worker/messages";
import { generateTaskId } from "../worker/utils";
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
 * The stream yields a single `CheckedOutWorker` that can run any `WorkerScript`
 * directly on the same worker instance. The worker is returned to the pool when
 * the stream is unsubscribed, the worker is released, or the optional timeout
 * expires.
 *
 * **Important:** The consumer must call `worker.release()` when done, or
 * provide a `timeout`, otherwise the worker will be held indefinitely.
 *
 * @param pool The worker pool to check out from.
 * @param onMessage Handler for messages emitted by the checked-out worker.
 * @param onError Handler for errors emitted by the checked-out worker.
 * @param options Optional configuration for checkout behavior.
 * @returns A stream that yields one `CheckedOutWorker`.
 */
export function checkout(
  pool: WorkerPool,
  onMessage: (message: CoroutineMessage) => MaybePromise<void>,
  onError: (error: Error) => MaybePromise<void>,
  options?: CheckoutOptions
): Stream<CheckedOutWorker> {
  return createStream("checkout", async function* () {
    const worker = await pool.getIdleWorker();
    const workerId = (worker as any).__id as number;
    let disposed = false;
    let fatalWorkerError = false;
    let fatalWorkerReason: Error | undefined;
    const ac = new AbortController();
    const signal = ac.signal;
    let releaseResolve: (() => void) | undefined;

    const pendingMessages = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();

    const messageHandler = async (event: MessageEvent<CoroutineMessage>) => {
      const msg = event.data;
      if (msg.workerId !== workerId) return;

      // Route task responses to pending promises
      if (msg.type === "response" || msg.type === "error") {
        const pending = pendingMessages.get(msg.taskId);
        if (pending) {
          pendingMessages.delete(msg.taskId);
          if (msg.type === "response") {
            pending.resolve(msg.payload);
          } else {
            pending.reject(new Error(msg.error ?? "Unknown worker error"));
          }
          return;
        }
      }

      await onMessage(msg);
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

        // Reject any pending task promises
        pendingMessages.forEach(({ reject }) => {
          reject(new Error("Worker released before task completed"));
        });
        pendingMessages.clear();

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

    const checkedOutWorker: CheckedOutWorker = {
      worker,
      processTask: async <T, R>(fn: (data: T) => R | Promise<R>, data: T): Promise<R> => {
        const taskId = generateTaskId();
        return new Promise<R>((resolve, reject) => {
          pendingMessages.set(taskId, { resolve, reject });
          try {
            worker.postMessage({
              workerId,
              taskId,
              payload: data,
              type: "task",
              code: fn.toString(),
              deps: [],
              helpers: [],
            });
          } catch (error) {
            pendingMessages.delete(taskId);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
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
