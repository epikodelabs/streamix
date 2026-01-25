import { createOperator, isPromiseLike, type MaybePromise, type Operator } from '../abstractions';
import { eachValueFrom } from '../converters';
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
  const isSync = !isPromiseLike(bufferSize);
  
  if (isSync) {
    resolvedSize = bufferSize;
  }
  
  const connectSource = (source: AsyncIterator<T>) => {
    isConnected = true;
    (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (result.done) break;
          output!.next(result.value);
        }
      } catch (err) {
        output!.error(err);
      } finally {
        if (output && !output.completed()) output.complete();
      }
    })();
  };

  return createOperator<T, T>('shareReplay', function (this: Operator, source) {
    // Short path: plain value, return synchronously
    if (isSync) {
      if (!output) output = createReplaySubject<T>(resolvedSize!);
      if (!isConnected) connectSource(source);
      else if (typeof source.return === "function") {
        Promise.resolve(source.return()).catch(() => {});
      }
      return eachValueFrom(output);
    }

    // Long path: Promise, wrap in async generator
    return (async function* () {
      if (resolvedSize === undefined) {
        resolvedSize = await bufferSize;
      }
      if (!output) output = createReplaySubject<T>(resolvedSize);
      if (!isConnected) connectSource(source);
      else if (typeof source.return === "function") {
        Promise.resolve(source.return()).catch(() => {});
      }
      yield* eachValueFrom(output);
    })();
  });
}
