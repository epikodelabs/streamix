import {
  createOperator,
  getIteratorMeta,
  tagValue,
  type MaybePromise,
  type Operator,
  type Stream
} from '../abstractions';
import { fromAny } from '../converters';
import { createAsyncCoordinator, type RunnerEvent } from '../utils';

/**
 * Creates a stream operator that maps each value from the source stream to an "inner" stream
 * and merges all inner streams concurrently into a single output stream.
 *
 * For each value from the source stream:
 * 1. The `project` function is called with the value and its index.
 * 2. The returned value is normalized into a stream using {@link fromAny}.
 * 3. The inner stream is consumed concurrently with all other active inner streams.
 * 4. Emitted values from all inner streams are interleaved into the output stream
 *    in timestamp order, preserving causality across all concurrent operations.
 *
 * This operator is useful for performing parallel asynchronous operations while
 * preserving all emitted values in a merged output with correct temporal ordering.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the inner and output streams.
 * @param project A function that maps a source value and its index to either:
 *   - a {@link Stream<R>},
 *   - a {@link MaybePromise<R>} (value or promise),
 *   - or an array of `R`.
 * @param concurrent Maximum number of concurrent inner streams (default: Infinity).
 * @returns An {@link Operator} instance that can be used in a stream's `pipe` method.
 *
 * @example
 * ```typescript
 * // Process HTTP requests with max 3 concurrent
 * stream(urls).pipe(
 *   mergeMap(url => fetch(url), 3)
 * )
 * ```
 */
export function mergeMap<T = any, R = any>(
  project: (value: T, index: number) => Stream<R> | MaybePromise<R> | Array<R>,
  concurrent: number = Infinity
) {
  return createOperator<T, R>('mergeMap', function (this: Operator, source) {
    // Create the generator and store reference for tagValue
    let outputIterator: AsyncGenerator<R, void, unknown>;
    
    const generator = async function* () {
      // Source is at index 0, inner streams start at index 1+
      const SOURCE_INDEX = 0;
      
      // Create coordinator with just the source initially
      const coordinator = createAsyncCoordinator([source]);
      
      // Track metadata for each inner stream
      const innerMetas = new Map<number, { valueId: string; operatorIndex: number; operatorName: string } | undefined>();
      
      let projectIndex = 0;
      let sourceCompleted = false;
      let pendingInners = 0;

      /**
       * Process events while waiting for a concurrency slot to free up.
       * Yields values from inner streams and tracks their completion.
       */
      const processWhileWaiting = async function* () {
        while (pendingInners >= concurrent) {
          const nextEvent = await coordinator.next();
          if (nextEvent.done) break;
          
          const event = nextEvent.value as RunnerEvent<R>;
          
          // Only process inner stream events (not source events)
          if (event.sourceIndex !== SOURCE_INDEX) {
            if (event.type === 'value') {
              const parentMeta = innerMetas.get(event.sourceIndex);
              yield tagValue(outputIterator, event.value, parentMeta, { kind: "expand" });
            } 
            else if (event.type === 'complete') {
              pendingInners--;
              innerMetas.delete(event.sourceIndex);
              break; // Free slot available
            }
            else if (event.type === 'error') {
              throw event.error;
            }
          }
        }
      };

      try {
        while (true) {
          const nextEvent = await coordinator.next();
          if (nextEvent.done) break;

          const event = nextEvent.value as RunnerEvent<R>;

          // ============================================
          // Source Stream Events (index 0)
          // ============================================
          if (event.sourceIndex === SOURCE_INDEX) {
            if (event.type === 'value') {
              // Wait for a concurrency slot if needed
              if (pendingInners >= concurrent) {
          yield* processWhileWaiting();
              }

              // Project the source value to an inner stream
              const projected = project(event.value as any, projectIndex++);
              const inner = fromAny(projected as any);
              const parentMeta = getIteratorMeta(source);

              // Add the inner stream to the coordinator
              const innerIndex = coordinator.addSource(inner[Symbol.asyncIterator]());
              innerMetas.set(innerIndex, parentMeta);
              pendingInners++;
            }
            else if (event.type === 'complete') {
              // Source completed - continue until all inners complete
              sourceCompleted = true;
            }
            else if (event.type === 'error') {
              throw event.error;
            }
          }
          // ============================================
          // Inner Stream Events (index > 0)
          // ============================================
          else {
            if (event.type === 'value') {
              const parentMeta = innerMetas.get(event.sourceIndex);
              yield tagValue(outputIterator, event.value, parentMeta, { kind: "expand" });
            }
            else if (event.type === 'complete') {
              pendingInners--;
              innerMetas.delete(event.sourceIndex);

              // If source is complete and no more inners, we're done
              if (sourceCompleted && pendingInners === 0) {
          break;
              }
            }
            else if (event.type === 'error') {
              throw event.error;
            }
          }
        }
      } finally {
        // Coordinator cleanup handles all sources (including inners)
        await coordinator.return?.();
      }
    };

    // Store reference and return
    outputIterator = generator();
    return outputIterator;
  });
}