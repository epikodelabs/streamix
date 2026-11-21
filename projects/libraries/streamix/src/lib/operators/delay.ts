import { createPushOperator } from "../atoms";
import { normalizeError } from "../atoms";

/**
 * Creates a stream operator that delays the emission of each value from the source stream.
 *
 * Each value received from the source is held for the specified duration before
 * being emitted downstream. Cancellation clears the pending sleep timer and
 * stops pulling the source: a value whose delay was interrupted is dropped.
 *
 * @template T The type of the values in the source and output streams.
 * @param ms The time in milliseconds to delay each value.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export function delay<T = any>(ms: number) {
  return createPushOperator<T>('delay', (source, output) => {
    let aborted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;

    const sleep = (): Promise<void> => new Promise(resolve => {
      wake = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        wake = undefined;
        resolve();
      };
      timer = setTimeout(wake, ms);
    });

    const teardown = () => {
      aborted = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      // Release a parked sleeper immediately so the read loop can observe
      // the cancellation and exit instead of waiting out the full delay.
      wake?.();
    };

    void (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (result.done || aborted) break;

          if (ms !== undefined) {
            await sleep();
          }

          // Cancellation during the sleep drops the held value.
          if (aborted) break;

          output.push(result.value!);
        }
      } catch (err) {
        output.fail(normalizeError(err));
      } finally {
        teardown();
        if (!output.disposed) output.dispose();
      }
    })();

    return teardown;
  });
}
