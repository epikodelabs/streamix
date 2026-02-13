import { createStream, type MaybePromise, type Stream } from "../abstractions";
import { fromAny } from "../converters";
import { createAsyncCoordinator } from "../utils";

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
  ...streams: Array<Stream<T[number]> | MaybePromise<T[number]>>
): Stream<T[number]> {
  return createStream<T[number]>('race', async function* () {
    if (streams.length === 0) return;

    const iterators = streams.map(s => fromAny(s)[Symbol.asyncIterator]());
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

        // 2. Identify the winner from the first value or completion
        if (winnerIndex === null) {
          winnerIndex = event.sourceIndex;
          
          // Once we have a winner, we can tell the runner to stop 
          // polling the others. We do this by calling return on the losers.
          iterators.forEach((it, idx) => {
            if (idx !== winnerIndex) {
              it.return?.();
            }
          });
        }

        // 3. Only process events from the winner
        if (event.sourceIndex === winnerIndex) {
          if (event.type === 'value') {
            yield event.value;
          } else if (event.type === 'complete') {
            break;
          }
        }
      }
    } finally {
      // Clean up the runner and all underlying iterators
      await runner.return?.();
    }
  });
}