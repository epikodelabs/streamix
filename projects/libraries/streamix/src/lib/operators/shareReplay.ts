import { createOperator, DONE, isPromiseLike, type MaybePromise, type Operator, type Subscription } from "../atoms";
import { atom } from '../atoms/atom';

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
 *                   Can be a Promise that resolves to a number.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export function shareReplay<T = any>(bufferSize: MaybePromise<number> = Infinity) {
  let isConnected = false;
  let resolvedSize: number | undefined;
  let sourceIterator: AsyncIterator<T> | null = null;
  let subscriberCount = 0;

  const replay: T[] = [];
  let replayHead = 0;

  let live = atom<T>();
  let completed = false;
  let errorValue: any;

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

  const disconnect = () => {
    if (sourceIterator) {
      const it = sourceIterator;
      sourceIterator = null;
      isConnected = false;
      void it.return?.().catch(() => {});
    }
  };

  const connectSource = (source: AsyncIterator<T>) => {
    sourceIterator = source;
    isConnected = true;
    void (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (result.done) break;
          pushReplay(result.value);
          live.next(result.value);
        }
      } catch (err) {
        errorValue = err;
        live.error(err);
        return;
      } finally {
        sourceIterator = null;
        completed = true;
        live.dispose();
      }
    })();
  };

  return createOperator<T, T>('shareReplay', function (this: Operator, source) {
    let initialized = false;
    let replayIndex = 0;
    let liveSub: Subscription | null = null;
    let liveCompletionHandler: (() => void) | null = null;
    let done = false;
    let pendingResolve: ((r: IteratorResult<T>) => void) | null = null;
    let pendingReject: ((e: any) => void) | null = null;

    const ensureConnected = async () => {
      if (initialized) return;
      initialized = true;
      if (resolvedSize === undefined) {
        resolvedSize = isPromiseLike(bufferSize) ? await bufferSize : bufferSize;
      }
      if (!isConnected) connectSource(source);
      else if (typeof source.return === 'function') {
        await Promise.resolve(source.return()).catch(() => {});
      }
    };

    const cleanup = () => {
      subscriberCount = Math.max(0, subscriberCount - 1);
      if (subscriberCount === 0 && isConnected) {
        disconnect();
      }
      if (liveSub) {
        liveSub.unsubscribe();
        liveSub = null;
      }
      if (liveCompletionHandler) {
        (live as any)._onDispose.delete(liveCompletionHandler);
        liveCompletionHandler = null;
      }
      done = true;
      if (pendingResolve) {
        pendingResolve(DONE);
        pendingResolve = pendingReject = null;
      }
    };

    subscriberCount++;

    const iterator: AsyncIterator<T> = {
      async next() {
        if (done) return DONE;

        await ensureConnected();

        if (errorValue !== undefined) {
          throw errorValue;
        }

        if (replayIndex < replay.length) {
          return { value: replay[replayIndex++], done: false };
        }

        if (completed) {
          done = true;
          return DONE;
        }

        if (!liveSub) {
          liveSub = live.subscribe((value: T) => {
            if (done) return;
            if (pendingResolve) {
              const resolve = pendingResolve;
              pendingResolve = pendingReject = null;
              resolve({ value, done: false });
            }
          });

          liveCompletionHandler = () => {
            const err = (live as any)._error;
            if (err !== undefined) {
              errorValue = err;
              if (pendingReject) {
                const reject = pendingReject;
                pendingResolve = pendingReject = null;
                reject(err);
              }
            } else {
              completed = true;
              if (pendingResolve) {
                const resolve = pendingResolve;
                pendingResolve = pendingReject = null;
                resolve(DONE);
              }
            }
          };
          (live as any)._onDispose.add(liveCompletionHandler);
        }

        return new Promise<IteratorResult<T>>((resolve, reject) => {
          pendingResolve = resolve;
          pendingReject = reject;
        });
      },

      async return(value?: any) {
        cleanup();
        return { value, done: true } as IteratorResult<T>;
      },

      async throw(err: any) {
        cleanup();
        throw err;
      }
    };

    return iterator;
  });
}
