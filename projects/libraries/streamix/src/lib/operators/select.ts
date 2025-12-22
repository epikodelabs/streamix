import { createOperator, type Operator } from "../abstractions";

/**
 * Creates a stream operator that emits only the values at the specified indices from a source stream.
 *
 * This operator takes an `indexIterator` (which can be a synchronous or asynchronous iterator
 * of numbers) and uses it to determine which values from the source stream should be emitted.
 * It acts as a positional filter: each source value is inspected once, and if its zero-based
 * index matches the next index yielded by `indexIterator`, that value is emitted. No buffering
 * of past values occurs. If the iterator completes, the operator completes regardless of
 * remaining source values.
 *
 * @template T The type of the values in the source and output streams.
 * @param indexIterator An iterator or async iterator that provides the zero-based indices
 * of the elements to be emitted.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const select = <T = any>(
  indexIterator: Iterator<number> | AsyncIterator<number>
) =>
  createOperator<T, T>("select", function (this: Operator, source) {
    function toAsyncIterator(
      iter: Iterator<number> | AsyncIterator<number>
    ): AsyncIterableIterator<number> {
      if (typeof (iter as any)[Symbol.asyncIterator] === "function") {
        return iter as AsyncIterableIterator<number>;
      }
      const syncIter = iter as Iterator<number>;
      return {
        async next() {
          return syncIter.next();
        },
        [Symbol.asyncIterator]() {
          return this;
        }
      };
    }

    const asyncIndexIterator = toAsyncIterator(indexIterator);

    async function* generator() {
      let currentIndex = 0;
      let nextTargetIndexPromise = asyncIndexIterator.next();

      while (true) {
        const result: IteratorResult<T> = await source.next();
        if (result.done) break;

        const targetIndexResult = await nextTargetIndexPromise;
        
        if (targetIndexResult.done) return;

        const nextTargetIndex = targetIndexResult.value;

        if (currentIndex === nextTargetIndex) {
          yield result.value;

          // fetch next target index
          nextTargetIndexPromise = asyncIndexIterator.next();
        }

        currentIndex++;
      }
    }

    // Return the async iterator directly - operators work with AsyncIterator<T>
    return generator();
  });
