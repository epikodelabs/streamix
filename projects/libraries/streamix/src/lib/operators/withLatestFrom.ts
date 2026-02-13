import {
  createOperator,
  getIteratorMeta,
  isPromiseLike,
  setValueMeta
} from '../abstractions';
import { eachValueFrom, fromAny } from '../converters';
import { createSubject } from '../subjects';
import { createAsyncCoordinator } from '../utils';

export function withLatestFrom<T = any, R extends readonly unknown[] = any[]>(
  ...args: any[]
) {
  const normalizedInputs = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;

  return createOperator<T, [T, ...R]>("withLatestFrom", function (this: any, source) {
    const output = createSubject<[T, ...R]>();
    const outputIterator = eachValueFrom(output);
    const abortController = new AbortController();

    const iterate = async () => {
      try {
        const resolvedAux = await Promise.all(
          normalizedInputs.map(input => (isPromiseLike(input) ? Promise.resolve(input) : input))
        );

        if (abortController.signal.aborted) return;

        // AUXILIARIES FIRST, SOURCE LAST
        // This ensures that if both emit in the same microtask, 
        // the auxiliary values are captured before the source trigger is processed.
        const auxIterators = resolvedAux.map(input => eachValueFrom(fromAny(input)));
        const allIterators = [...auxIterators, source];
        
        const sourceIndex = allIterators.length - 1;
        const runner = createAsyncCoordinator(allIterators);
        
        const latestValues = new Array(auxIterators.length).fill(undefined);
        const hasValue = new Array(auxIterators.length).fill(false);

        while (true) {
          const { done, value: ev } = await runner.next();
          if (done || abortController.signal.aborted) break;

          if (ev.type === "value") {
            if (ev.sourceIndex === sourceIndex) {
              // Primary Trigger
              // FIX: Must have at least one auxiliary stream and all must have values.
              if (hasValue.length > 0 && hasValue.every(Boolean)) {
                const combinedValue = [ev.value, ...latestValues] as [T, ...R];
                
                const triggerMeta = getIteratorMeta(source) || {
                  valueId: 'unknown',
                  operatorIndex: 0,
                  operatorName: 'source'
                };

                const nextIndex = triggerMeta.operatorIndex + 1;

                // Tag the tuple value with metadata
                const taggedValue = setValueMeta(
                  combinedValue, 
                  { valueId: triggerMeta.valueId }, 
                  nextIndex, 
                  'withLatestFrom'
                );
                
                output.next(taggedValue);
              }
            } else {
              // Auxiliary Update
              // ev.sourceIndex corresponds to the position in auxIterators
              latestValues[ev.sourceIndex] = ev.value;
              hasValue[ev.sourceIndex] = true;
            }
          } else if (ev.type === "error") {
            output.error(ev.error instanceof Error ? ev.error : new Error(String(ev.error)));
            return;
          }
        }
        if (!output.completed()) output.complete();
      } catch (err) {
        if (!output.completed()) output.error(err instanceof Error ? err : new Error(String(err)));
      } finally {
        abortController.abort();
        source.return?.();
      }
    };

    iterate();
    return outputIterator;
  });
}