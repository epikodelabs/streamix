import { createStream, DROPPED, type Stream } from "../abstractions";
import { fromAny } from "../converters";
import { createAsyncCoordinator } from "../utils";

const RAW = Symbol.for("streamix.rawAsyncIterator");

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
 * @param streams Streams or values (including promises) to race against each other.
 * @returns {Stream<T[number]>} A new stream that emits values from the first stream to produce a value.
 */
export function race<T extends readonly unknown[] = any[]>(
  ...streams: Array<Stream<T[number]> | Promise<T[number]>>
): Stream<T[number]> {
  const gen = async function* () {
    if (streams.length === 0) return;

    const iterators = streams.map(s => {
      const resolved = fromAny(s);
      return ((resolved as any)[RAW]?.() ?? resolved[Symbol.asyncIterator]()) as AsyncIterator<T[number]>;
    });
    const runner = createAsyncCoordinator(iterators);
    
    let winnerIndex: number | null = null;

    try {
      while (true) {
        const result = await runner.next();
        if (result.done) break;

        const event = result.value;

        // 1. Handle errors immediately regardless of winner
        if (event.type === 'error') {
          throw event.error;
        }

        // Dropped values must flow through the race output, but they must not
        // participate in winner selection.
        if (event.type === 'value' && event.dropped) {
          yield DROPPED(event.value) as any;
          continue;
        }

        // 2. Identify the winner from the first real (non-dropped) value or completion
        if (winnerIndex === null) {
          winnerIndex = event.sourceIndex;
          
          // Once we have a winner, tell the runner to stop polling the others
          // by calling return on the losers. Await all cleanups so resources
          // are freed before we continue yielding from the winner.
          await Promise.all(
            iterators.map((it, idx) =>
              idx !== winnerIndex ? it.return?.().catch(() => {}) : null
            )
          );
        }

        // 3. Only process events from the winner
        if (winnerIndex !== null && event.sourceIndex === winnerIndex) {
          if (event.type === 'value') {
            if (event.dropped) {
              yield DROPPED(event.value) as any;
            } else {
              yield event.value;
            }
          } else if (event.type === 'complete') {
            break;
          }
        }
      }
    } finally {
      // Clean up the runner and all underlying iterators
      await runner.return?.();
    }
  };

  const stream = createStream<T[number]>('race', gen);
  (stream as any)[RAW] = gen;
  return stream;
}