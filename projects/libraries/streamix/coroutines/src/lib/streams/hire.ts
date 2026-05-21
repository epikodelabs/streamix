import { createStream, type MaybePromise, type Stream } from "@epikodelabs/streamix";
import type { Coroutine, CoroutineMessage, Actor } from "../operators";

/**
 * Subset of `Coroutine` needed to hire and manage a dedicated worker.
 *
 * @template T The type of task input.
 * @template R The type of task output.
 */
export type HirableTask<T = any, R = any> = Pick<
  Coroutine<T, R>,
  "assignTask" | "getIdleWorker" | "returnWorker" | "discardWorker"
>;

/**
 * Extension for tasks that support direct main-to-worker messaging.
 *
 * @template FromMain The type of messages sent from the main thread to the worker.
 */
export type MessageCapableTask<FromMain = any> = {
  /** Sends a message to a specific worker by its id. */
  sendToWorker: (workerId: number, payload: FromMain) => void;
};

/**
 * Optional configuration for the `hire` stream.
 */
export type HireOptions = {
  /**
   * Maximum time in milliseconds to hold the worker before auto-releasing.
   * If omitted, the worker is held until `release()` is called.
   */
  timeout?: number;
};

/**
 * Interface for a worker that has been "hired" from the coroutine pool.
 */
export interface HiredWorker<T = any, R = T> {
  workerId: number;
  sendTask: (data: T) => Promise<R>;
  release: () => void;
}

/**
 * Actor sessions support main-to-worker messaging on the dedicated worker.
 */
export interface HiredActorWorker<T = any, R = T, FromMain = any> extends HiredWorker<T, R> {
  sendMessage: (payload: FromMain) => void;
}

/**
 * Hires a dedicated worker from a coroutine pool and exposes it as a stream.
 *
 * The stream yields a single `HiredWorker` that can be used to send tasks directly
 * to the same worker instance. The worker is returned to the pool when the stream
 * is unsubscribed, the worker is released, or the optional timeout expires.
 *
 * **Important:** The consumer must call `hiredWorker.release()` when done, or
 * provide a `timeout`, otherwise the worker will be held indefinitely.
 *
 * @template T The type of task input.
 * @template R The type of task output.
 * @param task The coroutine or actor to hire from.
 * @param onMessage Handler for messages emitted by the hired worker.
 * @param onError Handler for errors emitted by the hired worker.
 * @param options Optional configuration for hire behavior.
 * @returns A stream that yields one `HiredWorker`.
 */
export function hire<T = any, R = T>(
  task: HirableTask<T, R>,
  onMessage: (message: CoroutineMessage) => MaybePromise<void>,
  onError: (error: Error) => MaybePromise<void>,
  options?: HireOptions
): Stream<HiredWorker<T, R>>;

/**
 * Hires a dedicated actor worker and exposes it as a stream.
 *
 * The stream yields a single `HiredActorWorker` that supports both direct
 * task assignment and main-to-worker messaging.
 *
 * **Important:** The consumer must call `hiredWorker.release()` when done, or
 * provide a `timeout`, otherwise the worker will be held indefinitely.
 *
 * @template T The type of task input.
 * @template R The type of task output.
 * @template FromMain The type of messages sent from main to the worker.
 * @param task An actor.
 * @param onMessage Handler for messages emitted by the hired worker.
 * @param onError Handler for errors emitted by the hired worker.
 * @param options Optional configuration for hire behavior.
 * @returns A stream that yields one `HiredActorWorker`.
 */
export function hire<T = any, R = T, FromMain = any>(
  task: Actor<T, R, FromMain>,
  onMessage: (message: CoroutineMessage) => MaybePromise<void>,
  onError: (error: Error) => MaybePromise<void>,
  options?: HireOptions
): Stream<HiredActorWorker<T, R, FromMain>>;

/**
 * Hires a dedicated worker from a coroutine pool.
 *
 * @param task The coroutine or actor to hire from.
 * @param onMessage Handler for messages emitted by the hired worker.
 * @param onError Handler for errors emitted by the hired worker.
 * @param options Optional configuration for hire behavior.
 * @returns A stream that yields one hired worker.
 */
export function hire<T = any, R = T>(
  task: HirableTask<T, R>,
  onMessage: (message: CoroutineMessage) => MaybePromise<void>,
  onError: (error: Error) => MaybePromise<void>,
  options?: HireOptions
): Stream<HiredWorker<T, R>> {
  return createStream("hire", async function* () {
    const { worker, workerId } = await task.getIdleWorker();
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
          task.discardWorker(
            workerId,
            fatalWorkerReason ?? new Error(`Worker ${workerId} emitted an error event`)
          );
        } else {
          task.returnWorker(workerId);
        }
        ac.abort();
        releaseResolve?.();
      }
    };

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeout !== undefined && options.timeout > 0) {
      timeoutId = setTimeout(() => {
        if (!disposed) {
          console.warn(`[hire] Worker ${workerId} auto-released after ${options.timeout}ms timeout`);
          cleanup();
        }
      }, options.timeout);
    }

    worker.addEventListener("message", messageHandler);

    worker.addEventListener("error", errorHandler);

    const sendMessage = (payload: unknown) => {
      const messageTask = task as HirableTask<T, R> & Partial<MessageCapableTask<unknown>>;
      if (!messageTask.sendToWorker) {
        throw new Error("This hired worker does not support direct main-to-worker messages");
      }
      messageTask.sendToWorker(workerId, payload);
    };

    const hiredWorker: HiredWorker<T, R> | HiredActorWorker<T, R> = {
      workerId,
      sendTask: (data: T) => task.assignTask(workerId, data),
      release: cleanup,
    };

    if ("sendToWorker" in task && typeof (task as any).sendToWorker === "function") {
      (hiredWorker as HiredActorWorker<T, R>).sendMessage = sendMessage;
    }

    try {
      yield hiredWorker;

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


