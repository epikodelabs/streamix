import {
  createOperator,
  getIteratorEmissionStamp,
  getIteratorMeta,
  isPromiseLike,
  nextEmissionStamp,
  setIteratorEmissionStamp,
  setIteratorMeta,
  setValueMeta,
  type MaybePromise,
  type Operator,
} from '../abstractions';
import { eachValueFrom } from '../converters';
import { createSubject } from '../subjects';

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
  createOperator<T, T>('delayWhile', function (this: Operator, source) {
    const output = createSubject<T>();
    const outputIterator = eachValueFrom(output);
    const queue: Array<{ value: T; stamp: number; meta?: ReturnType<typeof getIteratorMeta> }> = [];
    let index = 0;

    const flushQueue = () => {
      for (const item of queue) {
        setIteratorEmissionStamp(outputIterator as AsyncIterator<T>, item.stamp);

        let value: any = item.value;
        if (item.meta) {
          setIteratorMeta(outputIterator as AsyncIterator<T>, { valueId: item.meta.valueId }, item.meta.operatorIndex, item.meta.operatorName);
          value = setValueMeta(value, { valueId: item.meta.valueId }, item.meta.operatorIndex, item.meta.operatorName);
        }

        output.next(value);
      }
      queue.length = 0;
    };

    (async () => {
      try {
        while (true) {
          const result = await source.next();
          const stamp = getIteratorEmissionStamp(source) ?? nextEmissionStamp();

          if (result.done) {
            break;
          }

          const meta = getIteratorMeta(source);

          const predicateResult = predicate(result.value, index++);
          const shouldDelay = isPromiseLike(predicateResult)
            ? await predicateResult
            : predicateResult;

          if (shouldDelay) {
            queue.push({ value: result.value, stamp, meta });
            continue;
          }

          if (queue.length > 0) {
            flushQueue();
          }

          setIteratorEmissionStamp(outputIterator as AsyncIterator<T>, stamp);

          let value: any = result.value;
          if (meta) {
            setIteratorMeta(outputIterator as AsyncIterator<T>, { valueId: meta.valueId }, meta.operatorIndex, meta.operatorName);
            value = setValueMeta(value, { valueId: meta.valueId }, meta.operatorIndex, meta.operatorName);
          }

          output.next(value);
        }

        if (queue.length > 0) {
          flushQueue();
        }
      } catch (err) {
        output.error(err);
        return;
      } finally {
        if (!output.completed()) output.complete();
      }
    })();

    return outputIterator;
  });
