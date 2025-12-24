import { createOperator, isPromiseLike, type MaybePromise, type Operator } from '../abstractions';
import { eachValueFrom } from '../converters';
import { createSubject, type Subject } from '../subjects';

/**
 * Creates a stream operator that delays the emission of each value from the source stream
 * while tracking pending and phantom states.
 *
 * Each value received from the source is added to `context.pendingResults` and is only
 * resolved once the delay has elapsed and the value is emitted downstream.
 *
 * @template T The type of the values in the source and output streams.
 * @param ms The time in milliseconds to delay each value.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export function delay<T = any>(ms: MaybePromise<number>) {
  return createOperator<T, T>('delay', function (this: Operator, source) {
    const output: Subject<T> = createSubject<T>();
    let resolvedMs: number | undefined = undefined;

    (async () => {
      try {
        resolvedMs = isPromiseLike(ms) ? await ms : ms;

        while (true) {
          const result: IteratorResult<T> = await source.next();
          if (result.done) break;

          // Delay emission
          if (resolvedMs !== undefined) {
            await new Promise((resolve) => setTimeout(resolve, resolvedMs));
          }

          // Emit downstream
          output.next(result.value);
        }
      } catch (err) {
        output.error(err);
      } finally {
        output.complete();
      }
    })();

    return eachValueFrom(output);
  });
}
