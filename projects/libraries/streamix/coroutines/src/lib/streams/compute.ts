import { createStream, isPromiseLike, type MaybePromise, type Stream } from "@epikodelabs/streamix";
import { createTaskPool } from "../worker/pool";
import { buildWorkerScript } from "../worker/script";
import type { WorkerScript } from "../worker/types";

const buildCoroutineWorkerRuntime = (): string =>
  `onmessage = async (event) => {
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
 * Creates a single-task stream backed by a SIMD worker pool.
 *
 * A dedicated pool is created for the given script, the task is executed
 * with the provided parameters, and the pool is finalized when the stream
 * completes.
 */
export function compute<T = any, R = any>(
  script: WorkerScript<T, R>,
  params: MaybePromise<T>
): Stream<R> {
  return createStream<R>("compute", async function* () {
    const pool = createTaskPool<T, R>({
      name: "compute",
      config: script.helpers ? { helpers: script.helpers } : undefined,
      main: script.main,
      functions: script.functions || [],
      generateWorkerScript: (task, dependencies, workerConfig) =>
        buildWorkerScript({
          helpers: workerConfig?.helpers,
          main: task,
          functions: dependencies,
          runtime: buildCoroutineWorkerRuntime(),
        }),
    });

    const resolvedParams = isPromiseLike(params) ? await params : params;
    const result = await pool.processTask(resolvedParams);
    yield result;
    await pool.finalize();
  });
}
