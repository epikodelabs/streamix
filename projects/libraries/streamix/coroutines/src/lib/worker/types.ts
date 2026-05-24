import type { Operator } from "@epikodelabs/streamix";
import type { CoroutineMessage } from "./messages";

/**
 * Base contract for anything that can process a task and be finalized.
 */
export interface TaskRunner<T = any, R = any> {
  processTask: (data: T) => Promise<R>;
  finalize: () => Promise<void>;
}

/**
 * Plain background-task operator.
 */
export interface Coroutine<T = any, R = T> extends Operator<T, R>, TaskRunner<T, R> {}

/**
 * Rich bidirectional worker with main-thread messaging.
 *
 * `Actor` does **not** extend `Coroutine`; it is an independent top-level
 * concept built on the same underlying worker pool but with its own
 * bootstrap runtime and messaging surface.
 */
export interface Actor<T = any, R = T, FromMain = any, ToMain = any>
  extends Operator<T, R>, TaskRunner<T, R> {
  /**
   * Sends a one-way message to a specific worker.
   * The message is routed to the currently active task on that worker.
   * If no task is active when the message arrives, it will be dropped.
   */
  sendToWorker: (worker: Worker, payload: FromMain) => void;
  /**
   * Subscribes to one-way messages sent from the worker via `utils.main.send()`.
   * Returns an unsubscribe function.
   */
  onMessage: (handler: (payload: ToMain) => void) => () => void;
}

/**
 * Worker-pool management methods for low-level worker control.
 */
export interface WorkerPool<T = any, R = any> {
  assignTask: (worker: Worker, data: T) => Promise<R>;
  getIdleWorker: () => Promise<Worker>;
  returnWorker: (worker: Worker) => void;
  discardWorker: (worker: Worker, reason?: Error) => void;
  postMessageToWorker: (worker: Worker, message: Omit<CoroutineMessage, "workerId">) => void;
}

/**
 * Interface for a worker that has been checked out from the coroutine pool.
 *
 * When the source task supports messaging (e.g. an `actor`), `sendMessage`
 * will be present.
 */
export interface CheckedOutWorker<T = any, R = T> {
  worker: Worker;
  sendTask: (data: T) => Promise<R>;
  release: () => void;
}
