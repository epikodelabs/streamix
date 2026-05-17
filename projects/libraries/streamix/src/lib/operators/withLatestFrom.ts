import {
  createPushOperator,
  isPromiseLike,
  Stream
} from '../abstractions';
import { eachValueFrom, fromAny } from '../converters';
import { createAsyncCoordinator } from '../utils';

/**
 * Combines the source stream with the latest values from one or more auxiliary streams or promises.
 *
 * @description
 * When the source stream emits a value, this operator emits a tuple containing that source value 
 * along with the most recent values from each auxiliary input. 
 *
 * @typeParam T - The type of values emitted by the source stream.
 * @typeParam R - A readonly array/tuple representing the types emitted by the auxiliary streams.
 * @param args - One or more streams, promises, or an array of streams/promises whose latest values 
 * will be combined with the source value.
 * @returns A push operator function that transforms the source stream into a stream of combined tuples.
 *
 * @example
 * ```ts
 * const clicks = fromEvent(document, 'click');
 * const mouseMoves = fromEvent(document, 'mousemove');
 *
 * clicks.pipe(withLatestFrom(mouseMoves)).subscribe({
 * next: ([clickEvent, lastMouseMove]) => {
 * console.log('Clicked at:', lastMouseMove.clientX, lastMouseMove.clientY);
 * }
 * });
 * ```
 */
export function withLatestFrom<T = any, R extends readonly unknown[] = any[]>(
  ...args: any[]
) {
  // Normalize parameters immediately and synchronously to prevent execution pipeline lag
  const normalizedInputs = (args.length === 1 && Array.isArray(args[0])) 
    ? (args[0] as (Stream<unknown> | Promise<unknown>)[]) 
    : (args as (Stream<unknown> | Promise<unknown>)[]);

  return createPushOperator<T, [T, ...R]>("withLatestFrom", (source, output) => {
    const abortController = new AbortController();
    let runner: ReturnType<typeof createAsyncCoordinator> | null = null;
    let isSettled = false;

    void (async () => {
      try {
        if (abortController.signal.aborted) return;

        // 1. Concurrently resolve promises or pass streams down to standard token format
        const resolvedAux: unknown[] = [];
        for (const input of normalizedInputs) {
          resolvedAux.push(isPromiseLike(input) ? await Promise.resolve(input) : input);
        }

        // Post-await safety guard
        if (abortController.signal.aborted) return;

        // 2. Initialize iterators and track baseline structural dimensions
        const auxIterators = resolvedAux.map((input) => eachValueFrom(fromAny(input)));
        const latestValues = new Array(auxIterators.length).fill(undefined);
        const hasValue = new Array(auxIterators.length).fill(false);

        // 3. Pre-warm auxiliary streams to catch any initial synchronous values safely
        const initialAuxValues = await Promise.all(auxIterators.map((iterator) => iterator.next()));
        for (let index = 0; index < initialAuxValues.length; index++) {
          const result = initialAuxValues[index];
          if (!result.done) {
            latestValues[index] = result.value;
            hasValue[index] = true;
          }
        }

        // Post-warming check to ensure downstream didn't unsubscribe during the initialization microtasks
        if (abortController.signal.aborted) return;

        // 4. Synchronous optimization lookahead hook
        const sourceWithSyncPull = source as AsyncIterator<T> & { __tryNext?: () => IteratorResult<T> | null };
        if (hasValue.length > 0 && sourceWithSyncPull.__tryNext) {
          while (true) {
            let buffered: IteratorResult<T> | null;
            try {
              buffered = sourceWithSyncPull.__tryNext();
            } catch (err) {
              if (!isSettled) {
                isSettled = true;
                output.error(err instanceof Error ? err : new Error(String(err)));
              }
              return;
            }
            if (!buffered || buffered.done) break;
            if ((buffered as any).dropped) {
              output.drop(buffered.value as any);
              continue;
            }
          }
        }

        if (abortController.signal.aborted) return;

        // 5. Build coordinate multiplexer mapping across source and side channels
        runner = createAsyncCoordinator([...auxIterators, source]);
        const sourceIndex = auxIterators.length;

        // 6. Core Coordinator Event Processing Loop
        while (!abortController.signal.aborted) {
          const nextEvent = await runner.next();
          if (nextEvent.done || abortController.signal.aborted) break;

          const ev = nextEvent.value;
          
          // Handle inner or stream propagation errors cleanly
          if (ev.type === 'error') {
            if (!isSettled) {
              isSettled = true;
              output.error(ev.error instanceof Error ? ev.error : new Error(String(ev.error)));
            }
            return;
          }

          // Disregard control signals
          if (ev.type !== 'value') {
            continue;
          }

          // Propagate dropped frames from upstream
          if (ev.dropped) {
            output.drop(ev.value as any);
            continue;
          }

          // Case A: Event originates from the primary source stream
          if (ev.sourceIndex === sourceIndex) {
            // Only emit if all auxiliary streams have recorded at least one historical value
            if (hasValue.length > 0 && hasValue.every(Boolean)) {
              output.push([ev.value, ...latestValues] as [T, ...R]);
            }
            continue;
          }

          // Case B: Event originates from an auxiliary/side channel stream
          latestValues[ev.sourceIndex] = ev.value;
          hasValue[ev.sourceIndex] = true;
        }

        // 7. Loop closed cleanly without error triggers -> Complete pipeline execution
        if (!isSettled && !output.completed()) {
          isSettled = true;
          output.complete();
        }
      } catch (err) {
        // Safe lock catchment blocks for out-of-band exceptions during async scheduling phases
        if (!isSettled) {
          isSettled = true;
          output.error(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        abortController.abort();
        void runner?.return?.();
      }
    })();

    /**
     * Synchronous pipeline teardown handler returned to the engine infrastructure.
     */
    return () => {
      abortController.abort();
      void runner?.return?.();
    };
  });
}