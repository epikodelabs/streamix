import { createStream, isPromiseLike, MaybePromise, Stream } from '../abstractions';
import { eachValueFrom, fromAny } from '../converters';

/**
 * Combines multiple streams by emitting an array of values (a tuple),
 * only when all streams have a value ready (one-by-one, synchronized).
 *
 * It waits for the next value from all streams to form the next tuple.
 * The stream completes when any of the input streams complete.
 * Errors from any stream propagate immediately.
 *
 * @template T - A tuple type representing the combined values from the streams.
 * @param streams Streams to combine.
 * @returns {Stream<T>} A new stream that emits a synchronized tuple of values.
 */
export function zip<T extends readonly unknown[] = any[]>(
  ...streams: Array<MaybePromise<Stream<T[number]> | Array<T[number]> | T[number]>>
): Stream<T> {
  
  return createStream<T>('zip', async function* (): AsyncGenerator<T, void, unknown> {
    
    // --- 1. Initialization and Setup ---
    const iterators: AsyncIterator<any>[] = [];
    const nextPromises: (Promise<IteratorResult<any>> | null)[] = [];
    let activeCount: number;

    // Corrected initialization: Use Array<any[]> which is compatible with push,
    // and cast the result at the end when necessary.
    const buffers: Array<any[]> = [];

    try {
      // Resolve top-level promises and structure
      const resolvedInputs = await Promise.all(
        streams.map(async (s) => (isPromiseLike(s) ? await s : s))
      );

      const normalizedStreams = (resolvedInputs.length === 1 && Array.isArray(resolvedInputs[0])
        ? resolvedInputs[0]
        : resolvedInputs) as Array<Stream<T[number]> | Array<T[number]> | T[number]>;

      if (normalizedStreams.length === 0) return;

      activeCount = normalizedStreams.length;
      
      // Create iterators, initial nextPromises, and buffers
      for (const s of normalizedStreams) {
        // Handle inner promises/values/arrays for the stream source itself
        const streamSource = isPromiseLike(s) ? await s : s;
        
        const iterator = eachValueFrom(fromAny(streamSource))[Symbol.asyncIterator]();
        iterators.push(iterator);
        nextPromises.push(iterator.next());
        buffers.push([]); // <-- Now correctly uses Array.push
      }

      // Helper to wrap promises for index tracking and error handling
      const reflect = (promise: Promise<IteratorResult<any>>, index: number) =>
        promise.then(
          result => ({ ...result, index, status: 'fulfilled' as const }),
          error => ({ error, index, status: 'rejected' as const })
        );

      // --- 2. Main Zipping Loop ---
      while (activeCount > 0) {
        
        // Race all currently pending next() promises
        const race = Promise.race(
          nextPromises
            .map((p, i) => (p ? reflect(p, i) : null))
            .filter(Boolean) as Promise<
              | { index: number; value: any; done: boolean; status: 'fulfilled' }
              | { index: number; error: any; status: 'rejected' }
            >[]
        );

        const winner = await race;

        // --- A. Handle Error ---
        if (winner.status === 'rejected') {
          throw winner.error; // Propagate error immediately
        }

        const { value, done, index: winnerIndex } = winner;
        
        // --- B. Handle Completion (The "Zip Rule") ---
        if (done) {
          activeCount = 0; // Completion of ANY stream means the zip stream completes
          break;
        }

        // --- C. Handle Value Reception ---
        // 1. Buffer the received value
        buffers[winnerIndex].push(value);

        // 2. Immediately queue the next next() call for the winning stream
        nextPromises[winnerIndex] = iterators[winnerIndex].next();
        
        // 3. Check for Emission Opportunity (all buffers have a value)
        if (buffers.every(buffer => buffer.length > 0)) {
          // Yield one zipped tuple of values
          // Note: The map operation shifts out values and must be cast back to the tuple type T
          const tuple = buffers.map(buffer => buffer.shift()!) as unknown as T;
          yield tuple;
        }
      }
    } catch (error) {
      throw error; // Re-throw the error for the stream consumer
    } finally {
      // --- 3. Cleanup All Iterators ---
      // Ensure all active iterators are closed
      await Promise.all(
        iterators.map(it => {
          if (it.return) {
            return it.return(undefined).catch(() => {});
          }
          return Promise.resolve();
        })
      );
    }
  });
}
