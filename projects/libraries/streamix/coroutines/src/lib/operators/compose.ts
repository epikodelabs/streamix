import { createOperator, DONE, NEXT, type Operator } from "@epikodelabs/streamix";
import { buildWorkerScript, createTaskPool } from "../worker";
import type { Coroutine, TaskRunner, WorkerScript } from "../worker/types";

function isWorkerScript(value: unknown): value is WorkerScript {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as WorkerScript).code === "string" &&
    Array.isArray((value as WorkerScript).deps)
  );
}

const buildCoroutineWorkerRuntime = (): string => `
onmessage = async (event) => {
  const { workerId, taskId, payload, type } = event.data;

  if (type !== 'task') {
    return;
  }

  try {
    const result = await __mainTask(payload);
    postMessage({ workerId, taskId, payload: result, type: 'response' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postMessage({ workerId, taskId, error: message, type: 'error' });
  }
};`;

/**
 * Merges multiple `WorkerScript`s into a single composed script suitable for
 * baking into a worker blob via `createTaskPool`.
 *
 * Each stage is wrapped in an IIFE so that dependency function names
 * and internal variables do not collide across stages.
 */
function mergeWorkerScripts(scripts: WorkerScript[]): {
  main: Function;
  helpers: string[];
  generateScript: (main: Function, helpers?: string[]) => string;
} {
  const helpers = Array.from(
    new Set(scripts.flatMap((s) => s.helpers || []))
  );

  const stageBodies = scripts
    .map((s, i) => {
      const depsSection = s.deps.length > 0 ? s.deps.join(";\n") + ";" : "";
      return `const __stage${i} = (() => {
${depsSection ? '  ' + depsSection.replace(/\n/g, '\n  ') + '\n' : ''}  return (${s.code});
})();`;
    })
    .reduce((acc, body, i) => `${acc}${i > 0 ? '\n\n' : ''}${body}`, '');

  const composedMain = new Function(
    "data",
    `
    let result = data;
    ${scripts.map((_, i) => `result = __stage${i}(result);`).reduce((acc, line, i) => `${acc}${i > 0 ? '\n    ' : ''}${line}`, '')}
    return result;
    `
  ) as (data: any) => any;

  const generateScript = (task: Function, taskHelpers?: string[]) => {
    const allHelpers = Array.from(
      new Set([...(taskHelpers || []), ...helpers])
    );
    return buildWorkerScript({
      helpers: [stageBodies, ...allHelpers],
      main: task,
      functions: [],
      runtime: buildCoroutineWorkerRuntime(),
    });
  };

  return { main: composedMain, helpers, generateScript };
}

/**
 * Chains multiple coroutines sequentially into a single `Coroutine`.
 *
 * `WorkerScript` inputs (created by `coroutine()`) are merged into one
 * worker script so the entire pipeline runs on a single worker per task.
 *
 * `TaskRunner` inputs are chained in the main thread after the worker
 * stage completes.
 */
export function compose<A, B>(...scripts: [WorkerScript<A, B>]): Coroutine<A, B>;
export function compose<A, B, C>(...scripts: [WorkerScript<A, B>, WorkerScript<B, C>]): Coroutine<A, C>;
export function compose<A, B, C, D>(...scripts: [WorkerScript<A, B>, WorkerScript<B, C>, WorkerScript<C, D>]): Coroutine<A, D>;
export function compose<T = any, R = any>(...scripts: Array<WorkerScript<any, any> | TaskRunner<any, any>>): Coroutine<T, R>;

export function compose<T = any, R = any>(
  ...scripts: Array<WorkerScript<any, any> | TaskRunner<any, any>>
): Coroutine<T, R> {
  const workerScripts: WorkerScript<any, any>[] = [];
  const taskRunners: TaskRunner<any, any>[] = [];

  for (const s of scripts) {
    if (isWorkerScript(s)) {
      workerScripts.push(s);
    } else if (s && typeof (s as TaskRunner).processTask === "function") {
      taskRunners.push(s as TaskRunner);
    }
  }

  let pool: ReturnType<typeof createTaskPool> | null = null;

  if (workerScripts.length > 0) {
    const merged = mergeWorkerScripts(workerScripts);
    pool = createTaskPool({
      name: "compose",
      config: merged.helpers.length > 0 ? { helpers: merged.helpers } : undefined,
      main: merged.main,
      functions: [],
      generateWorkerScript: (task, _dependencies, workerConfig) =>
        merged.generateScript(task, workerConfig?.helpers),
    });
  }

  const processTask = async (data: T): Promise<R> => {
    let result: any = data;

    if (pool) {
      result = await pool.processTask(result);
    }

    for (const runner of taskRunners) {
      result = await runner.processTask(result);
    }

    return result;
  };

  const finalize = async (): Promise<void> => {
    const errors: Error[] = [];

    if (pool) {
      try {
        await pool.finalize();
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }

    for (const runner of taskRunners) {
      try {
        await runner.finalize();
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }

    if (errors.length > 0) {
      throw errors[0];
    }
  };

  const operator = createOperator<T, R>("compose", function (this: Operator, source) {
    let completed = false;

    return {
      next: async () => {
        while (true) {
          if (completed) return DONE;

          const result = await source.next();
          if (result.done) {
            completed = true;
            await finalize();
            return DONE;
          }

          const taskResult = await processTask(result.value as T);
          return NEXT(taskResult);
        }
      },
      async return() {
        completed = true;
        await finalize();
        return DONE;
      },
      async throw(err) {
        completed = true;
        await finalize();
        throw err;
      }
    };
  });

  return {
    ...operator,
    processTask,
    finalize,
  } as Coroutine<T, R>;
}
