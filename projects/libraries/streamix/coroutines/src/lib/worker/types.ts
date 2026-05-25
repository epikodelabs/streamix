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
 * Used internally by `coroutine()` and `compute()`.
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
 * Long-lived dedicated worker with bidirectional messaging.
 *
 * `ActorRef` represents a single worker instance. Call `start(data)` to begin
 * execution, `send(payload)` to push messages into the worker's mailbox, and
 * `finalize()` to terminate the worker when done.
 *
 * Unlike `Coroutine`, an actor is not pool-based; it owns exactly one worker.
 */
export interface ActorRef<T = any, R = any, FromMain = any, ToMain = any> {
  /** `true` while the worker has an active task. */
  readonly running: boolean;

  /** Starts the worker task with the given input data. */
  start(data: T): Promise<R>;

  /** Sends a one-way message to the active worker task. */
  send(payload: FromMain): void;

  /** Stops the worker and rejects the pending `start()` promise. */
  stop(reason?: unknown): void;

  /** Terminates the worker and releases resources. */
  finalize(): Promise<void>;

  /** Subscribes to one-way messages sent from the worker via `utils.main.send()`. */
  onMessage(handler: (payload: ToMain) => void): () => void;
}
