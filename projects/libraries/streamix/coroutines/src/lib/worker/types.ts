import type { CoroutineMessage } from "./messages";

/**
 * Task descriptor ready to be baked into a worker blob.
 *
 * `main` and `functions` are the single source of truth.
 * String forms are derived on demand via `serializeScript()`.
 */
export interface WorkerScript<T = any, R = any> {
  helpers?: string[];
  main: (data: T) => R | Promise<R>;
  functions?: Function[];
}

/**
 * Base contract for anything that can process a task and be finalized.
 */
export interface TaskRunner<T = any, R = any> {
  processTask: (data: T) => Promise<R>;
  finalize: () => Promise<void>;
}

/**
 * Low-level worker lifecycle management.
 *
 * All pool variants implement this interface.
 */
export interface WorkerPool {
  getIdleWorker: () => Promise<Worker>;
  returnWorker: (worker: Worker) => void;
  discardWorker: (worker: Worker, reason?: Error) => void;
  postMessageToWorker: (worker: Worker, message: Omit<CoroutineMessage, "workerId">) => void;
}

/**
 * Specialized pool with a task baked into the worker blob.
 *
 * Used internally by `actor()`.
 */
export interface TaskPool<T = any, R = any> extends WorkerPool, TaskRunner<T, R> {
  assignTask: (worker: Worker, data: T) => Promise<R>;
}


/**
 * Plain background-task runner backed by a worker pool.
 *
 * Created by `coroutine(mainTask)` or used as input to `compute(script)`.
 */
export interface Coroutine<T = any, R = T> extends TaskRunner<T, R> {}

/**
 * Rich bidirectional worker with main-thread messaging.
 *
 * `Actor` does **not** extend `Coroutine`; it is an independent top-level
 * concept built on the same underlying worker pool but with its own
 * bootstrap runtime and messaging surface.
 */
export interface Actor<T = any, R = T, FromMain = any, ToMain = any>
  extends TaskRunner<T, R> {
  /**
   * The underlying specialized task pool. Exposed so advanced users can
   * check out individual workers or send raw messages.
   */
  pool: TaskPool<T, R>;
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
