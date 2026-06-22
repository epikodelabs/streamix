import { flow, isPromiseLike, PipeInput, toAsyncIterable, type MaybePromise } from "../atoms";
import type { Atom } from "../atoms/atom";
import { normalizeError } from "../utils/helpers";

function isAtomLike(value: unknown): value is Atom<any> {
  return value != null && (value as any).type === "atom";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<any> {
  return value != null && typeof (value as any)[Symbol.asyncIterator] === "function";
}

function isIterable(value: unknown): value is Iterable<any> {
  return value != null && typeof (value as any)[Symbol.iterator] === "function";
}

/**
 * Normalizes any value type into an AtomBase using your system's native atom/flow primitives.
 */
export function from<R = any>(
  value: PipeInput<R> | ((signal?: AbortSignal) => MaybePromise<R>)
): Atom<R> {
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
          for await (const item of resolvedValue as AsyncIterable<R>) {
            items.push(item);
          }
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
    for (const item of items) {
      yield item;
    }
  };

  // Use the native flow wrapper to inherit dependency tracking and scope mechanics
  const innerFlow = flow<R>(streamProvider) as any;

  // Enhance the returned atom to support the original sequence replay semantics on direct subscription
  const originalSubscribe = innerFlow.subscribe.bind(innerFlow);
  innerFlow.subscribe = (callback?: (value: R) => MaybePromise) => {
    if (innerFlow.disposed) {
      if (!error) {
        for (const item of items) {
          try {
            callback?.(item);
          } catch {
            // ignore user callback errors
          }
        }
      }
      return { unsubscribe: () => {} };
    }

    // While the atom is still active, the upstream flow generator reads from the
    // cached `items` array and emits each value exactly once. We must not replay
    // manually here, or consumers like `iterate(atom)` would see every value twice.
    return originalSubscribe(callback);
  };

  // Overwrite Symbol.asyncIterator to guarantee replay arrays work identically to the original test requirements
  innerFlow[Symbol.asyncIterator] = function (): AsyncIterator<R> {
    let index = 0;
    let done = false;

    return {
      async next(): Promise<IteratorResult<R>> {
        await resolveItems();
        if (error) throw error;
        if (done) return { value: undefined as any, done: true };
        if (index < items.length) {
          return { value: items[index++], done: false };
        }
        done = true;
        return { value: undefined as any, done: true };
      },
    } as AsyncIterator<R>;
  };

  return innerFlow;
}