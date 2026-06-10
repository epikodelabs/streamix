import { createOperator, isPromiseLike, type MaybePromise, type Operator } from '../abstractions';

interface Subscriber<T> {
  push(value: T): void;
  error(err: unknown): void;
  complete(): void;
}

/**
 * Creates a stream operator that shares a single subscription to the source stream
 * and replays a specified number of past values to new subscribers.
 *
 * This operator multicasts the source stream, ensuring that multiple downstream
 * consumers can receive values from a single source connection. It uses an internal
 * ring buffer to cache the most recent values. When a new consumer subscribes,
 * it immediately receives these cached values before receiving new ones.
 *
 * This is useful for:
 * - Preventing redundant execution of a source stream (e.g., a network request).
 * - Providing a "state history" to late subscribers.
 *
 * @template T The type of the values in the stream.
 * @param bufferSize The number of last values to replay to new subscribers. Defaults to `Infinity`.
 *                   Can be a Promise that resolves to a number.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export function shareReplay<T = any>(bufferSize: MaybePromise<number> = Infinity) {
  // Shared state — created once across all subscribers
  let started = false;
  let done = false;
  let error: unknown = undefined;
  let hasError = false;
  let buffer: T[] = [];
  let resolvedSize = Infinity;
  const subscribers = new Set<Subscriber<T>>();

  function addToBuffer(value: T) {
    buffer.push(value);
    if (isFinite(resolvedSize) && buffer.length > resolvedSize) {
      buffer.shift();
    }
  }

  function startPump(source: AsyncIterator<T>) {
    if (started) return;
    started = true;

    (async () => {
      try {
        resolvedSize = isPromiseLike(bufferSize) ? await bufferSize : bufferSize;
        if (resolvedSize < 0) {
          throw new RangeError('Buffer size must be a non-negative number.');
        }

        while (true) {
          const result = await source.next();
          if (result.done) break;

          addToBuffer(result.value);
          for (const sub of subscribers) {
            sub.push(result.value);
          }
        }

        done = true;
        for (const sub of subscribers) sub.complete();
      } catch (err) {
        hasError = true;
        error = err;
        for (const sub of subscribers) sub.error(err);
      }
    })();
  }

  return createOperator<T, T>('shareReplay', function (this: Operator, source) {
    // Start the shared pump on first subscription; discard extra source iterators
    if (!started) {
      startPump(source);
    } else {
      source.return?.().catch(() => {});
    }

    // Return an async iterator for this specific subscriber
    let resolve: ((value: IteratorResult<T>) => void) | null = null;
    const queue: Array<IteratorResult<T> | { error: unknown }> = [];
    let closed = false;

    function enqueue(item: IteratorResult<T> | { error: unknown }) {
      if (closed) return;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r(item as IteratorResult<T>);
      } else {
        queue.push(item);
      }
    }

    const sub: Subscriber<T> = {
      push(value) { enqueue({ value, done: false }); },
      error(err) { enqueue({ error: err } as any); },
      complete() { enqueue({ value: undefined as any, done: true }); },
    };

    subscribers.add(sub);

    // Replay buffered values immediately (synchronously into the queue)
    // These are replayed before the subscriber starts pulling
    const snapshot = buffer.slice();

    // If the source already finished/errored before this subscriber arrived,
    // pre-fill the queue with snapshot + terminal signal
    for (const v of snapshot) {
      queue.push({ value: v, done: false });
    }
    if (hasError && snapshot.length === buffer.length) {
      queue.push({ error } as any);
    } else if (done && snapshot.length === buffer.length) {
      queue.push({ value: undefined as any, done: true });
    }

    return {
      [Symbol.asyncIterator]() { return this; },

      next(): Promise<IteratorResult<T>> {
        if (closed) return Promise.resolve({ value: undefined as any, done: true });

        if (queue.length > 0) {
          const item = queue.shift()!;
          if ('error' in item) {
            closed = true;
            subscribers.delete(sub);
            return Promise.reject((item as any).error);
          }
          if ((item as IteratorResult<T>).done) {
            closed = true;
            subscribers.delete(sub);
          }
          return Promise.resolve(item as IteratorResult<T>);
        }

        return new Promise<IteratorResult<T>>((res, rej) => {
          resolve = (item) => {
            if ('error' in (item as any)) {
              closed = true;
              subscribers.delete(sub);
              rej((item as any).error);
            } else {
              if ((item as IteratorResult<T>).done) {
                closed = true;
                subscribers.delete(sub);
              }
              res(item);
            }
          };
        });
      },

      return(): Promise<IteratorResult<T>> {
        closed = true;
        subscribers.delete(sub);
        resolve?.({ value: undefined as any, done: true });
        resolve = null;
        return Promise.resolve({ value: undefined as any, done: true });
      },
    };
  });
}