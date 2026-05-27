/**
 * Task descriptor ready to be baked into a worker blob.
 *
 * `main` and `functions` are the single source of truth.
 * String forms are derived on demand via `serializeScript()`.
 */
export interface CoroutineScript<T = any, R = any> {
  /** Raw worker-side snippets injected before the serialized functions. */
  helpers?: string[];
  /** Main task body executed inside the worker. */
  main: (data: T) => R | Promise<R>;
  /** Additional named helper functions serialized alongside `main`. */
  functions?: Function[];
}

/**
 * Base contract for anything that can process a task and be finalized.
 */
export interface TaskRunner<T = any, R = any> {
  /** Submits one value for worker-side processing. */
  processTask: (data: T) => Promise<R>;
  /** Terminates the underlying worker resources. */
  finalize: () => Promise<void>;
}

/**
 * Plain background-task runner backed by one dedicated worker.
 *
 * Created by `coroutine(mainTask)` and accepted by `compose(...)`.
 */
export interface Coroutine<T = any, R = T> extends TaskRunner<T, R> {}

/**
 * Long-lived stateful worker with bidirectional messaging.
 *
 * `Actor` is an opaque handle to a persistent behavior loop running in a
 * dedicated worker. Messaging is done through the `main` utility:
 * `main.outbox.send(actor, msg)`, `main.outbox.request(actor, msg)`,
 * `main.inbox.receive(actor, handler)`.
 *
 * Unlike `Coroutine`, an actor owns exactly one worker.
 */
export interface Actor {
  /** `true` while the behavior loop is running. */
  readonly running: boolean;

  /** Stops the worker. */
  stop(reason?: unknown): void;

  /** Terminates the worker and releases resources. */
  finalize(): Promise<void>;
}
