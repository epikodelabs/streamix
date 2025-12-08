import { createStream, Stream } from "../abstractions";
import { eachValueFrom } from "../converters";

/**
 * Waits for all streams to complete and emits an array of their last values.
 *
 * @template T The type of the last values emitted by each stream.
 * @param streams An iterable of Stream<T>
 * @returns Stream<T[]>
 */
export function forkJoin<T = any>(streams: Iterable<Stream<T>>): Stream<T[]> {
  async function* generator() {
    const promises: Promise<void>[] = [];

    const streamsArray = Array.from(streams);
    const results = new Array(streamsArray.length);
    const finished = new Array(streamsArray.length).fill(false);

    // Subscribe to each stream
    for (let i = 0; i < streamsArray.length; i++) {
      const stream = streamsArray[i];

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
