import { createOperator, getIteratorMeta, isPromiseLike, setIteratorMeta, setValueMeta, type MaybePromise, type Operator } from '../abstractions';
import { eachValueFrom } from '../converters';
import { createSubject, type Subject } from '../subjects';

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
    const outputIterator = eachValueFrom(output);

    let lastResult: IteratorResult<T> | undefined;
    let lastMeta: ReturnType<typeof getIteratorMeta> | undefined;
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
          let value = lastResult.value!;
          if (lastMeta) {
            setIteratorMeta(outputIterator, { valueId: lastMeta.valueId }, lastMeta.operatorIndex, lastMeta.operatorName);
            value = setValueMeta(value, { valueId: lastMeta.valueId }, lastMeta.operatorIndex, lastMeta.operatorName);
          }
          // Emit value directly - tracer correlates it via valueId / inputQueue
          output.next(value);
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

          lastMeta = getIteratorMeta(source);
          lastResult = result;
          skipped = false;
        }

        // Emit final value
        // Guard against a race where the interval emits after the final source value
        // but before we exit the loop; in that case `skipped` is already true.
        if (lastResult && !skipped) {
          let value = lastResult.value!;
          if (lastMeta) {
            setIteratorMeta(outputIterator, { valueId: lastMeta.valueId }, lastMeta.operatorIndex, lastMeta.operatorName);
            value = setValueMeta(value, { valueId: lastMeta.valueId }, lastMeta.operatorIndex, lastMeta.operatorName);
          }
          // Emit value directly - tracer correlates it via valueId / inputQueue
          output.next(value);
        }
      } catch (err) {
        output.error(err);
      } finally {
        stopSampling();
        if (!output.completed()) output.complete();
      }
    })();

    return outputIterator;
  });
