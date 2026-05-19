import { createStream, isPromiseLike, type MaybePromise, type Stream } from "@epikodelabs/streamix";

/**
 * Minimal contract needed by `compute(...)`.
 */
export type ComputableTask<T = any, R = any> = {
  processTask: (data: T) => Promise<R>;
};

/**
 * Runs a single coroutine-style task and emits exactly one result.
 */
export function compute<T = any, R = any>(
  task: ComputableTask<T, R>,
  params: MaybePromise<T>
): Stream<R> {
  return createStream<R>("compute", async function* () {
    const resolvedParams = isPromiseLike(params) ? await params : params;
    const result = await task.processTask(resolvedParams);
    yield result;
  });
}


