import { createStream, isPromiseLike, MaybePromise, Stream } from "../abstractions";

/**
 * Waits for all streams to complete and emits an array of their last values.
 *
 * @template T The type of the last values emitted by each stream.
 * @param streams Streams to join; arrays/iterables are also accepted for backward compatibility.
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

    let streamsArray: Array<Stream<T>> = [];
    if (resolvedInputs.length === 1) {
      const [first] = resolvedInputs;
      if (first && typeof first === "object" && Symbol.iterator in first) {
        streamsArray = Array.from(first as Iterable<Stream<T>>);
      } else {
        streamsArray = [first as Stream<T>];
      }
    } else {
      streamsArray = resolvedInputs as Array<Stream<T>>;
    }
    const results = new Array(streamsArray.length);

    const promises = streamsArray.map(async (stream, index) => {
      const resolved = isPromiseLike(stream) ? await stream : stream;
      let last: T | undefined;
      let hasValue = false;

      for await (const value of resolved) {
        last = value;
        hasValue = true;
      }

      if (!hasValue) {
        throw new Error("forkJoin: one of the streams completed without emitting any value");
      }

      results[index] = last;
    });

    await Promise.all(promises);
    yield results as T[];
  }

  return createStream<T[]>("forkJoin", generator);
}
