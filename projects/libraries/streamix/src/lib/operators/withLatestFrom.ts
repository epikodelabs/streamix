import {
  createPushOperator,
  isPromiseLike,
  isStreamLike,
  type Stream
} from '../abstractions';
import { fromAny } from '../converters';
import { createAsyncCoordinator, normalizeError } from '../utils';

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
  const normalizedInputs = (args.length === 1 && Array.isArray(args[0]))
    ? (args[0] as (Stream<unknown> | Promise<unknown>)[])
    : (args as (Stream<unknown> | Promise<unknown>)[]);

  return createPushOperator<T, [T, ...R]>("withLatestFrom", (source, output) => {
    const abortController = new AbortController();
    let runner: ReturnType<typeof createAsyncCoordinator<unknown>> | null = null;
    let isSettled = false;

    const completeOutput = () => {
      if (!isSettled && !output.completed()) {
        isSettled = true;
        output.complete();
      }
    };

    const errorOutput = (err: unknown) => {
      if (!isSettled) {
        isSettled = true;
        output.error(normalizeError(err));
      }
    };

    void (async () => {
      try {
        if (abortController.signal.aborted) return;

        const resolvedInputs: unknown[] = [];
        for (const input of normalizedInputs) {
          resolvedInputs.push(isPromiseLike(input) ? await Promise.resolve(input) : input);
        }

        if (abortController.signal.aborted) return;

        const latestValues = new Array(resolvedInputs.length).fill(undefined);
        const hasValue = new Array(resolvedInputs.length).fill(false);
        const auxIterators: AsyncIterator<unknown>[] = [];
        const auxSlots: number[] = [];

        const isIterableInput = (input: unknown) => {
          if (input == null || typeof input === 'string') return false;
          const candidate = input as any;
          return typeof candidate[Symbol.asyncIterator] === 'function'
            || typeof candidate[Symbol.iterator] === 'function';
        };

        // Plain values (including promise-resolved values) are already "latest".
        // Stream/iterable auxiliaries stay live in the coordinator. Crucially, we
        // do not await their first emission: a source that completes while an
        // auxiliary never emits must still complete the combined stream.
        resolvedInputs.forEach((input, slot) => {
          if (!isStreamLike(input) && !isIterableInput(input)) {
            latestValues[slot] = input;
            hasValue[slot] = true;
            return;
          }

          auxSlots.push(slot);
          auxIterators.push(
            fromAny(input as any)[Symbol.asyncIterator]() as AsyncIterator<unknown>
          );
        });

        if (abortController.signal.aborted) return;

        const sourceIndex = auxIterators.length;
        runner = createAsyncCoordinator<unknown>([
          ...auxIterators,
          source as AsyncIterator<unknown>
        ]);

        while (!abortController.signal.aborted) {
          const nextEvent = await runner.next();
          if (nextEvent.done || abortController.signal.aborted) break;

          const event = nextEvent.value;

          if (event.type === "error") {
            errorOutput(event.error);
            return;
          }

          if (event.sourceIndex === sourceIndex) {
            if (event.type === "complete") {
              completeOutput();
              return;
            }

            if (hasValue.length > 0 && hasValue.every(Boolean)) {
              output.push([event.value, ...latestValues] as [T, ...R]);
            }
            continue;
          }

          if (event.type === "value") {
            const slot = auxSlots[event.sourceIndex];
            latestValues[slot] = event.value;
            hasValue[slot] = true;
          }
        }

        completeOutput();
      } catch (err) {
        errorOutput(err);
      } finally {
        abortController.abort();
        void runner?.return?.();
      }
    })();

    return () => {
      abortController.abort();
      void runner?.return?.();
    };
  });
}