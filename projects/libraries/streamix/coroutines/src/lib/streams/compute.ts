import { createStream, isPromiseLike, type MaybePromise, type Stream } from "@epikodelabs/streamix";
import type { TaskRunner } from "../worker/types";

/**
 * Runs a single coroutine-style task and emits exactly one result.
 */
export function compute<T = any, R = any>(
  task: Pick<TaskRunner<T, R>, "processTask">,
  params: MaybePromise<T>
): Stream<R> {
  return createStream<R>("compute", async function* () {
    const resolvedParams = isPromiseLike(params) ? await params : params;
    const result = await task.processTask(resolvedParams);
    yield result;
  });
}
