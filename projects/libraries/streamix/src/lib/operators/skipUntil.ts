import { createOperator, getCurrentEmissionStamp, getIteratorEmissionStamp, getIteratorMeta, setIteratorMeta, setValueMeta, type Operator, type Stream } from '../abstractions';
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
    let openedAtStamp: number | null = null;
    let canEmit = false;
    let notifierSubscription: any;
    let pendingUnsubscribe = false;
    let notifierError: any = null;
    let notifierErrorAtStamp: number | null = null;

    let signalResolve: () => void;
    let signalReject: (err: any) => void;
    const notifierSignal = new Promise<void>((resolve, reject) => {
      signalResolve = resolve;
      signalReject = reject;
    });
    notifierSignal.catch(() => {});

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
        const stamp = getCurrentEmissionStamp();
        canEmit = true;
        if (stamp !== null) {
          openedAtStamp = stamp;
        } else {
          // cold notifier, gate purely by boolean
        }
        signalResolve();
        requestUnsubscribe();
      },
      error: (err) => {
        notifierError = err;
        const stamp = getCurrentEmissionStamp();
        if (stamp !== null) notifierErrorAtStamp = stamp;
        signalReject(err);
        requestUnsubscribe();
      },
      complete: () => {
        requestUnsubscribe();
      },
    });

    if (pendingUnsubscribe) {
      requestUnsubscribe();
    }

    const startSource = async (deferStart: boolean) => {
      if (deferStart) {
        await Promise.resolve();
      }
      try {
        let activeNextPromise: Promise<IteratorResult<T>> | null = null;
        
        while (true) {
          if (notifierError && notifierErrorAtStamp === null) throw notifierError;

          let resultValue: IteratorResult<T> | undefined;

          if (canEmit) {
             if (activeNextPromise) {
               resultValue = await activeNextPromise;
               activeNextPromise = null;
             } else {
               resultValue = await source.next();
             }
          } else {
             if (!activeNextPromise) {
               activeNextPromise = source.next();
             }
             
             const raceResult = await Promise.race([
                activeNextPromise.then(res => ({ type: 'source', res } as const)),
                notifierSignal.then(
                    () => ({ type: 'signal' } as const),
                    (err) => ({ type: 'error', err } as const)
                )
             ]);

             if (raceResult.type === 'signal' || raceResult.type === 'error') {
                 // Check if source value is also ready (rescue)
                 const rescue = await Promise.race([
                    activeNextPromise.then(res => ({ res })),
                    new Promise<{res: IteratorResult<T>} | null>(resolve => setTimeout(() => resolve(null), 0))
                 ]);
                 
                 if (rescue) {
                    resultValue = rescue.res;
                    activeNextPromise = null;
                 } else {
                    // Source value not ready.
                    if (raceResult.type === 'error') throw raceResult.err;
                    // If signal (Start), we loop back. canEmit should be true now.
                    continue;
                 }
             } else {
                resultValue = raceResult.res;
                activeNextPromise = null;
             }
          }

          const { done, value } = resultValue!;
          if (done) break;
          const stamp = getIteratorEmissionStamp(source);

          // Check error condition first?
          // If we have a value.
          // If notifier failed at stamp X.
          // If value stamp < X: Skip? No, if we haven't started, we skip.
          // If value stamp >= X: Throw error?
          
          // Re-evaluate 'shouldEmit' logic with error handling.
          
          if (stamp !== undefined) {
              if (notifierError && notifierErrorAtStamp === null) throw notifierError;
              const s = Math.abs(stamp);
              
              if (notifierErrorAtStamp !== null && s >= Math.abs(notifierErrorAtStamp)) throw notifierError;
          } else {
              if (notifierError) throw notifierError;
          }

          const shouldEmit =
            stamp === undefined
              ? canEmit
              : stamp > 0
                ? (openedAtStamp !== null ? stamp > openedAtStamp : canEmit)
                : canEmit;

          if (shouldEmit) {
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
    };

    // Process source.
    // For cold notifiers (`from([...])`, promises) we yield one microtask so the notifier
    // can establish `canEmit` before a cold source begins emitting.
    const isNotifierSubject = !!notifier && typeof notifier === 'object' && (notifier as any).type === 'subject';
    if (isNotifierSubject) {
      void startSource(false);
    } else {
      queueMicrotask(() => void startSource(true));
    }

    return outputIterator;
  });
}
