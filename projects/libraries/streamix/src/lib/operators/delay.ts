import { createAsyncOperator, getIteratorMeta, isPromiseLike, type MaybePromise } from '../abstractions';

/**
 * Creates a stream operator that delays the emission of each value from the source stream.
 *
 * Each value received from the source is held for the specified duration before
 * being emitted downstream.
 *
 * @template T The type of the values in the source and output streams.
 * @param ms The time in milliseconds to delay each value.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export function delay<T = any>(ms: MaybePromise<number>) {
  return createAsyncOperator<T>('delay', (source, output) => {
    void (async () => {
      try {
        const resolvedMs = isPromiseLike(ms) ? await ms : ms;

        while (true) {
          const result = await source.next();
          if (result.done) break;

          const meta = getIteratorMeta(source);

          if (resolvedMs !== undefined) {
            await new Promise((resolve) => setTimeout(resolve, resolvedMs));
          }

          output.push(result.value!, meta);
        }
      } catch (err) {
        output.error(err);
      } finally {
        if (!output.completed()) output.complete();
      }
    })();

    return () => {};
  });
}
