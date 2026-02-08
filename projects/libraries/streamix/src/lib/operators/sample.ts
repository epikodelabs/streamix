import { createPushOperator, getIteratorMeta, isPromiseLike, type MaybePromise } from '../abstractions';

/**
 * Creates a stream operator that emits the most recent value from the source stream
 * at a fixed periodic interval.
 *
 * @template T The type of the values in the source and output streams.
 * @param period The time in milliseconds between each emission.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export const sample = <T = any>(period: MaybePromise<number>) =>
  createPushOperator<T>('sample', (source, output) => {
    let lastResult: IteratorResult<T> | undefined;
    let lastMeta: ReturnType<typeof getIteratorMeta> | undefined;
    let skipped = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let resolvedPeriod: number | undefined = undefined;

    const startSampling = () => {
      if (resolvedPeriod === undefined) return;
      intervalId = setInterval(() => {
        if (!lastResult) return;
        if (!skipped) {
          output.push(lastResult.value!, lastMeta);
        }
        skipped = true;
      }, resolvedPeriod);
    };

    const stopSampling = () => {
      if (intervalId !== null) clearInterval(intervalId);
      intervalId = null;
    };

    void (async () => {
      try {
        resolvedPeriod = isPromiseLike(period) ? await period : period;
        startSampling();

        while (true) {
          const result = await source.next();
          if (result.done) break;

          lastMeta = getIteratorMeta(source);
          lastResult = result;
          skipped = false;
        }

        if (lastResult && !skipped) {
          output.push(lastResult.value!, lastMeta);
        }
      } catch (err) {
        output.error(err);
      } finally {
        stopSampling();
        if (!output.completed()) output.complete();
      }
    })();

    return stopSampling;
  });
