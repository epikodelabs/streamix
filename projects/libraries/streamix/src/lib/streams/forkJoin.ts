import { createStream, isPromiseLike, type MaybePromise, type Stream } from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";

/**
 * Waits for all sources to complete and emits an array of their last values.
 *
 * This is similar to RxJS `forkJoin`:
 * - Each source is consumed fully.
 * - The output emits exactly once (an array of the last value from each source)
 *   and then completes.
 * - If any source errors, the output errors.
 * - If any source completes without emitting a value, `forkJoin` errors.
 *
 * Sources may be Streams or plain values (including promises). Plain values are
 * converted to streams via `fromAny(...)`.
 *
 * @template T The type of the last values emitted by each stream.
 * @param sources Streams or values (including promises) to join.
 * @returns A stream that emits a single array of last values.
 *
 * @example
 * const s = forkJoin(from([1, 2]), from([10]));
 * // emits: [2, 10]
 */
export function forkJoin<T = any, R extends readonly unknown[] = any[]>(
  ...sources: { [K in keyof R]: Stream<R[K]> | MaybePromise<R[K]> }
): Stream<T[]>;

/**
 * Overload that accepts an array/tuple of sources.
 *
 * @template T
 * @template R
 * @param sources Tuple/array of sources.
 * @returns A stream that emits a single array of last values.
 */
export function forkJoin<T = any, R extends readonly unknown[] = any[]>(
  sources: { [K in keyof R]: Stream<R[K]> | MaybePromise<R[K]> }
): Stream<T[]>;

/**
 * Implementation signature.
 *
 * @internalRemarks
 * This implementation supports both `forkJoin(a, b, c)` and `forkJoin([a, b, c])`.
 */
export function forkJoin<T = any, R extends readonly unknown[] = any[]>(
  ...sources: R
): Stream<T[]> {
  async function* generator() {
    const normalizedSources = sources.length === 1 && Array.isArray(sources[0]) ? sources[0] : sources;
    const resolvedSources: Array<Stream<T> | Array<T> | T> = [];
    for (const source of normalizedSources) {
      resolvedSources.push(isPromiseLike(source) ? await source : source);
    }

    const results = new Array(resolvedSources.length);
    const hasValue = new Array(resolvedSources.length).fill(false);
    const resolvedIterators = resolvedSources.map((source) =>
      eachValueFrom(fromAny(source))
    );

    try {
      const promises = resolvedIterators.map(async (iterator, index) => {
        while (true) {
          const result = await iterator.next();
          if (result.done) break;
          hasValue[index] = true;
          results[index] = result.value;
        }

        if (!hasValue[index]) {
          throw new Error("forkJoin: one of the streams completed without emitting any value");
        }
      });

      await Promise.all(promises);
      yield results as T[];
    } finally {
      await Promise.all(
        resolvedIterators.map((iterator) =>
          iterator.return ? iterator.return(undefined).catch(() => {}) : Promise.resolve()
        )
      );
    }
  }

  return createStream<T[]>("forkJoin", generator);
}
