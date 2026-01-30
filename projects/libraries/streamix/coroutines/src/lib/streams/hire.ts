import { createStream, type MaybePromise, type Stream } from "@epikodelabs/streamix";
import type { Coroutine, CoroutineMessage } from "../operators";

/**
 * Interface for a worker that has been "hired" from the coroutine pool.
 * It provides a persistent, bidirectional communication channel and a method
 * to release the worker back to the pool.
 *
 * @template T The type of data sent to the worker.
 * @template R The type of data returned from the worker.
 * @interface
 */
export interface HiredWorker<T = any, R = T> {
  /** The unique identifier of the hired worker. */
  workerId: number;

  /**
   * Sends a task to the hired worker.
   * @param {T} data The data to be processed by the worker.
   * @returns {Promise<R>} A promise that resolves with the result from the worker.
   */
  sendTask: (data: T) => Promise<R>;

  /**
   * Releases the worker back to the pool.
   * This method must be called to free up the worker for other tasks.
   * After calling this, the `sendTask` method and event listeners will be defunct.
   */
  release: () => void;
}

/**
 * Creates a stream that "hires" a single worker from the coroutine pool,
 * providing a persistent, manually-controlled communication channel.
 *
 * This operator is ideal for scenarios where you need to perform multiple,
 * sequential tasks on a specific, stateful worker. The worker remains
 * dedicated to the returned stream until the `release()` method is called
 * on the `HiredWorker` object.
 *
 * The stream itself will only emit a single `HiredWorker` object and then complete
 * after the worker has been released.
 *
 * @template T The type of data sent to the worker.
 * @template R The type of data returned from the worker.
 * @param {Coroutine<T, R>} task The coroutine instance managing the worker pool.
 * @param {(message: CoroutineMessage) => MaybePromise<void>} onMessage A callback function to handle messages received from the hired worker.
 * @param {(error: Error) => MaybePromise<void>} onError A callback function to handle errors originating from the hired worker.
 * @returns {Stream<HiredWorker<T, R>>} A stream that yields a single `HiredWorker` object.
 */
export function hire<T = any, R = T>(
  task: Coroutine<T, R>,
  onMessage: (message: CoroutineMessage) => MaybePromise<void>,
  onError: (error: Error) => MaybePromise<void>
): Stream<HiredWorker<T, R>> {
  return createStream("hire", async function* () {
    const { worker, workerId } = await task.getIdleWorker();
    let disposed = false;
    const ac = new AbortController();
    const signal = ac.signal;

    const messageHandler = async (event: MessageEvent<CoroutineMessage>) => {
      if (event.data.workerId === workerId) {
        await onMessage(event.data);
      }
    };
    const errorHandler = async (event: ErrorEvent) => {
      await onError(event.error);
      if (!disposed) {
        ac.abort();
      }
    };

    const cleanup = () => {
      if (!disposed) {
        disposed = true;
        worker.removeEventListener("message", messageHandler);
        worker.removeEventListener("error", errorHandler);
        task.returnWorker(workerId);
        ac.abort();
      }
    };

    worker.addEventListener("message", messageHandler);

    worker.addEventListener("error", errorHandler);

    const hiredWorker: HiredWorker<T, R> = {
      workerId,
      sendTask: (data: T) => task.assignTask(workerId, data),
      release: cleanup,
    };

    try {
      yield hiredWorker;

      // Wait until release or iterator is abandoned
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    } finally {
      cleanup();
    }
  });
}


