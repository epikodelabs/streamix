import {
  buildWorkerScript,
  createCoroutineOperator,
  type Coroutine,
  type WorkerPoolConfig
} from "./shared";

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
export function coroutine(config: CoroutineConfig): <T, R>(main: CoroutineTask<T, R>, ...functions: Function[]) => Coroutine<T, R>;
/**
 * Creates a coroutine directly from a task function and optional helpers.
 */
export function coroutine<T, R>(main: CoroutineTask<T, R>, ...functions: Function[]): Coroutine<T, R>;
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
): Coroutine<T, R> | ((main: CoroutineTask<T, R>, ...functions: Function[]) => Coroutine<T, R>) {
  const implementCoroutine = (
    config: CoroutineConfig | undefined,
    main: CoroutineTask<T, R>,
    functions: Function[]
  ): Coroutine<T, R> =>
    createCoroutineOperator<T, R>({
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

  if (typeof arg1 === "function") {
    return implementCoroutine({}, arg1 as CoroutineTask<T, R>, rest);
  }

  return (main: CoroutineTask<T, R>, ...functions: Function[]) => implementCoroutine(arg1, main, functions);
}

export type { Coroutine } from "./shared";
