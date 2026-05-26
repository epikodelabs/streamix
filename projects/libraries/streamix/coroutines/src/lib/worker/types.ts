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
 * `Actor` is an opaque handle to a persistent behavior loop running in a
 * dedicated worker. Messaging is done through the `main` utility:
 * `main.send(actor, msg)`, `main.ask(actor, msg)`, `main.receive(actor, handler)`.
 *
 * Unlike `Coroutine`, an actor is not pool-based; it owns exactly one worker.
 */
export interface Actor<FromMain = any, ToMain = any, S = any> {
  /** `true` while the behavior loop is running. */
  readonly running: boolean;

  /** Stops the worker. */
  stop(reason?: unknown): void;

  /** Terminates the worker and releases resources. */
  finalize(): Promise<void>;
}
