import { createStream, isPromiseLike, type MaybePromise, type Stream } from '../abstractions';

/**
 * Emits zero after the initial delay. If provided, the repeat period schedules
 * subsequent values. Without a repeat period, the timer completes after zero.
 */
export function timer(delayMs: MaybePromise<number> = 0, intervalMs?: MaybePromise<number>): Stream<number> {
  return createStream('timer', async function* (signal) {
    const delay = isPromiseLike(delayMs) ? await delayMs : delayMs;
    const period = isPromiseLike(intervalMs) ? await intervalMs : intervalMs;
    const sleep = (ms: number) => new Promise<void>(resolve => {
      const finish = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      const timeout = setTimeout(finish, ms);
      if (signal?.aborted) finish();
      else signal?.addEventListener('abort', finish, { once: true });
    });

    if (delay > 0) await sleep(delay);
    else await Promise.resolve();
    if (signal?.aborted) return;
    yield 0;

    if (period === undefined) return;
    for (let count = 1; !signal?.aborted; count++) {
      await sleep(period);
      if (!signal?.aborted) yield count;
    }
  });
}
