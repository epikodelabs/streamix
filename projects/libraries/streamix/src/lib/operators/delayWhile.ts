import {
  createPushOperator,
  isPromiseLike,
  type MaybePromise,
} from '../abstractions';

/**
 * Buffers values while a predicate returns `true` and releases them once the predicate flips to `false`.
 *
 * This operator evaluates the provided predicate for every value coming from the source stream.
 * - When the predicate resolves to `true`, the value is held in an internal queue.
 * - Once the predicate returns `false` for the first time, all buffered values are flushed in order,
 *   including the current value, and the operator resumes emitting immediately.
 * - The operator can re-enter the buffering state later if the predicate becomes `true` again.
 * - When the source completes while values are buffered, those values are flushed before completing.
 *
 * The predicate is allowed to return either a boolean or a promise of a boolean.
 *
 * @template T The type of values flowing through the stream.
 * @param predicate Function to test each value. Receives the value and its index; `true` means delay, `false` means emit immediately.
 */
export const delayWhile = <T = any>(
  predicate: (value: T, index: number) => MaybePromise<boolean>
) =>
  createPushOperator<T>('delayWhile', (source, output) => {
    const queue: T[] = [];
    let index = 0;

    const flushQueue = () => {
      for (const item of queue) {
        output.push(item as T);
      }
      queue.length = 0;
    };

    void (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (result.done) break;

          const predicateResult = predicate(result.value, index++);
          const shouldDelay = isPromiseLike(predicateResult)
            ? await predicateResult
            : predicateResult;

          if (shouldDelay) {
            queue.push(result.value);
            continue;
          }

          if (queue.length > 0) flushQueue();

          output.push(result.value);
        }

        if (queue.length > 0) flushQueue();
      } catch (err) {
        output.error(err);
      } finally {
        if (!output.completed()) output.complete();
      }
    })();

    return () => { queue.length = 0; };
  });
