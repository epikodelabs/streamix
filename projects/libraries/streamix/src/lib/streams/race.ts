import { createStream, isPromiseLike, MaybePromise, Stream } from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";

/**
 * Returns a stream that races multiple input streams.
 * It emits values from the first stream that produces a value,
 * then cancels all other streams.
 *
 * This operator is useful for scenarios where you only need the result from the fastest
 * of several asynchronous operations. For example, fetching data from multiple servers
 * and only taking the result from the one that responds first.
 *
 * Once the winning stream completes, the output stream also completes.
 * If the winning stream emits an error, the output stream will emit that error.
 *
 * @template {readonly unknown[]} T - A tuple type representing the combined values from the streams.
 * @param streams Streams to race against each other.
 * @returns {Stream<T[number]>} A new stream that emits values from the first stream to produce a value.
 */
export function race<T extends readonly unknown[] = any[]>(
  ...streams: Array<MaybePromise<Stream<T[number]> | Array<T[number]> | T[number]>>
): Stream<T[number]> {
  return createStream<T[number]>('race', async function* () {
    const resolvedInputs = await Promise.all(
      streams.map(async (s) => (isPromiseLike(s) ? await s : s))
    );

    const normalizedStreams = (resolvedInputs.length === 1 && Array.isArray(resolvedInputs[0])
      ? resolvedInputs[0]
      : resolvedInputs) as Array<Stream<T[number]> | Array<T[number]> | T[number]>;

    if (normalizedStreams.length === 0) return;

    const controllers = new Array(normalizedStreams.length).fill(null).map(() => new AbortController());
    const resolvedStreams = [];
    for (const s of normalizedStreams) {
      resolvedStreams.push(isPromiseLike(s) ? await s : s);
    }
    const iterators = resolvedStreams.map((s) => eachValueFrom(fromAny(s))[Symbol.asyncIterator]());

    try {
      while (true) {
        // Create promises for all iterators
        const promises = iterators.map((it, i) =>
          it.next().then(result => ({ ...result, index: i }))
        );

        // Race all iterators
        const { value, done, index } = await Promise.race(promises);

        if (done) {
          // Cancel all other streams
          controllers.forEach((c, i) => i !== index && c.abort());
          return;
        }

        yield value;

        // Cancel losing streams
        controllers.forEach((c, i) => i !== index && c.abort());
      }
    } finally {
      // Cleanup all controllers
      controllers.forEach(c => c.abort());
    }
  });
}
