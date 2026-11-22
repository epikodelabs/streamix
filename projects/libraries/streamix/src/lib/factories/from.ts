import { flow, isPromiseLike, iterate, PipeInput, toAsyncIterable, type MaybePromise } from "../atoms";
import type { Readable } from "../atoms/atom";
import { normalizeError } from "../atoms";
import { getProducerCompletion } from "../atoms/delivery";
import { isAtomLike, isAsyncIterable, isIterable } from "../utils/helpers";
import type { SourceCapabilities, SyncPoll } from "../utils/source-protocol";


/**
 * Normalizes any supported input into a `Readable` using the runtime's atom and
 * flow primitives.
 */
export function from<R = any>(
  value: MaybePromise<PipeInput<R>> | ((signal?: AbortSignal) => MaybePromise<R>)
): Readable<R> {
  if (isAtomLike(value)) {
    return value;
  }

  if (typeof value === 'function') {
    return flow<R>(async function* (signal?: AbortSignal) {
      try {
        const result = await (value as (signal?: AbortSignal) => MaybePromise<R>)(signal);
        yield* toAsyncIterable(result as PipeInput<R>);
      } catch (err) {
        throw normalizeError(err);
      }
    });
  }

  // We mirror the original's internal state array to handle the replay behavior
  const items: R[] = [];
  let resolved = false;
  let error: any = undefined;
  let pendingResolution: Promise<void> | undefined;
  let asyncSource: AsyncIterable<R> | undefined;

  const resolveItems = async () => {
    if (resolved) return;
    if (pendingResolution) return pendingResolution;

    pendingResolution = (async () => {
      try {
        const resolvedValue = isPromiseLike(value) ? await value : value;
        const candidate = resolvedValue as any;

        if (Array.isArray(resolvedValue)) {
          for (const item of resolvedValue) {
            items.push(isPromiseLike(item) ? await item : item);
          }
        } else if (candidate != null && isAsyncIterable(resolvedValue) && typeof resolvedValue !== "string") {
          asyncSource = resolvedValue as AsyncIterable<R>;
        } else if (candidate != null && isIterable(resolvedValue) && typeof resolvedValue !== "string") {
          for (const item of resolvedValue as Iterable<R>) {
            items.push(isPromiseLike(item) ? await item : item);
          }
        } else {
          items.push(resolvedValue as R);
        }
        resolved = true;
      } catch (err) {
        error = normalizeError(err);
        resolved = true;
        throw error;
      }
    })();

    return pendingResolution;
  };

  // Build an asynchronous generator stream that flow() can wrap.
  // This executes the resolution once, then plays/replays the item array sequentially.
  const streamProvider = async function* (_signal?: AbortSignal) {
    await resolveItems();
    if (error) throw error;
    if (asyncSource) {
      yield* asyncSource;
      return;
    }
    for (const item of items) {
      yield item;
    }
  };

  // Use the native flow wrapper to inherit dependency tracking and scope mechanics
  const innerFlow = flow<R>(streamProvider);

  // Overwrite Symbol.asyncIterator to guarantee replay arrays work identically to the original test requirements
  innerFlow[Symbol.asyncIterator] = function (): AsyncIterator<R> {
    let started = false;
    let completedIterator: (AsyncIterableIterator<R> & SourceCapabilities<R>) | undefined;
    const selectCompletedIterator = () => {
      if (!started) {
        started = true;
        if (getProducerCompletion(innerFlow)?.completed) completedIterator = iterate(innerFlow);
      }
      return completedIterator;
    };
    let index = 0;
    let done = false;
    let asyncIterator: AsyncIterator<R> | undefined;
    let resolution: Promise<void> | undefined;
    let closing: Promise<void> | undefined;
    const finished: IteratorReturnResult<undefined> = { value: undefined, done: true };

    const resolveSynchronousArray = (): boolean => {
      if (resolved) return !error && !asyncSource;
      if (!Array.isArray(value) || value.some(isPromiseLike)) return false;

      items.push(...value as R[]);
      resolved = true;
      pendingResolution = Promise.resolve();
      return true;
    };

    const iterator: AsyncIterator<R> & SourceCapabilities<R> = {
      async next(): Promise<IteratorResult<R>> {
        if (done) return finished;
        const completed = selectCompletedIterator();
        if (completed) return completed.next();
        try {
          resolution ??= resolveItems();
          await resolution;
          if (done) return finished;
          if (error) throw error;
          if (asyncSource) {
            asyncIterator ??= asyncSource[Symbol.asyncIterator]();
            if (done) return finished;
            const result = await asyncIterator.next();
            if (done) return finished;
            if (result.done) done = true;
            return result;
          }
          if (index < items.length) return { value: items[index++], done: false };
          done = true;
          return finished;
        } catch (error) {
          if (done) return finished;
          throw error;
        }
      },
      pollSync(): SyncPoll<R> {
        const completedResult: SyncPoll<R> = {
          status: "available",
          result: { value: undefined as any, done: true }
        };
        if (done) return completedResult;
        const completed = selectCompletedIterator();
        if (completed) return completed.pollSync?.() ?? { status: "unavailable" };
        // A synchronous array is pulled lazily by index here: items are
        // produced on demand, not held in a buffer (see `hasBufferedEvents`).
        if (!resolveSynchronousArray()) return { status: "unavailable" };
        if (done) return completedResult;
        if (index < items.length) {
          return { status: "available", result: { value: items[index++], done: false } };
        }
        done = true;
        return completedResult;
      },
      hasBufferedEvents(): boolean {
        if (completedIterator) return completedIterator.hasBufferedEvents?.() ?? false;
        // This flag means values are already buffered by the iterator, not
        // merely that a synchronous iterable *could* produce another value.
        // `pollSync()` is the capability probe used by the coordinator for
        // synchronous sequences. Treating all remaining iterable items as
        // backlog breaks gating operators such as skipUntil.
        return false;
      },
      isTerminal(): boolean {
        if (completedIterator) return completedIterator.isTerminal?.() ?? false;
        return done;
      },
      async return(returnValue?: any) {
        done = true;
        closing ??= Promise.resolve().then(async () => {
          if (completedIterator) {
            await completedIterator.return?.();
          } else {
            // A pull may already own an unresolved input. Close any async
            // child it produces without issuing a pull after cancellation.
            if (resolution && isPromiseLike(value)) await resolution.catch(() => {});
            if (resolution && asyncSource) asyncIterator ??= asyncSource[Symbol.asyncIterator]();
            await asyncIterator?.return?.();
          }
        });
        await closing;
        return { value: completedIterator ? undefined : returnValue, done: true };
      },
    };

    return iterator;
  };

  return innerFlow;
}
