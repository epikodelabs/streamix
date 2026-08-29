import { createOperator, DONE, NEXT, normalizeError, type Operator } from "../atoms";
import type { PipeInput } from "../atoms/pipe";
import { from } from "../factories";
import { createAsyncCoordinator } from "../utils";

/**
 * Take values from the source until a notifier emits.
 *
 * This operator forwards values from the source stream until the notifier
 * emits its first value. Once the notifier emits, the operator completes
 * immediately and unsubscribes from the source.
 *
 * Important semantics:
 * - If notifier emits before any source values, no source values are emitted
 * - If the notifier completes without ever emitting, the operator keeps
 *   mirroring the source (only an emission triggers the stop)
 * - If source completes before notifier emits, operator completes normally
 * - Errors from either source or notifier are propagated
 *
 * @template T Source/output value type.
 * @template N Notifier value type (ignored by this operator).
 * @param notifier A `AtomBase<N>` or `Promise<N>` that signals when to stop taking.
 * @returns An `Operator<T, T>` that can be used in a stream pipeline.
 */
export function takeUntil<T = any, N = any>(
  notifier: PipeInput<N> | Promise<N>
): Operator<T, T> {
  return createOperator<T, T>("takeUntil", function (source: AsyncIterator<T>) {
    const notifierIt = from(notifier)[Symbol.asyncIterator]();
    const runner = createAsyncCoordinator<T | N>([
      source as AsyncIterator<T | N>,
      notifierIt as AsyncIterator<T | N>
    ]);
    const SOURCE_INDEX = 0;

    let isDone = false;

    const close = async () => {
      isDone = true;
      await runner.return?.();
      return DONE;
    };

    const closeSync = () => {
      isDone = true;
      runner.return?.().catch(() => {});
      return DONE;
    };

    const iterator: AsyncIterator<T> & {
      __tryNext?: () => IteratorResult<T> | null;
      __hasBufferedValues?: () => boolean;
    } = {
      async next() {
        if (isDone) return DONE;

        while (true) {
          const result = await runner.next();
          
          if (result.done) {
            isDone = true;
            return DONE;
          }

          const event = result.value;

          if (event.type === 'error') {
            await close();
            throw normalizeError(event.error);
          }

          if (event.type === 'complete') {
            if (event.sourceIndex === SOURCE_INDEX) return close();
            continue;
          }

          if (event.sourceIndex === SOURCE_INDEX) return NEXT(event.value as T);
          return close();
        }
      },

      __tryNext: () => {
        if (isDone) return DONE;
        if (!runner.__tryNext) return null;

        while (true) {
          const result = runner.__tryNext();
          if (!result || result.done) break;

          const event = result.value;

          if (event.type === 'error') {
            closeSync();
            throw normalizeError(event.error);
          }

          if (event.type === 'complete') {
            if (event.sourceIndex === SOURCE_INDEX) return closeSync();
            continue;
          }

          if (event.sourceIndex === SOURCE_INDEX) return NEXT(event.value as T);
          return closeSync();
        }
        
        return isDone ? DONE : null;
      },

      __hasBufferedValues: () => runner.__hasBufferedValues?.() ?? false,

      async return(value?: any) {
        if (isDone) return value !== undefined ? { value, done: true } : DONE;
        isDone = true;
        await runner.return?.();
        
        return value !== undefined ? { value, done: true } : DONE;
      },

      async throw(err?: any) {
        const error = normalizeError(err);
        if (isDone) return Promise.reject(error);
        isDone = true;
        await runner.return?.();
        
        return Promise.reject(error);
      }
    };

    return iterator;
  });
}
