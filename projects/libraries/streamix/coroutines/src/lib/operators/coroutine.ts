import { createOperator, DONE, NEXT, type Operator } from "@epikodelabs/streamix";
import { createPool, type WorkerPoolConfig } from "../worker/pool";
import { buildWorkerScript } from "../worker/script";
import type { Coroutine, WorkerPool } from "../worker/types";

/**
 * Configuration for plain one-way coroutine workers.
 */
export type CoroutineConfig = WorkerPoolConfig;

/**
 * Task function executed inside a worker without actor utilities.
 */
export type CoroutineTask<T = any, R = any> = (data: T) => Promise<R> | R;

const buildCoroutineWorkerRuntime = (): string =>
  [
    "onmessage = async (event) => {",
    "  const { workerId, taskId, payload, type } = event.data;",
    "",
    "  if (type !== 'task') {",
    "    return;",
    "  }",
    "",
    "  try {",
    "    const result = await __mainTask(payload);",
    "    postMessage({ workerId, taskId, payload: result, type: 'response' });",
    "  } catch (error) {",
    "    const message = error instanceof Error ? error.message : String(error);",
    "    postMessage({ workerId, taskId, error: message, type: 'error' });",
    "  }",
    "};",
  ].join("\n");

/**
 * Creates a configured coroutine factory for plain background task execution.
 */
export function coroutine(config: CoroutineConfig): <T, R>(main: CoroutineTask<T, R>, ...functions: Function[]) => Coroutine<T, R> & WorkerPool<T, R>;
/**
 * Creates a coroutine directly from a task function and optional helpers.
 */
export function coroutine<T, R>(main: CoroutineTask<T, R>, ...functions: Function[]): Coroutine<T, R> & WorkerPool<T, R>;
/**
 * Creates a coroutine for plain background task execution.
 *
 * When called with a configuration object, returns a factory function that accepts
 * the task function and optional helpers. When called with a task function directly,
 * creates the coroutine immediately using default configuration.
 *
 * @template T The type of input data.
 * @template R The type of output data.
 * @param arg1 Either a `CoroutineConfig` or the main `CoroutineTask`.
 * @param rest Optional helper functions available inside the worker.
 * @returns A `Coroutine` instance or a factory that produces one.
 */
export function coroutine<T, R>(
  arg1: CoroutineConfig | CoroutineTask<T, R>,
  ...rest: Function[]
): (Coroutine<T, R> & WorkerPool<T, R>) | ((main: CoroutineTask<T, R>, ...functions: Function[]) => Coroutine<T, R> & WorkerPool<T, R>) {
  const implement = (
    config: CoroutineConfig | undefined,
    main: CoroutineTask<T, R>,
    functions: Function[]
  ): Coroutine<T, R> & WorkerPool<T, R> => {
    const pool = createPool<T, R>({
      name: "coroutine",
      config,
      main,
      functions,
      generateWorkerScript: (task, dependencies, workerConfig) =>
        buildWorkerScript({
          helpers: workerConfig?.helpers,
          main: task,
          functions: dependencies,
          runtime: buildCoroutineWorkerRuntime(),
        }),
    });

    const operator = createOperator<T, R>("coroutine", function (this: Operator, source) {
      let completed = false;

      return {
        next: async () => {
          while (true) {
            if (completed) return DONE;

            const result = await source.next();
            if (result.done) {
              completed = true;
              await pool.finalize();
              return DONE;
            }

            const taskResult = await pool.processTask(result.value as T);
            return NEXT(taskResult);
          }
        },
        async return() {
          completed = true;
          await pool.finalize();
          return DONE;
        },
        async throw(err) {
          completed = true;
          await pool.finalize();
          throw err;
        }
      };
    });

    return { ...operator, ...pool } as Coroutine<T, R> & WorkerPool<T, R>;
  };

  if (typeof arg1 === "function") {
    return implement({}, arg1 as CoroutineTask<T, R>, rest);
  }

  return (main: CoroutineTask<T, R>, ...functions: Function[]) => implement(arg1, main, functions);
}
