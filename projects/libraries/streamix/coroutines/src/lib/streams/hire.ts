import { createStream, type MaybePromise, type Stream } from "@epikodelabs/streamix";
import type { Coroutine, CoroutineMessage, Interactive } from "../operators";

export type HirableTask<T = any, R = any> = Pick<
  Coroutine<T, R>,
  "assignTask" | "getIdleWorker" | "returnWorker"
>;

export type MessageCapableTask<FromMain = any> = {
  sendToWorker: (workerId: number, payload: FromMain) => void;
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
 * Interactive sessions support main-to-worker messaging on the dedicated worker.
 */
export interface HiredInteractiveWorker<T = any, R = T, FromMain = any> extends HiredWorker<T, R> {
  sendMessage: (payload: FromMain) => void;
}

export function hire<T = any, R = T>(
  task: HirableTask<T, R>,
  onMessage: (message: CoroutineMessage) => MaybePromise<void>,
  onError: (error: Error) => MaybePromise<void>
): Stream<HiredWorker<T, R>>;
export function hire<T = any, R = T, FromMain = any>(
  task: Interactive<T, R, FromMain>,
  onMessage: (message: CoroutineMessage) => MaybePromise<void>,
  onError: (error: Error) => MaybePromise<void>
): Stream<HiredInteractiveWorker<T, R, FromMain>>;
export function hire<T = any, R = T>(
  task: HirableTask<T, R>,
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

    const sendMessage = (payload: unknown) => {
      const messageTask = task as HirableTask<T, R> & Partial<MessageCapableTask<unknown>>;
      if (!messageTask.sendToWorker) {
        throw new Error("This hired worker does not support direct main-to-worker messages");
      }
      messageTask.sendToWorker(workerId, payload);
    };

    const hiredWorker: HiredWorker<T, R> | HiredInteractiveWorker<T, R> = {
      workerId,
      sendTask: (data: T) => task.assignTask(workerId, data),
      release: cleanup,
    };

    if ("sendToWorker" in task && typeof (task as any).sendToWorker === "function") {
      (hiredWorker as HiredInteractiveWorker<T, R>).sendMessage = sendMessage;
    }

    try {
      yield hiredWorker;

      // Wait until release or iterator is abandoned
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    } finally {
      cleanup();
    }
  });
}


