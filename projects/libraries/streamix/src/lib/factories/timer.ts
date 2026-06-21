import { isPromiseLike, type MaybePromise } from '../atoms';
import type { Atom } from '../atoms/atom';
import { createSharedSource } from '../utils/sharedSource';

/**
 * Creates a hot timer atom that emits numbers starting from 0.
 *
 * The underlying timer is shared between all subscribers. It starts on the
 * first subscription and stops when the last subscriber unsubscribes. Values
 * emitted before a subscription are not replayed.
 *
 * In analog mode each subscriber keeps only the latest value (skipping
 * intermittent ticks); in discrete mode each subscriber queues all values.
 *
 * @param delayMs - The time in milliseconds to wait before emitting the first value (0).
 * If 0, the first value is emitted immediately (in the next microtask).
 * @param intervalMs - The time in milliseconds between subsequent emissions.
 * If not provided, it defaults to `delayMs`.
 * @returns {Atom<number>} An atom that emits incrementing numbers (0, 1, 2, ...).
 */
export function timer(delayMs: MaybePromise<number> = 0, intervalMs?: MaybePromise<number>): Atom<number> {
  return createSharedSource<number>(
    (push) => {
      let cancelled = false;
      let timeoutId: any = null;
      let count = 0;

      const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
          timeoutId = setTimeout(() => {
            timeoutId = null;
            if (!cancelled) resolve();
          }, ms);
        });

      const clearPending = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const run = async () => {
        const resolvedDelay = isPromiseLike(delayMs) ? await delayMs : delayMs;
        const resolvedInterval = intervalMs !== undefined
          ? (isPromiseLike(intervalMs) ? await intervalMs : intervalMs)
          : resolvedDelay;

        if (cancelled) return;

        if (resolvedDelay > 0) {
          await sleep(resolvedDelay);
        } else {
          await Promise.resolve();
        }

        if (cancelled) return;
        await push(count++);

        while (!cancelled) {
          await sleep(resolvedInterval);
          if (cancelled) return;
          await push(count++);
        }
      };

      void run();

      return () => {
        cancelled = true;
        clearPending();
      };
    },
    { name: "timer" }
  );
}
