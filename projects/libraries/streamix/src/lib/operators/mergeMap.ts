import { __streamixBeginLifetime, type StreamixLifetimeSpan } from '../runtime/introspection';
import { createPushOperator, MaybePromise, normalizeError } from "../atoms";
import type { PipeInput } from "../atoms/pipe";
import { from } from '../factories';
import { createAsyncCoordinator, type RunnerEvent } from '../utils';
import { ConcurrentInnerExecution } from '../runtime/concurrent-inner-execution';

/**
 * Creates a stream operator that maps each value from the source stream to an "inner" stream
 * and merges all inner streams concurrently into a single output stream.
 *
 * For each value from the source stream:
 * 1. The `project` function is called with the value and its index.
 * 2. The returned value is normalized into a stream using {@link from}.
 * 3. The inner stream is consumed concurrently with all other active inner streams.
 * 4. Emitted values from all inner streams are interleaved into the output stream.
 *
 * This operator is useful for performing parallel asynchronous operations while
 * preserving all emitted values in a merged output with correct temporal ordering.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the inner and output streams.
 * @param project A function that maps a source value and its index to either:
 *   - an {@link Atom | Atom<R>},
 *   - a {@link MaybePromise<R>},
 *   - or an array of `R`.
 * @param concurrent Maximum number of concurrent inner streams (default: Infinity).
 * @param bufferSize Maximum number of source values to queue when concurrency limit is reached (default: Infinity).
 * @returns An {@link Operator} instance that can be used in a stream's `pipe` method.
 *
 * @example
 * ```typescript
 * // Process HTTP requests with max 3 concurrent
 * pipe(
 *   stream(urls),
 *   mergeMap(url => fetch(url), 3)
 * )
 * ```
 */
export function mergeMap<T = any, R = any>(
  project: (value: T, index: number) => PipeInput<R> | MaybePromise<R> | Array<R>,
  concurrent: number = Infinity,
  bufferSize: number = Infinity
) {
  if (!(concurrent === Infinity || (Number.isInteger(concurrent) && concurrent > 0))) {
    throw new RangeError('mergeMap concurrent must be a positive integer or Infinity');
  }
  if (!(bufferSize === Infinity || (Number.isInteger(bufferSize) && bufferSize >= 0))) {
    throw new RangeError('mergeMap bufferSize must be a non-negative integer or Infinity');
  }
  return createPushOperator<T, R>('mergeMap', function (source, output) {
    let stopped = false;
    const operator = this;
    const lifetimes = new Map<number, StreamixLifetimeSpan>();
    const finishActive = (outcome: 'cancel' | 'error') => {
      for (const span of lifetimes.values()) span.finish(outcome);
      lifetimes.clear();
    };
    let cancelPending = () => {};
    const coordinator = createAsyncCoordinator<T | R>([source as AsyncIterator<T | R>]);

    void (async () => {
      const SOURCE_INDEX = 0;
      let projectIndex = 0;
      let sourceCompleted = false;
      const executions = new ConcurrentInnerExecution<{ value: T; span?: StreamixLifetimeSpan }>(concurrent, bufferSize, ({ value, span }) => {
        span?.start();
        try {
          const projected = project(value, projectIndex++);
          const inner = from(projected as any);
          const sourceIndex = coordinator.addSource(inner[Symbol.asyncIterator]() as AsyncIterator<T | R>);
          if (span) lifetimes.set(sourceIndex, span);
        } catch (error) { span?.finish('error'); throw error; }
      }, (job, reason) => job.span?.finish(reason));
      cancelPending = () => executions.close();

      try {
        while (!stopped) {
          const nextEvent = await coordinator.next();
          if (stopped || nextEvent.done) break;

          const event = nextEvent.value as RunnerEvent<R>;

          if (event.sourceIndex === SOURCE_INDEX) {
            if (event.type === 'value') {
              const sourceValue = event.value as unknown as T;
              executions.accept({ value: sourceValue, span: __streamixBeginLifetime(operator) });
            } else if (event.type === 'complete') {
              sourceCompleted = true;
              if (executions.idle) {
                break;
              }
            } else if (event.type === 'error') {
              throw normalizeError(event.error);
            }
          } else {
            const span = lifetimes.get(event.sourceIndex);
            if (event.type === 'value') {
              span?.output();
              output.push(event.value);
            } else if (event.type === 'complete') {
              span?.finish('complete');
              lifetimes.delete(event.sourceIndex);
              executions.complete();

              if (sourceCompleted && executions.idle) {
                break;
              }
            } else if (event.type === 'error') {
              span?.finish('error');
              lifetimes.delete(event.sourceIndex);
              throw normalizeError(event.error);
            }
          }
        }

        if (!output.disposed) output.dispose();
      } catch (err) {
        if (!output.disposed) output.fail(normalizeError(err));
      } finally {
        finishActive('cancel');
        executions.close();
        await coordinator.return?.();
      }
    })();

    return async () => {
      stopped = true;
      finishActive('cancel');
      cancelPending();
      await coordinator.return?.();
    };
  });
}
