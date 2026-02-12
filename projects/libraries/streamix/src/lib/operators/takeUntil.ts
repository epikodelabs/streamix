import {
  createOperator,
  DONE,
  getIteratorEmissionStamp,
  getIteratorMeta,
  nextEmissionStamp,
  setIteratorEmissionStamp,
  tagValue,
  type Operator,
  type Stream
} from "../abstractions";
import { fromAny } from "../converters";
import { createAsyncCoordinator } from "../utils";

/**
 * Take values from the source until a notifier emits.
 *
 * This operator forwards values from the source stream until the notifier
 * emits its first value or completes. Once the notifier emits, the operator
 * completes immediately and unsubscribes from the source.
 *
 * Important semantics:
 * - If notifier emits before any source values, no source values are emitted
 * - If source completes before notifier emits, operator completes normally
 * - Errors from either source or notifier are propagated
 *
 * @template T Source/output value type.
 * @param notifier A `Stream<any>` that signals when to stop taking.
 * @returns An `Operator<T, T>` that can be used in a stream pipeline.
 */
export function takeUntil<T = any>(
  notifier: Stream<any> | Promise<any>
): Operator<T, T> {
  return createOperator<T, T>("takeUntil", function (source: AsyncIterator<T>) {
    const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();
    const runner = createAsyncCoordinator([source, notifierIt]);

    let isDone = false;

    const iterator: AsyncIterator<T> & {
      __tryNext?: () => IteratorResult<T> | null;
      __hasBufferedValues?: () => boolean;
    } = {
      async next() {
        if (isDone) return DONE;

        while (true) {
          const result = await runner.next();
          
          if (result.done) {
            // Both sources completed - this means notifier never emitted and source is done
            isDone = true;
            return DONE;
          }

          const event = result.value;
          
          switch (event.type) {
            case 'value':
              if (event.sourceIndex === 0) {
                // Source value - forward it
                const stamp = getIteratorEmissionStamp(runner as any) ?? nextEmissionStamp();
                const meta = getIteratorMeta(runner as any);
                setIteratorEmissionStamp(iterator, stamp);
                return { 
                  done: false, 
                  value: tagValue(iterator, event.value, meta) 
                };
              } else {
                // Notifier emitted - stop immediately
                isDone = true;
                
                // Clean up notifier iterator
                await notifierIt.return?.();
                
                // Signal completion
                return DONE;
              }
              
            case 'complete':
              if (event.sourceIndex === 0) {
                // Source completed normally - we're done
                isDone = true;
                return DONE;
              } else {
                // Notifier completed without emitting - ignore, keep taking from source
                // Just continue
              }
              break;
              
            case 'error':
              isDone = true;
              throw event.error;
          }
        }
      },

      __tryNext: () => {
        if (isDone) return DONE;
        if (!runner.__tryNext) return null;

        while (true) {
          const result = runner.__tryNext();
          if (!result || result.done) break;

          const event = result.value;
          
          switch (event.type) {
            case 'value':
              if (event.sourceIndex === 0) {
                const stamp = getIteratorEmissionStamp(runner as any) ?? nextEmissionStamp();
                const meta = getIteratorMeta(runner as any);
                setIteratorEmissionStamp(iterator, stamp);
                return { 
                  done: false, 
                  value: tagValue(iterator, event.value, meta) 
                };
              } else {
                isDone = true;
                // Can't await in sync method, but we can schedule cleanup
                notifierIt.return?.().catch(() => {});
                return DONE;
              }
              
            case 'complete':
              if (event.sourceIndex === 0) {
                isDone = true;
                return DONE;
              }
              // Ignore notifier completion
              break;
              
            case 'error':
              isDone = true;
              throw event.error;
          }
        }
        
        return isDone ? DONE : null;
      },

      __hasBufferedValues: () => {
        return runner.__hasBufferedValues?.() ?? false;
      },

      async return(value?: any) {
        if (isDone) return value !== undefined ? { value, done: true } : DONE;
        isDone = true;
        
        // Clean up both iterators
        await runner.return?.();
        await notifierIt.return?.();
        
        return value !== undefined ? { value, done: true } : DONE;
      },

      async throw(err?: any) {
        if (isDone) return Promise.reject(err);
        isDone = true;
        
        await runner.throw?.(err);
        await notifierIt.return?.();
        
        return Promise.reject(err);
      }
    };

    return iterator;
  });
}