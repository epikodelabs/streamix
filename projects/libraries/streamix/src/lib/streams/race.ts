import { createStream, isPromiseLike, type MaybePromise, type Stream } from "../abstractions";
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
 * @param {MaybePromise<{ [K in keyof T]: Stream<T[K]> | Array<T[K]> | T[K] }>} streams - Streams (or a promise of them) to race against each other.
 * @returns {Stream<T[number]>} A new stream that emits values from the first stream to produce a value.
 */
export function race<T extends readonly unknown[] = any[]>(
  ...streams: Array<MaybePromise<Stream<T[number]> | Array<T[number]> | T[number]>>
): Stream<T[number]> {
  return createStream<T[number]>('race', async function* () {
    const resolvedInputs: any[] = [];
    for (const src of streams) {
      resolvedInputs.push(isPromiseLike(src) ? await src : src);
    }

    const normalizedStreams = (resolvedInputs.length === 1 && Array.isArray(resolvedInputs[0])
      ? resolvedInputs[0]
      : resolvedInputs) as Array<Stream<T[number]> | Array<T[number]> | T[number]>;

    if (!normalizedStreams || normalizedStreams.length === 0) return;

    const resolvedStreams: Array<Stream<T[number]> | Array<T[number]> | T[number]> = [];
    for (const s of normalizedStreams) {
      resolvedStreams.push(isPromiseLike(s) ? await s : s);
    }

    const iterators = resolvedStreams.map((s) => eachValueFrom(fromAny(s)));
    let winnerIndex: number | null = null;

    try {
      const first = await Promise.race(
        iterators.map((it, index) =>
          it.next().then(result => ({ ...result, index }))
        )
      );

      winnerIndex = first.index;

      // Cancel all losing streams as soon as the winner is known.
      await Promise.all(
        iterators.map((it, index) =>
          index !== winnerIndex && it.return
            ? it.return(undefined).catch(() => {})
            : Promise.resolve()
        )
      );

      if (first.done) return;

      yield first.value;

      const winner = iterators[winnerIndex];
      while (true) {
        const result = await winner.next();
        if (result.done) break;
        yield result.value;
      }
    } finally {
      await Promise.all(
        iterators.map((it) =>
          it.return ? it.return(undefined).catch(() => {}) : Promise.resolve()
        )
      );
    }
  });
}
