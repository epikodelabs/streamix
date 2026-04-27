import { createPushOperator, isPromiseLike, type MaybePromise } from '../abstractions';

/**
 * Creates a stream operator that emits the most recent value from the source stream
 * at a fixed periodic interval.
 *
 * Values that arrive between sample ticks and are not emitted are forwarded with
 * `dropped: true` so that backpressure is released without surfacing them as real
 * emissions.
 *
 * @template T The type of the values in the source and output streams.
 * @param period The time in milliseconds between each emission.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export const sample = <T = any>(period: MaybePromise<number>) =>
  createPushOperator<T>('sample', (source, output) => {
    let lastValue: T | undefined;
    let hasValue = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let resolvedPeriod: number | undefined = undefined;

    const emit = () => {
      if (hasValue) {
        output.push(lastValue!);
        hasValue = false;
      }
    };

    const startSampling = () => {
      if (resolvedPeriod === undefined) return;
      intervalId = setInterval(emit, resolvedPeriod);
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

          if ((result as any).dropped) { output.drop(result.value); continue; }

          // If a value is already pending, mark it as dropped.
          if (hasValue) {
            output.drop(lastValue!);
          }
          lastValue = result.value;
          hasValue = true;
        }

        // Emit the last value if pending when source completes.
        emit();
      } catch (err) {
        output.error(err);
      } finally {
        stopSampling();
        if (!output.completed()) output.complete();
      }
    })();

    return stopSampling;
  });
