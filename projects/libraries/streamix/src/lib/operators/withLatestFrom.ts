import { createPushOperator, isPromiseLike, normalizeError, type Operator } from "../atoms";
import type { Atom } from '../atoms/atom';
import { toAsyncIterable } from '../atoms/pipe';
import { createAsyncCoordinator } from '../utils';

/**
 * Auxiliary input accepted by {@link withLatestFrom}. The scalar branch is guarded
 * so that atoms/iterables are not inferred as the element type itself.
 */
type WithLatestScalar<T> = T extends AsyncIterable<any>
  ? never
  : T extends Iterable<any>
  ? never
  : T extends Atom<any>
  ? never
  : T;

type WithLatestInput<T> =
  | Atom<T>
  | AsyncIterable<T>
  | Iterable<T>
  | Promise<WithLatestInput<T>>
  | WithLatestScalar<T>;

/**
 * Combines the source stream with the latest values from one or more auxiliary streams or promises.
 *
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
 * const clicks = listen(document, 'click');
 * const mouseMoves = listen(document, 'mousemove');
 *
 * pipe(clicks, withLatestFrom(mouseMoves)).subscribe({
 * next: ([clickEvent, lastMouseMove]) => {
 * console.log('Clicked at:', lastMouseMove.clientX, lastMouseMove.clientY);
 * }
 * });
 * ```
 */
export function withLatestFrom<T = any, R extends readonly unknown[] = readonly unknown[]>(
  ...args: { [K in keyof R]: WithLatestInput<R[K]> }
): Operator<T, [T, ...R]>;
export function withLatestFrom<T = any, R extends readonly unknown[] = readonly unknown[]>(
  args: { [K in keyof R]: WithLatestInput<R[K]> }
): Operator<T, [T, ...R]>;
export function withLatestFrom<T = any, R extends readonly unknown[] = readonly unknown[]>(...args: any[]): Operator<T, [T, ...R]> {
  // Normalize parameters immediately and synchronously to prevent execution pipeline lag
  const normalizedInputs = (args.length === 1 && Array.isArray(args[0]))
    ? (args[0] as (WithLatestInput<unknown>[]))
    : (args as (WithLatestInput<unknown>[]));

  return createPushOperator<T, [T, ...R]>("withLatestFrom", (source, output) => {
    const abortController = new AbortController();
    let runner: ReturnType<typeof createAsyncCoordinator<T | R[number]>> | null = null;
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
        const auxIterators = resolvedAux.map((input) =>
          toAsyncIterable(input as any)[Symbol.asyncIterator]() as AsyncIterator<T | R[number]>
        );
        const latestValues = new Array(auxIterators.length).fill(undefined);
        const hasValue = new Array(auxIterators.length).fill(false);

        if (abortController.signal.aborted) return;

        // 3. Prepare auxiliary values before the source can win the race.
        //
        // - For push-based sources (e.g. createAsyncPushable), attach the source
        //   immediately so that emissions that arrive before any auxiliary has a
        //   value are dropped. We only do a synchronous pre-drain of auxiliaries
        //   to avoid dropping source emissions when the auxiliary is synchronous.
        // - For pull-based sources (e.g. from([])), pre-pull each auxiliary fully
        //   before attaching the source. This prevents the synchronous source from
        //   completing before the auxiliaries have produced their first value.
        const sourceIsPush = typeof (source as any).push === 'function';

        if (sourceIsPush) {
          for (let i = 0; i < auxIterators.length; i++) {
            const r = (auxIterators[i] as any).__tryNext?.();
            if (r && !r.done) {
              latestValues[i] = r.value;
              hasValue[i] = true;
            }
          }
        } else {
          for (let i = 0; i < auxIterators.length; i++) {
            const r = await auxIterators[i].next();
            if (r.done) continue;
            latestValues[i] = r.value;
            hasValue[i] = true;
          }
          if (abortController.signal.aborted) return;
        }

        // 4. Build coordinate multiplexer mapping across source and side channels.
        runner = createAsyncCoordinator<T | R[number]>([
          ...auxIterators,
          source as AsyncIterator<T | R[number]>
        ]);
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
              output.fail(ev.error instanceof Error ? ev.error : new Error(String(ev.error)));
            }
            return;
          }

          // Completion control signals
          if (ev.type === 'complete') {
            if (ev.sourceIndex === sourceIndex) {
              // The primary source completed: the output completes regardless
              // of auxiliary streams (which may stay open indefinitely).
              break;
            }
            // An auxiliary completed: keep its latest value and keep mirroring.
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
        if (!isSettled && !output.disposed) {
          isSettled = true;
          output.dispose();
        }
      } catch (err) {
        // Safe lock catchment blocks for out-of-band exceptions during async scheduling phases
        if (!isSettled) {
          isSettled = true;
          output.fail(normalizeError(err));
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
