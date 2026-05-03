import {
    createPushOperator,
    MaybePromise,
    type Operator,
    type Stream
} from '../abstractions';
import { fromAny } from '../converters';
import { createAsyncCoordinator, type RunnerEvent } from '../utils';

const RAW = Symbol.for("streamix.rawAsyncIterator");

/**
 * Creates a stream operator that maps each value from the source stream to an "inner" stream
 * and merges all inner streams concurrently into a single output stream.
 *
 * For each value from the source stream:
 * 1. The `project` function is called with the value and its index.
 * 2. The returned value is normalized into a stream using {@link fromAny}.
 * 3. The inner stream is consumed concurrently with all other active inner streams.
 * 4. Emitted values from all inner streams are interleaved into the output stream.
 *
 * This operator is useful for performing parallel asynchronous operations while
 * preserving all emitted values in a merged output with correct temporal ordering.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the inner and output streams.
 * @param project A function that maps a source value and its index to either:
 *   - a {@link Stream<R>},
 *   - a {@link MaybePromise<R>},
 *   - or an array of `R`.
 * @param concurrent Maximum number of concurrent inner streams (default: Infinity).
 * @param bufferSize Maximum number of source values to queue when concurrency limit is reached (default: Infinity).
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
  concurrent: number = Infinity,
  bufferSize: number = Infinity
) {
  return createPushOperator<T, R>('mergeMap', function (source, output) {
    let stopped = false;

    void (async () => {
      const SOURCE_INDEX = 0;
      const coordinator = createAsyncCoordinator([source]);
      let projectIndex = 0;
      let sourceCompleted = false;
      let pendingInners = 0;
      const queuedSourceValues: T[] = [];

      const startInner = (value: T) => {
        const projected = project(value, projectIndex++);
        const inner = fromAny(projected as any);
        coordinator.addSource(((inner as any)[RAW]?.() ?? inner[Symbol.asyncIterator]()) as AsyncIterator<R>);
        pendingInners++;
      };

      const drainQueuedSourceValues = () => {
        while (queuedSourceValues.length > 0 && pendingInners < concurrent) {
          startInner(queuedSourceValues.shift()!);
        }
      };

      try {
        while (!stopped) {
          const nextEvent = await coordinator.next();
          if (nextEvent.done) break;

          const event = nextEvent.value as RunnerEvent<R>;

          if (event.sourceIndex === SOURCE_INDEX) {
            if (event.type === 'value') {
              if (event.dropped) {
                continue;
              }

              const sourceValue = event.value as unknown as T;
              if (pendingInners >= concurrent) {
                if (bufferSize !== Infinity && queuedSourceValues.length >= bufferSize) {
                  queuedSourceValues.shift();
                }
                queuedSourceValues.push(sourceValue);
              } else {
                startInner(sourceValue);
              }
            } else if (event.type === 'complete') {
              sourceCompleted = true;
              if (pendingInners === 0 && queuedSourceValues.length === 0) {
                break;
              }
            } else if (event.type === 'error') {
              throw event.error;
            }
          } else {
            if (event.type === 'value') {
              if (event.dropped) {
                output.drop(event.value);
              } else {
                output.push(event.value);
              }
            } else if (event.type === 'complete') {
              pendingInners--;
              drainQueuedSourceValues();

              if (sourceCompleted && pendingInners === 0 && queuedSourceValues.length === 0) {
                break;
              }
            } else if (event.type === 'error') {
              throw event.error;
            }
          }
        }

        if (!output.completed()) output.complete();
      } catch (err) {
        if (!output.completed()) output.error(err);
      } finally {
        await coordinator.return?.();
      }
    })();

    return async () => {
      stopped = true;
    };
  });
}
