import { createOperator, getIteratorMeta, isPromiseLike, setIteratorMeta, type MaybePromise, type Operator } from '../abstractions';
import { eachValueFrom } from '../converters';
import { createSubject, type Subject } from '../subjects';

/**
 * Creates a throttle operator that emits the first value immediately, then ignores subsequent
 * values for the specified duration. If new values arrive during the cooldown, the
 * last one is emitted after the cooldown expires (trailing emit).
 *
 * This version tracks pending results and phantoms in PipeContext.
 *
 * @template T The type of values emitted by the source and output.
 * @param duration The throttle duration in milliseconds.
 * @returns An Operator instance that applies throttling to the source stream.
 */
export const throttle = <T = any>(duration: MaybePromise<number>) =>
  createOperator<T, T>('throttle', function (this: Operator, source) {
    const output: Subject<T> = createSubject<T>();
    const outputIterator = eachValueFrom(output);
    
    let lastEmit = 0;
    let pendingResult: (IteratorResult<T> & { meta?: ReturnType<typeof getIteratorMeta> }) | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let resolvedDuration: number | undefined = undefined;

    const flushPending = () => {
      if (pendingResult !== undefined) {
        const value = pendingResult.value!;
        
        if (pendingResult.meta) {
          setIteratorMeta(
            outputIterator,
            pendingResult.meta,
            pendingResult.meta.operatorIndex,
            pendingResult.meta.operatorName
          );
        }

        // Emit value directly - tracer tracks it via inputQueue
        output.next(value);
        pendingResult = undefined;
      }
      timer = null;
      lastEmit = Date.now();
    };

    (async () => {
      try {
        resolvedDuration = isPromiseLike(duration) ? await duration : duration;

        while (true) {
          const result: IteratorResult<T> = await source.next();
          if (result.done) break;

          const now = Date.now();
          if (resolvedDuration === undefined) {
            // If duration isn't available, we can't throttle properly yet?
            // Original code had this check to possibly consume stream while waiting for duration (unlikely)
            // or just safe-guard. 
            // We just buffer it.
            pendingResult = result;
             const meta = getIteratorMeta(source);
             if (meta) {
               (pendingResult as any).meta = meta;
             }
            getIteratorMeta(source);
            continue;
          }

          if (now - lastEmit >= resolvedDuration) {
            // Emit immediately (Leading edge)
            const value = result.value;
            const meta = getIteratorMeta(source);

            if (meta) {
              setIteratorMeta(
                outputIterator,
                meta,
                meta.operatorIndex,
                meta.operatorName
              );
            }
            
            // Emit value directly - tracer tracks it via inputQueue
            output.next(value);
            lastEmit = now;
          } else {
            // Throttling - buffer as trailing
            pendingResult = result;
            const meta = getIteratorMeta(source);
            
            if (meta) {
              (pendingResult as any).meta = meta;
            }

            // Schedule trailing emit
            if (!timer) {
              const delay = resolvedDuration - (now - lastEmit);
              timer = setTimeout(flushPending, delay);
            }
          }
        }

        // Source completed – flush trailing pending
        if (pendingResult !== undefined) flushPending();
      } catch (err) {
        output.error(err);
      } finally {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        output.complete();
      }
    })();

    return outputIterator;
  });
