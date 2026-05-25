import { buildWorkerScript } from "../worker/script";
import { buildCoroutineWorkerRuntime } from "../worker/runtimes";
import { createTaskRunner } from "../worker/runner";
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

function createCoroutineImpl<T, R>(
  main: CoroutineTask<T, R>,
  functions: Function[],
  helpers: string[]
): Coroutine<T, R> & WorkerScript<T, R> {
  const runner = createTaskRunner<T, R>({
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

  return {
    processTask: runner.processTask,
    finalize: runner.finalize,
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
