import { createSubscription, isPromiseLike, type MaybePromise, type Subscription } from "../atoms";
import type { AtomBase } from "../atoms/atom";
import { pipe as pipeSource } from "../atoms/pipe";

function isAtomLike(value: unknown): value is AtomBase<any> {
  return value != null && (value as any).type === "atom";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<any> {
  return value != null && typeof (value as any)[Symbol.asyncIterator] === "function";
}

function isIterable(value: unknown): value is Iterable<any> {
  return value != null && typeof (value as any)[Symbol.iterator] === "function";
}

/**
 * Creates a reusable atom that replays a resolved iterable to every subscriber.
 *
 * Unlike a cold `flow()` atom, this atom does not dispose after a single
 * consumption. It resolves the input once and then emits the same sequence to
 * each new subscriber or iterator, which matches the expected semantics of
 * {@link fromAny}.
 */
function createIterableAtom<R>(value: any): AtomBase<R> {
  let disposed = false;
  let resolved = false;
  let items: R[] = [];
  let current: R | undefined;
  let error: any;
  let pending: Promise<void> | undefined;

  const subs = new Set<(value: R) => MaybePromise>();

  const notify = (value: R) => {
    current = value;
    for (const cb of Array.from(subs)) {
      try {
        cb(value);
      } catch {
        // ignore user callback errors
      }
    }
  };

  const resolve = async () => {
    if (resolved) return;
    if (pending) return pending;

    pending = (async () => {
      try {
        const resolvedValue = isPromiseLike(value) ? await value : value;
        const candidate = resolvedValue as any;

        if (Array.isArray(resolvedValue)) {
          const collected: R[] = [];
          for (const item of resolvedValue) {
            collected.push(isPromiseLike(item) ? await item : item);
          }
          items = collected;
        } else if (candidate != null && isAsyncIterable(resolvedValue) && typeof resolvedValue !== "string") {
          const collected: R[] = [];
          for await (const item of resolvedValue as AsyncIterable<R>) {
            collected.push(item);
          }
          items = collected;
        } else if (candidate != null && isIterable(resolvedValue) && typeof resolvedValue !== "string") {
          const collected: R[] = [];
          for (const item of resolvedValue as Iterable<R>) {
            collected.push(isPromiseLike(item) ? await item : item);
          }
          items = collected;
        } else {
          items = [resolvedValue as R];
        }

        resolved = true;
        for (const item of items) {
          notify(item);
        }
      } catch (err) {
        error = err;
        resolved = true;
      }
    })();

    return pending;
  };

  const instance: AtomBase<R> = {
    type: "atom",

    get disposed() {
      return disposed;
    },

    get value() {
      if (disposed) throw new Error("Atom has been disposed");
      return current as R;
    },

    get safeValue() {
      return current as R;
    },

    get prior() {
      return current as R;
    },

    subscribe(callback?: (value: R) => MaybePromise): Subscription {
      if (disposed) {
        return createSubscription(() => {});
      }

      if (callback) {
        subs.add(callback);
      }

      void resolve().then(() => {
        if (callback && !disposed) {
          for (const item of items) {
            try {
              callback(item);
            } catch {
              // ignore user callback errors
            }
          }
        }
      });

      return createSubscription(() => {
        if (callback) {
          subs.delete(callback);
        }
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      subs.clear();
    },

    pipe(...ops: any[]) {
      return pipeSource(this, ...ops);
    },

    [Symbol.asyncIterator](): AsyncIterator<R> {
      let index = 0;
      let done = false;

      return {
        async next(): Promise<IteratorResult<R>> {
          await resolve();
          if (error) throw error;
          if (done) return { value: undefined as any, done: true };
          if (index < items.length) {
            return { value: items[index++], done: false };
          }
          done = true;
          return { value: undefined as any, done: true };
        },
      } as AsyncIterator<R>;
    },
  };

  return instance;
}

/**
 * Converts various value types into an atom.
 *
 * This function normalizes different input types into a consistent atom shape:
 * - Atoms are returned as-is
 * - Promises, arrays, iterables, and async iterables are wrapped in a reusable atom
 * - Single values are emitted as-is
 *
 * @template R The type of values emitted by the resulting atom.
 * @param value The input value to convert.
 * @returns An {@link AtomBase<R>} that emits the normalized values.
 */
export function fromAny<R = any>(
  value: AtomBase<R> | MaybePromise<R> | Array<R> | Iterable<R> | AsyncIterable<R>
): AtomBase<R> {
  if (isAtomLike(value)) {
    return value;
  }

  return createIterableAtom<R>(value);
}
