import { createOperator, isPromiseLike, MaybePromise, Operator } from '../abstractions';
import { eachValueFrom } from '../converters';
import { createSubject, Subject } from '../subjects';

/**
 * Creates a stream operator that emits the most recent value from the source stream
 * at a fixed periodic interval while tracking pending and phantom states.
 *
 * Values that arrive faster than the period are considered phantoms if skipped,
 * and pending results are tracked in PipeContext until resolved or emitted.
 *
 * @template T The type of the values in the source and output streams.
 * @param period The time in milliseconds between each emission.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export const sample = <T = any>(period: MaybePromise<number>) =>
  createOperator<T, T>('sample', function (this: Operator, source) {
    const output: Subject<T> = createSubject<T>();

    let lastResult: IteratorResult<T> | undefined;
    let skipped = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let resolvedPeriod: number | undefined = undefined;

    const startSampling = () => {
      if (resolvedPeriod === undefined) {
        return;
      }
      intervalId = setInterval(async () => {
        if (!lastResult) return;

        if (!skipped) {
          output.next(lastResult.value!);
        }

        skipped = true;
      }, resolvedPeriod);
    };

    const stopSampling = () => {
      if (intervalId !== null) clearInterval(intervalId);
      intervalId = null;
    };

    (async () => {
      try {
        resolvedPeriod = isPromiseLike(period) ? await period : period;

        startSampling();

        while (true) {
          const result: IteratorResult<T> = await source.next();
          if (result.done) break;

          lastResult = result;
          skipped = false;
        }

        // Emit final value
        if (lastResult) {
          output.next(lastResult.value!);
        }
      } catch (err) {
        output.error(err);
      } finally {
        stopSampling();
        output.complete();
      }
    })();

    return eachValueFrom(output);
  });
