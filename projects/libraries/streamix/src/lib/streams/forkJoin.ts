import { createStream, isPromiseLike, type MaybePromise, type Stream } from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";

/**
 * Waits for all streams to complete and emits an array of their last values.
 *
 * @template T The type of the last values emitted by each stream.
 * @param sources Streams to join; arrays/iterables are also accepted for backward compatibility.
 * @returns Stream<T[]>
 */
export function forkJoin<T = any, R extends readonly unknown[] = any[]>(
  ...sources: { [K in keyof R]: MaybePromise<Stream<R[K]> | Array<R[K]> | R[K]> }
): Stream<T[]> {
  async function* generator() {
    const resolvedInputs: any[] = [];
    for (const src of sources) {
      resolvedInputs.push(isPromiseLike(src) ? await src : src);
    }

    const normalizedSources = (resolvedInputs.length === 1 && Array.isArray(resolvedInputs[0])
      ? resolvedInputs[0]
      : resolvedInputs) as Array<Stream<T> | Array<T> | T>;

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
