import { createOperator, DONE, isPromiseLike, type MaybePromise, type Operator } from '../abstractions';
import { createReplaySubject, type ReplaySubject } from '../subjects';

/**
 * Creates a stream operator that shares a single subscription to the source stream
 * and replays a specified number of past values to new subscribers.
 *
 * This operator multicasts the source stream, ensuring that multiple downstream
 * consumers can receive values from a single source connection. It uses an internal
 * `ReplaySubject` to cache the most recent values. When a new consumer subscribes,
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
  let isConnected = false;
  let output: ReplaySubject<T> | undefined;
  let resolvedSize: number | undefined;
  let sourceIterator: AsyncIterator<T> | null = null;
  let subscriberCount = 0;

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

          output!.next(result.value);
        }
      } catch (err) {
        output!.error(err);
      } finally {
        sourceIterator = null;
        if (output && !output.completed()) output.complete();
      }
    })();
  };

  return createOperator<T, T>('shareReplay', function (this: Operator, source) {
    let initialized = false;
    let outputIterator: AsyncIterator<T> | null = null;

    const ensureOutputIterator = async () => {
      if (initialized && outputIterator) {
        return outputIterator;
      }

      initialized = true;

      if (resolvedSize === undefined) {
        resolvedSize = isPromiseLike(bufferSize) ? await bufferSize : bufferSize;
      }
      if (!output) output = createReplaySubject<T>(resolvedSize);
      if (!isConnected) connectSource(source);
      else if (typeof source.return === "function") {
        await Promise.resolve(source.return()).catch(() => {});
      }
      if (!outputIterator) {
        outputIterator = output[Symbol.asyncIterator]();
      }
      return outputIterator;
    };

    subscriberCount++;
    void ensureOutputIterator();

    const iterator: AsyncIterator<T> = {
      async next() {
        const it = await ensureOutputIterator();
        return it.next();
      },

      async return(value?: any) {
        subscriberCount--;
        if (subscriberCount === 0 && isConnected) {
          disconnect();
        }
        const it = await ensureOutputIterator();
        return it.return ? it.return(value) : DONE;
      },

      async throw(err: any) {
        const it = await ensureOutputIterator();
        if (output && !output.completed()) output.error(err);
        if (it.throw) return it.throw(err);
        throw err;
      }
    };

    return iterator;
  });
}
