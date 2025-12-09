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

    const sleep = (ms: number) =>
      new Promise<void>(resolve => setTimeout(resolve, ms));

    if (resolvedDelay > 0) {
      await sleep(resolvedDelay);
    } else {
      // yield in next microtask to avoid sync emission on subscribe
      await Promise.resolve();
    }

    yield count++;

    while (true) {
      await sleep(resolvedInterval);
      yield count++;
    }
  }

  return createStream<number>('timer', timerGenerator);
}
