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
 * When the source stream emits a value, emits a tuple containing the source value and the most recent values
 * from each auxiliary stream or promise. No value is emitted until all auxiliary streams have emitted at least once.
 *
 * If any auxiliary stream or promise errors, the output stream errors. If the source completes, the output completes.
 *
 * @typeParam T - The type of values emitted by the source stream.
 * @typeParam R - The tuple of types emitted by the auxiliary streams.
 * @param args - One or more streams or promises whose latest values will be combined with the source value.
 * @returns An operator function that emits a tuple of the source value and the latest values from each auxiliary input.
 *
 * @example
 * ```ts
 * // Combine clicks with the latest mouse position
 * clicks.pipe(withLatestFrom(mouseMoves))
 * // Emits: [clickEvent, latestMousePosition]
 * ```
 */
export function withLatestFrom<T = any, R extends readonly unknown[] = any[]>(
  ...args: (Stream<T> | Promise<T>)[]
) {
  const normalizedInputs = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;

  return createPushOperator<T, [T, ...R]>("withLatestFrom", (source, output) => {
    const abortController = new AbortController();
    let runner: ReturnType<typeof createAsyncCoordinator> | null = null;

    void (async () => {
      try {
        const resolvedAux: unknown[] = [];
        for (const input of normalizedInputs) {
          resolvedAux.push(isPromiseLike(input) ? await Promise.resolve(input) : input);
        }

        if (abortController.signal.aborted) return;

        const auxIterators = resolvedAux.map((input) => eachValueFrom(fromAny(input)));
        const latestValues = new Array(auxIterators.length).fill(undefined);
        const hasValue = new Array(auxIterators.length).fill(false);

        const initialAuxValues = await Promise.all(auxIterators.map((iterator) => iterator.next()));
        for (let index = 0; index < initialAuxValues.length; index++) {
          const result = initialAuxValues[index];
          if (result.done) {
            continue;
          }
          latestValues[index] = result.value;
          hasValue[index] = true;
        }

        const sourceWithSyncPull = source as AsyncIterator<T> & { __tryNext?: () => IteratorResult<T> | null };
        if (hasValue.length > 0 && sourceWithSyncPull.__tryNext) {
          while (true) {
            let buffered: IteratorResult<T> | null;
            try {
              buffered = sourceWithSyncPull.__tryNext();
            } catch (err) {
              output.error(err instanceof Error ? err : new Error(String(err)));
              return;
            }

            if (!buffered || buffered.done) {
              break;
            }
          }
        }

        runner = createAsyncCoordinator([...auxIterators, source]);

        const sourceIndex = auxIterators.length;

        while (!abortController.signal.aborted) {
          const nextEvent = await runner.next();
          if (nextEvent.done) break;

          const ev = nextEvent.value;
          if (ev.type === 'error') {
            output.error(ev.error instanceof Error ? ev.error : new Error(String(ev.error)));
            return;
          }

          if (ev.type !== 'value') {
            continue;
          }

          if (ev.dropped) {
            continue;
          }

          if (ev.sourceIndex === sourceIndex) {
            if (hasValue.length > 0 && hasValue.every(Boolean)) {
              output.push([ev.value, ...latestValues] as [T, ...R]);
            }
            continue;
          }

          latestValues[ev.sourceIndex] = ev.value;
          hasValue[ev.sourceIndex] = true;
        }

        if (!output.completed()) output.complete();
      } catch (err) {
        output.error(err instanceof Error ? err : new Error(String(err)));
      } finally {
        abortController.abort();
        await runner?.return?.();
      }
    })();

    return async () => {
      abortController.abort();
      await runner?.return?.();
    };
  });
}
