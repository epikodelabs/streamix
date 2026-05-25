import { createStream, isPromiseLike, type MaybePromise, type Stream } from "@epikodelabs/streamix";
import { coroutine } from "../abstractions/coroutine";
import type { WorkerScript } from "../worker/types";

/**
 * Creates a single-task stream backed by a SIMD worker pool.
 *
 * A dedicated coroutine is created for the given script, the task is executed
 * with the provided parameters, and the pool is finalized when the stream
 * completes.
 */
export function compute<T = any, R = any>(
  script: WorkerScript<T, R>,
  params: MaybePromise<T>
): Stream<R> {
  return createStream<R>("compute", async function* () {
    const worker = coroutine<T, R>(script.main, ...(script.functions || []));
    const resolvedParams = isPromiseLike(params) ? await params : params;
    const result = await worker.processTask(resolvedParams);
    yield result;
    await worker.finalize();
  });
}
