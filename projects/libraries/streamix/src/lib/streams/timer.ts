import { createStream, isPromiseLike, MaybePromise, Stream } from '../abstractions';

/**
 * Creates a timer stream that emits numbers starting from 0.
 *
 * This stream is useful for scheduling events or generating periodic data.
 * It is analogous to `setInterval` but as an asynchronous stream.
 *
 * @param {number} [delayMs=0] - The time in milliseconds to wait before emitting the first value (0).
 * If 0, the first value is emitted immediately (in the next microtask).
 * @param {number} [intervalMs] - The time in milliseconds between subsequent emissions.
 * If not provided, it defaults to `delayMs`.
 * @returns {Stream<number>} A stream that emits incrementing numbers (0, 1, 2, ...).
 */
export function timer(delayMs: MaybePromise<number> = 0, intervalMs?: MaybePromise<number>): Stream<number> {
  async function* timerGenerator() {
    const resolvedDelay = isPromiseLike(delayMs) ? await delayMs : delayMs;
    const resolvedInterval = intervalMs !== undefined
      ? (isPromiseLike(intervalMs) ? await intervalMs : intervalMs)
      : resolvedDelay;

    let count = 0;
    let cancelled = false;
    let timeoutId: any = null;
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

    try {
      const start = performance.now();
      let nextTime = start + (resolvedDelay > 0 ? resolvedDelay : 0);

      if (resolvedDelay > 0) {
        await sleep(Math.max(0, nextTime - performance.now()));
      } else {
        await Promise.resolve();
        nextTime = performance.now();
      }

      yield count++;
      nextTime += resolvedInterval;

      while (true) {
        const waitMs = Math.max(0, nextTime - performance.now());
        await sleep(waitMs);
        yield count++;
        nextTime += resolvedInterval;
      }
    } finally {
      cancelled = true;
      clearPending();
    }
  }

  return createStream<number>('timer', timerGenerator);
}
