import { createStream, DROPPED, isPromiseLike, type Stream } from "../abstractions";
import { fromAny } from "../converters";
import { createAsyncCoordinator } from "../utils";

const RAW = Symbol.for("streamix.rawAsyncIterator");

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
  ...sources: { [K in keyof R]: Stream<R[K]> | Promise<R[K]> }
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
  sources: { [K in keyof R]: Stream<R[K]> | Promise<R[K]> }
): Stream<T[]>;

/**
 * Implementation signature.
 *
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
    const resolvedIterators = resolvedSources.map((source) => {
      const stream = fromAny(source);
      return ((stream as any)[RAW]?.() ?? stream[Symbol.asyncIterator]()) as AsyncIterator<T>;
    });
    const coordinator = createAsyncCoordinator(resolvedIterators);
    let completedCount = 0;

    try {
      while (completedCount < resolvedIterators.length) {
        const next = await coordinator.next();
        if (next.done) break;

        const event = next.value;
        if (event.type === "error") {
          throw event.error;
        }

        if (event.type === "value") {
          if (event.dropped) {
            yield DROPPED(event.value) as any;
          } else {
            hasValue[event.sourceIndex] = true;
            results[event.sourceIndex] = event.value;
          }
          continue;
        }

        completedCount++;
        if (!hasValue[event.sourceIndex]) {
          throw new Error(`forkJoin: stream at index ${event.sourceIndex} completed without emitting any value`);
        }
      }

      yield results as T[];
    } finally {
      await coordinator.return?.();
    }
  }

  return createStream<T[]>("forkJoin", generator);
}
