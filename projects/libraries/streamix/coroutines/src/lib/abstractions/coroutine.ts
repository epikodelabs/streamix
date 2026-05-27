import { createTaskRunner } from "../worker/runner";
import { buildCoroutineWorkerRuntime } from "../worker/runtimes";
import { buildWorkerScript } from "../worker/script";
import type { Coroutine, CoroutineScript } from "../worker/types";

/**
 * Task function executed inside a worker without actor utilities.
 */
export type CoroutineTask<T = any, R = any> = (data: T) => Promise<R> | R;

/**
 * Configuration for plain one-way coroutine workers.
 */
export type CoroutineConfig = {
  /** Raw helper snippets injected into the worker before task code. */
  helpers?: string[];
};

function createCoroutineImpl<T, R>(
  main: CoroutineTask<T, R>,
  functions: Function[],
  helpers: string[]
): Coroutine<T, R> & CoroutineScript<T, R> {
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
  } as Coroutine<T, R> & CoroutineScript<T, R>;
}

/**
 * Creates a reusable coroutine task runner with its worker script baked once.
 *
 * A coroutine owns one dedicated worker, reuses it across calls, and queues
 * `processTask()` submissions on that worker. The returned `Coroutine` can be
 * used with `.pipe()` in stream pipelines or called directly. Call
 * `.finalize()` when done to terminate the underlying worker.
 */
export function coroutine<T, R>(config: CoroutineConfig): (main: CoroutineTask<T, R>, ...functions: Function[]) => Coroutine<T, R> & CoroutineScript<T, R>;
export function coroutine<T, R>(main: CoroutineTask<T, R>, ...functions: Function[]): Coroutine<T, R> & CoroutineScript<T, R>;
export function coroutine<T, R>(
  arg1: CoroutineConfig | CoroutineTask<T, R>,
  ...rest: Function[]
): Coroutine<T, R> & CoroutineScript<T, R> | ((main: CoroutineTask<T, R>, ...functions: Function[]) => Coroutine<T, R> & CoroutineScript<T, R>) {
  if (typeof arg1 === "function") {
    return createCoroutineImpl(arg1, rest, []);
  }

  const helpers = arg1?.helpers || [];

  return (main: CoroutineTask<T, R>, ...functions: Function[]) =>
    createCoroutineImpl(main, functions, helpers);
}

export type { CoroutineScript } from "../worker/types";
