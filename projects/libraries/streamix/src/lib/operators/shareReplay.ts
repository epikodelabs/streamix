import { createOperator, DONE, type Operator } from "../atoms";
import { normalizeError } from "../atoms";

/**
 * Creates a stream operator that shares a single subscription to the source stream
 * and replays a specified number of past values to new subscribers.
 *
 * This operator multicasts the source stream, ensuring that multiple downstream
 * consumers can receive values from a single source connection. It uses an internal
 * atom and a bounded replay buffer so that late subscribers receive the most recent
 * values before continuing with live emissions.
 *
 * This is useful for:
 * - Preventing redundant execution of a source stream (e.g. a network request).
 * - Providing a "state history" to late subscribers.
 *
 * @template T The type of the values in the stream.
 * @param bufferSize The number of last values to replay to new subscribers. Defaults to `Infinity`.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export function shareReplay<T = any>(bufferSize: number = Infinity) {
  let isConnected = false;
  let resolvedSize: number | undefined;
  let sourceIterator: AsyncIterator<T> | null = null;
  let activeConnection: symbol | null = null;

  const replay: T[] = [];
  let replayHead = 0;

  let completed = false;
  let errorValue: any;

  type Subscriber = {
    done: boolean;
    queue: T[];
    pendingResolve: ((result: IteratorResult<T>) => void) | null;
    pendingReject: ((error: any) => void) | null;
  };

  const subscribers = new Set<Subscriber>();

  const pushReplay = (value: T) => {
    if (resolvedSize === undefined || resolvedSize === Infinity) {
      replay.push(value);
      return;
    }
    if (resolvedSize <= 0) return;
    if (replay.length < resolvedSize) {
      replay.push(value);
    } else {
      replay[replayHead] = value;
      replayHead = (replayHead + 1) % resolvedSize;
    }
  };

  const snapshotReplay = (): T[] => {
    if (resolvedSize === undefined || resolvedSize === Infinity) {
      return [...replay];
    }

    if (resolvedSize <= 0 || replay.length === 0) {
      return [];
    }

    if (replay.length < resolvedSize) {
      return [...replay];
    }

    return [...replay.slice(replayHead), ...replay.slice(0, replayHead)];
  };

  const broadcastValue = (value: T) => {
    for (const subscriber of subscribers) {
      if (subscriber.done) continue;

      if (subscriber.pendingResolve) {
        const resolve = subscriber.pendingResolve;
        subscriber.pendingResolve = subscriber.pendingReject = null;
        resolve({ value, done: false });
      } else {
        subscriber.queue.push(value);
      }
    }
  };

  const broadcastCompletion = () => {
    for (const subscriber of subscribers) {
      if (subscriber.done || subscriber.queue.length > 0 || !subscriber.pendingResolve) {
        continue;
      }

      const resolve = subscriber.pendingResolve;
      subscriber.pendingResolve = subscriber.pendingReject = null;
      resolve(DONE);
    }
  };

  const broadcastError = (error: any) => {
    for (const subscriber of subscribers) {
      if (subscriber.done || !subscriber.pendingReject) {
        continue;
      }

      const reject = subscriber.pendingReject;
      subscriber.pendingResolve = subscriber.pendingReject = null;
      reject(error);
    }
  };

  const disconnect = () => {
    if (sourceIterator) {
      const it = sourceIterator;
      sourceIterator = null;
      isConnected = false;
      activeConnection = null;
      void it.return?.().catch(() => {});
    }
  };

  const connectSource = (source: AsyncIterator<T>) => {
    const connection = Symbol("shareReplayConnection");
    sourceIterator = source;
    isConnected = true;
    activeConnection = connection;
    void (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (result.done) break;
          pushReplay(result.value);
          broadcastValue(result.value);
        }
      } catch (err) {
        errorValue = normalizeError(err);
        broadcastError(errorValue);
        return;
      } finally {
        if (activeConnection !== connection) {
          return;
        }

        sourceIterator = null;
        completed = true;
        isConnected = false;
        activeConnection = null;
        broadcastCompletion();
      }
    })();
  };

  return createOperator<T, T>('shareReplay', function (this: Operator, source) {
    let initialized = false;
    const subscriber: Subscriber = {
      done: false,
      queue: [],
      pendingResolve: null,
      pendingReject: null,
    };

    const ensureConnected = async () => {
      if (initialized) return;
      initialized = true;
      if (resolvedSize === undefined) {
        resolvedSize = bufferSize;
      }

      subscriber.queue.push(...snapshotReplay());
      subscribers.add(subscriber);

      if (!completed && errorValue === undefined && !isConnected) {
        connectSource(source);
      } else if (typeof source.return === 'function') {
        await Promise.resolve(source.return()).catch(() => {});
      }
    };

    const cleanup = () => {
      if (subscriber.done) return;

      subscriber.done = true;
      subscribers.delete(subscriber);

      if (subscribers.size === 0 && isConnected) {
        disconnect();
      }

      if (subscriber.pendingResolve) {
        subscriber.pendingResolve(DONE);
        subscriber.pendingResolve = subscriber.pendingReject = null;
      }
    };

    const iterator: AsyncIterator<T> = {
      async next() {
        if (subscriber.done) return DONE;

        await ensureConnected();

        if (subscriber.queue.length > 0) {
          return { value: subscriber.queue.shift()!, done: false };
        }

        if (errorValue !== undefined) {
          cleanup();
          throw errorValue;
        }

        if (completed) {
          cleanup();
          return DONE;
        }

        return new Promise<IteratorResult<T>>((resolve, reject) => {
          subscriber.pendingResolve = resolve;
          subscriber.pendingReject = reject;
        });
      },

      async return(value?: any) {
        cleanup();
        return { value, done: true } as IteratorResult<T>;
      },

      async throw(err: any) {
        cleanup();
        throw normalizeError(err);
      }
    };

    return iterator;
  });
}
