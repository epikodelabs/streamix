import { createStream, isPromiseLike, type MaybePromise, type Stream } from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";

/**
 * Creates a stream that subscribes to multiple streams in sequence.
 *
 * This operator will subscribe to the first stream and yield all of its
 * values. Once the first stream completes, it will then subscribe to the
 * second stream, and so on, until all streams have completed. The resulting
 * stream will complete only after the last source stream has completed.
 *
 * If any of the source streams errors, the concatenated stream will also error and
 * stop processing the remaining streams.
 *
 * @template T The type of the values in the streams.
 * @param sources Streams or values (including promises) to concatenate.
 * @returns {Stream<T>} A new stream that emits values from all input streams in sequence.
 */
export function concat<T = any, R extends readonly unknown[] = any[]>(
  ...sources: { [K in keyof R]: Stream<R[K]> | MaybePromise<R[K]> }
): Stream<T> {
  async function* generator() {
    const resolvedSources: Array<Stream<T> | Array<T> | T> = [];
    for (const source of sources) {
      resolvedSources.push(isPromiseLike(source) ? await source : source);
    }

    for (const source of resolvedSources) {
      const iterator = eachValueFrom(fromAny(source));

      try {
        for await (const value of iterator) {
          yield value;
        }
      } catch (error) {
        throw error;
      } finally {
        // Attempt to close iterator early on abort or completion
        if (iterator.return) {
          try {
            await iterator.return(undefined);
          } catch {
            // ignore
          }
        }
      }
    }
  }

  return createStream<T>("concat", generator);
}
