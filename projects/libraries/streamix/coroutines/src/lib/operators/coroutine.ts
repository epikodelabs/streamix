import { createOperator, DONE, NEXT, type Operator } from "@epikodelabs/streamix";
import { createTaskPool } from "../worker/pool";
import { buildWorkerScript } from "../worker/script";
import type { Coroutine, WorkerScript } from "../worker/types";

/**
 * Task function executed inside a worker without actor utilities.
 */
export type CoroutineTask<T = any, R = any> = (data: T) => Promise<R> | R;

/**
 * Configuration for plain one-way coroutine workers.
 */
export type CoroutineConfig = {
  helpers?: string[];
};

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

function createCoroutineImpl<T, R>(
  main: CoroutineTask<T, R>,
  functions: Function[],
  helpers: string[]
): Coroutine<T, R> & WorkerScript<T, R> {
  const pool = createTaskPool<T, R>({
    name: "coroutine",
    config: helpers.length > 0 ? { helpers } : undefined,
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

  return {
    ...operator,
    async processTask(data: T) {
      return pool.processTask(data);
    },
    async finalize() {
      return pool.finalize();
    },
    code: main.toString(),
    deps: functions.map((f) => f.toString()),
    helpers,
    main,
    functions,
  } as Coroutine<T, R> & WorkerScript<T, R>;
}

/**
 * Creates a SIMD coroutine — one task baked into the worker blob.
 *
 * The returned `Coroutine` can be used with `.pipe()` in stream pipelines
 * or called directly via `.processTask()`. Call `.finalize()` when done
 * to terminate the underlying worker pool.
 */
export function coroutine<T, R>(config: CoroutineConfig): (main: CoroutineTask<T, R>, ...functions: Function[]) => Coroutine<T, R> & WorkerScript<T, R>;
export function coroutine<T, R>(main: CoroutineTask<T, R>, ...functions: Function[]): Coroutine<T, R> & WorkerScript<T, R>;
export function coroutine<T, R>(
  arg1: CoroutineConfig | CoroutineTask<T, R>,
  ...rest: Function[]
): Coroutine<T, R> & WorkerScript<T, R> | ((main: CoroutineTask<T, R>, ...functions: Function[]) => Coroutine<T, R> & WorkerScript<T, R>) {
  if (typeof arg1 === "function") {
    return createCoroutineImpl(arg1, rest, []);
  }

  const helpers = arg1?.helpers || [];

  return (main: CoroutineTask<T, R>, ...functions: Function[]) =>
    createCoroutineImpl(main, functions, helpers);
}
