import { createOperator, getIteratorMeta, setIteratorMeta, setValueMeta, type Operator, type Stream } from '../abstractions';
import { eachValueFrom, fromAny } from '../converters';
import { createSubject } from '../subjects';

/**
 * Creates a stream operator that skips all values from the source stream until
 * a value is emitted by a `notifier` stream.
 *
 * This operator controls the flow of data based on an external signal. It initially
 * drops all values from the source stream. It also subscribes to a separate `notifier`
 * stream. When the notifier emits its first value, the operator's internal state
 * changes, allowing all subsequent values from the source stream to pass through.
 *
 * This is useful for delaying the start of a data-intensive process until a specific
 * condition is met, for example, waiting for a user to click a button or for
 * an application to finish loading.
 *
 * @template T The type of the values in the source and output streams.
 * @param notifier The stream (or promise) that, upon its first emission, signals that
 * the operator should stop skipping values.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export function skipUntil<T = any, R = T>(notifier: Stream<R> | Promise<R>) {
  return createOperator<T, T>('skipUntil', function (this: Operator, source: AsyncIterator<T>) {
    const output = createSubject<T>();
    const outputIterator = eachValueFrom(output);
    let canEmit = false;
    let notifierSubscription: any;
    let pendingUnsubscribe = false;

    const requestUnsubscribe = (): void => {
      if (notifierSubscription) {
        const sub = notifierSubscription;
        notifierSubscription = undefined;
        sub.unsubscribe();
        return;
      }

      pendingUnsubscribe = true;
    };

    // Subscribe to notifier
    notifierSubscription = fromAny(notifier).subscribe({
      next: () => {
        canEmit = true;
        requestUnsubscribe();
      },
      error: (err) => {
        requestUnsubscribe();
        if (!output.completed()) output.error(err);
      },
      complete: () => {
        requestUnsubscribe();
      },
    });

    if (pendingUnsubscribe) {
      requestUnsubscribe();
    }

    // Process source
    (async () => {
      try {
        while (true) {
          const { done, value } = await source.next();
          if (done) break;
          if (canEmit) {
            const meta = getIteratorMeta(source);
            let outputValue = value;
            if (meta) {
              setIteratorMeta(
                outputIterator,
                { valueId: meta.valueId },
                meta.operatorIndex,
                meta.operatorName
              );
              outputValue = setValueMeta(outputValue, { valueId: meta.valueId }, meta.operatorIndex, meta.operatorName);
            }
            output.next(outputValue);
          }
        }
      } catch (err) {
        if (!output.completed()) output.error(err);
      } finally {
        if (!output.completed()) output.complete();
        requestUnsubscribe();
      }
    })();

    return outputIterator;
  });
}
