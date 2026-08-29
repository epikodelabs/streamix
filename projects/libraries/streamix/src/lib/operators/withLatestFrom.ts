import { createPushOperator, isPromiseLike, normalizeError, type Operator } from "../atoms";
import type { Atom } from '../atoms/atom';
import { toAsyncIterable } from '../atoms/pipe';
import { createAsyncCoordinator } from '../utils';
import { isAtomLike } from '../utils/helpers';

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

        // 2. Plain values (including promise-resolved plain values) are already
        // "latest". Live atoms/iterables remain coordinated with the source.
        // Never await the first value of a live auxiliary here: the primary
        // source must still be able to complete if an auxiliary never emits.
        const latestValues = new Array(resolvedAux.length).fill(undefined);
        const hasValue = new Array(resolvedAux.length).fill(false);
        const auxIterators: AsyncIterator<T | R[number]>[] = [];
        const auxSlots: number[] = [];

        const isLiveAuxiliary = (input: unknown): boolean => {
          if (isAtomLike(input)) return true;
          if (input == null || typeof input === 'string') return false;
          const candidate = input as any;
          return typeof candidate[Symbol.asyncIterator] === 'function'
            || typeof candidate[Symbol.iterator] === 'function';
        };

        resolvedAux.forEach((input, slot) => {
          if (!isLiveAuxiliary(input)) {
            latestValues[slot] = input;
            hasValue[slot] = true;
            return;
          }

          auxSlots.push(slot);
          auxIterators.push(
            toAsyncIterable(input as any)[Symbol.asyncIterator]() as AsyncIterator<T | R[number]>
          );
        });

        if (abortController.signal.aborted) return;

        // 3. Coordinate live auxiliaries and the primary source concurrently.
        // Auxiliaries are registered first, preserving deterministic ordering
        // for synchronous sources without blocking on silent auxiliaries.
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

          // Case B: Event originates from an auxiliary/side channel stream.
          // Scalar auxiliaries have no coordinator slot, so map back to the
          // original argument position before updating the latest snapshot.
          const slot = auxSlots[ev.sourceIndex];
          latestValues[slot] = ev.value;
          hasValue[slot] = true;
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