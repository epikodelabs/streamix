import { createPushOperator, isPromiseLike, type MaybePromise } from '../abstractions';
import { normalizeError } from '../utils/helpers';

/**
 * Creates a stream operator that delays the emission of each value from the source stream.
 *
 * Each value received from the source is held for the specified duration before
 * being emitted downstream.
 *
 * @template T The type of the values in the source and output streams.
 * @param ms The time in milliseconds to delay each value.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export function delay<T = any>(ms: MaybePromise<number>) {
  return createPushOperator<T>('delay', (source, output) => {
    let stopped = false;
    let inputCompleted = false;
    let pending = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const completeIfReady = () => {
      if (!stopped && inputCompleted && pending === 0 && !output.completed()) {
        output.complete();
      }
    };

    void (async () => {
      try {
        const resolvedMs = isPromiseLike(ms) ? await ms : ms;

        while (true) {
          const result = await source.next();
          if (result.done) break;

          if (resolvedMs === undefined) {
            output.push(result.value!);
            continue;
          }

          pending++;
          const value = result.value!;
          const timer = setTimeout(() => {
            timers.delete(timer);
            pending--;

            if (!stopped) {
              output.push(value);
            }

            completeIfReady();
          }, resolvedMs);

          timers.add(timer);
        }
      } catch (err) {
        if (!stopped) {
          output.error(normalizeError(err));
        }
      } finally {
        inputCompleted = true;
        completeIfReady();
      }
    })();

    return () => {
      stopped = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      pending = 0;
    };
  });
}
