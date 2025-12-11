import { createStream, isPromiseLike, MaybePromise, Stream } from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";

/**
 * Combines multiple streams and emits a tuple containing the latest values
 * from each stream whenever any of the source streams emits a new value.
 *
 * This operator is useful for scenarios where you need to react to changes
 * in multiple independent data sources simultaneously. The output stream
 * will not emit a value until all source streams have emitted at least one
 * value. The output stream completes when all source streams have completed.
 *
 * @template {unknown[]} T A tuple type representing the combined values from the streams.
 * @param streams Streams/values to combine.
 * @returns {Stream<T>} A new stream that emits a tuple of the latest values from all source streams.
 */
export function combineLatest<T extends unknown[] = any[]>(
  ...sources: Array<MaybePromise<Stream<T[number]> | Array<T[number]> | T[number]>>
): Stream<T> {
  async function* generator() {
    const resolvedInputs: any[] = [];
    for (const src of sources) {
      resolvedInputs.push(isPromiseLike(src) ? await src : src);
    }

    const resolvedStreamsInput = (resolvedInputs.length === 1 && Array.isArray(resolvedInputs[0])
      ? resolvedInputs[0]
      : resolvedInputs) as Array<Stream<T[number]> | Array<T[number]> | T[number]>;

    if (resolvedStreamsInput.length === 0) return;

    const resolvedStreams = [];
    for (const s of resolvedStreamsInput) {
      resolvedStreams.push(isPromiseLike(s) ? await s : s);
    }

    const latestValues: Partial<T>[] = [];
    const hasEmitted = new Array(resolvedStreams.length).fill(false);
    let completedStreams = 0;

    const iterators = resolvedStreams.map((stream) =>
      eachValueFrom(fromAny(stream))
    );

    const promisesByIndex: Array<Promise<any> | null> = new Array(resolvedStreams.length).fill(null);

    const createPromise = (index: number) => {
      const promise = iterators[index]
        .next()
        .then((result) => ({
          index,
          value: result.value,
          done: result.done,
        }));
      promisesByIndex[index] = promise;
      return promise;
    };

    // Initialize
    for (let i = 0; i < resolvedStreams.length; i++) {
      createPromise(i);
    }

    try {
      while (completedStreams < resolvedStreams.length) {
        const result = await Promise.race(
          promisesByIndex.filter((p): p is Promise<any> => p !== null)
        );

        if (result.done) {
          completedStreams++;
          promisesByIndex[result.index] = null;
          continue;
        }

        latestValues[result.index] = result.value;
        hasEmitted[result.index] = true;

        if (hasEmitted.every(Boolean)) {
          yield [...latestValues] as T;
        }

        createPromise(result.index);
      }
    } finally {
      for (const iterator of iterators) {
        if (iterator.return) {
          try {
            await iterator.return(undefined);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    }
  }

  return createStream<T>("combineLatest", generator);
}
