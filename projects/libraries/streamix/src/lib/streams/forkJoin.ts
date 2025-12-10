import { createStream, isPromiseLike, MaybePromise, Stream } from "../abstractions";
import { eachValueFrom } from "../converters";

/**
 * Waits for all streams to complete and emits an array of their last values.
 *
 * @template T The type of the last values emitted by each stream.
 * @param streams Streams to join; arrays/iterables are also accepted for backward compatibility.
 * @returns Stream<T[]>
 */
export function forkJoin<T = any>(
  ...streams: Array<MaybePromise<Stream<T> | Iterable<Stream<T>>>>
): Stream<T[]> {
  async function* generator() {
    const promises: Promise<void>[] = [];

    const resolvedInputs = await Promise.all(
      streams.map(async (stream) => (isPromiseLike(stream) ? await stream : stream))
    );

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
    const finished = new Array(streamsArray.length).fill(false);

    // Subscribe to each stream
    for (let i = 0; i < streamsArray.length; i++) {
      const stream = isPromiseLike(streamsArray[i]) ? await streamsArray[i] : streamsArray[i];

      const p = (async () => {
        let last: T | undefined;
        let hasValue = false;

        for await (const value of eachValueFrom(stream)) {
          last = value;
          hasValue = true;
        }

        if (!hasValue) {
          throw new Error("forkJoin: one of the streams completed without emitting any value");
        }

        results[i] = last;
        finished[i] = true;
      })();

      promises.push(p);
    }

    // Wait for all streams to finish
    await Promise.all(promises);

    // Yield the collected last values
    yield results as T[];
  }

  return createStream<T[]>("forkJoin", generator);
}
