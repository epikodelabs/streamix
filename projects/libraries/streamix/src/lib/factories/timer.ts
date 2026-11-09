import type { Atom } from '../atoms/atom';
import { fromPush } from './fromPush';

/**
 * Creates a hot timer atom that emits numbers starting from 0.
 *
 * The underlying timer is shared between all subscribers. It starts on the
 * first subscription and stops when the last subscriber unsubscribes. As with
 * every Atom, a new subscriber receives the timer atom's current value first
 * when one exists; earlier history is not replayed.
 *
 * In analog mode each subscriber keeps only the latest value (skipping
 * intermittent ticks); in discrete mode each subscriber queues all values.
 *
 * @param delayMs - The time in milliseconds to wait before emitting the first value (0).
 * If 0, the first value is emitted immediately (in the next microtask).
 * @param intervalMs - The time in milliseconds between subsequent emissions.
 * If not provided, it defaults to `delayMs`, which means `timer(100)` keeps
 * emitting every 100 ms indefinitely. (RxJS `timer(due)` emits once and
 * completes; use `take(1)` for that behavior here.)
 * @returns {Atom<number>} An atom that emits incrementing numbers (0, 1, 2, ...).
 */
export function timer(delayMs: number = 0, intervalMs?: number): Atom<number> {
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
      const resolvedInterval = intervalMs ?? delayMs;

      if (delayMs > 0) {
        if (!(await sleep(delayMs))) return;
      } else {
        await Promise.resolve();
        if (signal.aborted) return;
      }

      while (!signal.aborted) {
        await sink.next(count++);
        if (signal.aborted) return;
        if (!(await sleep(resolvedInterval))) return;
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
