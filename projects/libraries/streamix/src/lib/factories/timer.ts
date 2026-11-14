import type { Readable } from '../atoms/atom';
import { fromPush } from './fromPush';

/**
 * Creates a hot timer atom that emits numbers starting from 0.
 *
 * With only a delay, the timer is one-shot: it emits `0` once and then
 * completes. With a repeat period, it emits `0` after `delayMs` and then
 * `1`, `2`, ... every `intervalMs`. This matches RxJS `timer`.
 *
 * The underlying timer is shared between all subscribers. It starts on the
 * first subscription and stops when the last subscriber unsubscribes. As with
 * every Readable, a new subscriber receives the timer atom's current value first
 * when one exists; earlier history is not replayed.
 *
 * In analog mode each subscriber keeps only the latest value (skipping
 * intermittent ticks); in discrete mode each subscriber queues all values.
 *
 * @param delayMs - The time in milliseconds to wait before emitting the first value (0).
 * If 0, the first value is emitted asynchronously (in the next microtask).
 * @param intervalMs - The time in milliseconds between subsequent emissions.
 * If omitted, the timer emits once and completes.
 * @example
 * timer(100); // 0 after 100 ms, then completes.
 * timer(100, 20); // 0 after 100 ms, then 1 every 20 ms.
 * @returns {Readable<number>} An atom that emits incrementing numbers (0, 1, 2, ...).
 */
export function timer(delayMs: number = 0, intervalMs?: number): Readable<number> {
  return fromPush<number>((sink, signal) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    let count = 0;

    const sleep = (ms: number) =>
      new Promise<boolean>((resolve) => {
        const finish = () => {
          wake = undefined;
          timeoutId = undefined;
          resolve(!signal.aborted);
        };
        wake = finish;
        timeoutId = setTimeout(finish, ms);
      });

    const run = async () => {
      if (delayMs > 0) {
        if (!(await sleep(delayMs))) return;
      } else {
        await Promise.resolve();
        if (signal.aborted) return;
      }

      await sink.next(count++);
      if (signal.aborted) return;

      if (intervalMs === undefined) {
        sink.complete();
        return;
      }

      while (!signal.aborted) {
        if (!(await sleep(intervalMs))) return;
        await sink.next(count++);
      }
    };

    void run();

    return () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      const pending = wake;
      wake = undefined;
      pending?.();
    };
  }, { name: 'timer' });
}
