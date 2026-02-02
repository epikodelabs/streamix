import { createStream, isPromiseLike, type MaybePromise, type Stream } from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";

/**
 * Input accepted by {@link concat}.
 *
 * Values (including promises) are converted to a Stream via `fromAny(...)`.
 */
type ConcatSource<T> = Stream<T> | MaybePromise<T>;

/**
 * Concatenates sources sequentially.
 *
 * `concat(a, b, c)` subscribes to `a`, yields all its values, waits for it to
 * complete, then moves to `b`, then `c`.
 *
 * - If any source errors, the concatenated stream errors and remaining sources
 *   are not processed.
 * - Sources may be Streams, raw values, arrays/iterables, or Promises of those.
 *
 * @template T Value type.
 * @param sources Streams or values (including promises) to concatenate.
 * @returns A new stream that emits values from all input sources in order.
 *
 * @example
 * const s = concat(from([1, 2]), from([3]), 4);
 * // emits: 1, 2, 3, 4
 */

export function concat<T = any>(...sources: ConcatSource<T>[]): Stream<T> {
  async function* generator() {
    const isPromiseSource = (value: ConcatSource<T>): value is Promise<any> =>
      isPromiseLike(value);
    const resolvedSources: Array<Stream<T> | Array<T> | T> = [];
    for (const source of sources) {
      resolvedSources.push(isPromiseSource(source) ? await source : source);
    }

    for (const source of resolvedSources) {
      const iterator = eachValueFrom(fromAny<T>(source));

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
