import { flow, type Stream, type MaybePromise } from './stream';

export type Task<T> = (signal: AbortSignal) => MaybePromise<T>;

export function fromTask<T>(task: Task<T>): Stream<T> {
  return flow<T>(async function* (signal) {
    yield await task(signal);
  });
}
