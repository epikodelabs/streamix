import { createOperator, getCurrentEmissionStamp, getIteratorEmissionStamp, getIteratorMeta, setIteratorMeta, setValueMeta, type Operator, type Stream } from '../abstractions';
import { eachValueFrom, fromAny } from '../converters';
import { createSubject } from '../subjects';

/**
 * Creates a stream operator that emits all values from the source stream until
 * a value is emitted by a `notifier` stream.
 *
 * This operator controls the lifespan of a stream based on an external signal.
 * It consumes and re-emits values from the source until the `notifier` stream
 * emits its first value. As soon as that happens, the operator completes the
 * output stream and unsubscribes from both the source and the notifier.
 *
 * This is useful for automatically stopping an operation when a certain condition
 * is met, such as waiting for a user to close a dialog or for an animation to complete.
 *
 * @template T The type of the values in the source and output streams.
 * @param notifier The stream (or promise) that, upon its first emission, signals that
 * the operator should complete.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export function takeUntil<T = any, R = T>(notifier: Stream<R> | Promise<R>) {
  return createOperator<T, T>('takeUntil', function (this: Operator, source: AsyncIterator<T>) {
    const output = createSubject<T>();
    const outputIterator = eachValueFrom(output);

    let stopAtStamp: number | null = null;
    let notifierError: any = null;
    let notifierErrorAtStamp: number | null = null;
    let stop = false;

    let notifierSubscription: any;
    
    let signalResolve: () => void;
    let signalReject: (err: any) => void;
    
    // Signal used to unblock the iteration loop if the notifier emits/errors
    const notifierSignal = new Promise<void>((resolve, reject) => {
      signalResolve = resolve;
      signalReject = reject;
    });
    notifierSignal.catch(() => {}); // Prevent unhandled rejection warnings

    const requestUnsubscribe = (): void => {
      if (notifierSubscription) {
        const sub = notifierSubscription;
        notifierSubscription = undefined;
        sub.unsubscribe();
      }
    };

    const processNext = (value: T): void => {
      const meta = getIteratorMeta(source);
      let outputValue = value;
      if (meta) {
        setIteratorMeta(outputIterator, { valueId: meta.valueId }, meta.operatorIndex, meta.operatorName);
        outputValue = setValueMeta(outputValue, { valueId: meta.valueId }, meta.operatorIndex, meta.operatorName);
      }
      output.next(outputValue);
    };

    notifierSubscription = fromAny(notifier).subscribe({
      next: () => {
        const stamp = getCurrentEmissionStamp();
        if (stamp !== null) {
          stopAtStamp = stamp;
          signalResolve();
        } else {
          stop = true;
          signalResolve();
        }
        requestUnsubscribe();
      },
      error: (err) => {
        const stamp = getCurrentEmissionStamp();
        notifierError = err;
        if (stamp !== null) {
          notifierErrorAtStamp = stamp;
          signalReject(err);
        } else {
          stop = true;
          // In Cold mode without stamps, we can fault immediately? 
          // Or stick to signalReject which will throw in the loop.
          // For safety against deadlocks, signalReject is sufficient to wake the loop.
          // But strict error propagation normally happens via output.error.
          // However, the loop catches the error and calls output.error.
          signalReject(err);
        }
        requestUnsubscribe();
      },
      complete: () => requestUnsubscribe(),
    });

    const iterate = async (): Promise<void> => {
      try {
        while (true) {
          if (stop) break;

          let syncResult: IteratorResult<T> | null = null;
          if (typeof (source as any).__tryNext === 'function') {
             try {
               syncResult = (source as any).__tryNext();
             } catch (e) {
                if (!output.completed()) output.error(e);
                return;
             }
          }

          if (syncResult) {
             const { done, value } = syncResult;
             if (done) break;

             const stamp = getIteratorEmissionStamp(source);
             if (stamp !== undefined) {
                if (stop) break;
                if (notifierError && notifierErrorAtStamp === null) throw notifierError;
                const s = Math.abs(stamp);
                if (stopAtStamp !== null && s >= Math.abs(stopAtStamp)) break;
                if (notifierErrorAtStamp !== null && s >= Math.abs(notifierErrorAtStamp)) throw notifierError;
                processNext(value);
             } else {
                if (stop) break;
                if (notifierError) throw notifierError;
                processNext(value);
             }
             continue;
          }

          if (notifierError && notifierErrorAtStamp === null) throw notifierError;

          const nextPromise = source.next();
          
          const raceResult = await Promise.race([
            nextPromise.then(
              res => ({ type: 'source', res } as const),
              err => ({ type: 'sourceError', err } as const)
            ),
            notifierSignal.then(
              () => ({ type: 'signal' } as const),
              err => ({ type: 'error', err } as const)
            )
          ]);

          let resultValue: IteratorResult<T> | undefined;

          if (raceResult.type === 'sourceError') {
             throw raceResult.err;
          }

          if (raceResult.type === 'signal' || raceResult.type === 'error') {
             const rescue = await Promise.race([
                nextPromise.then(
                  res => ({ res }),
                  () => null // If nextPromise fails, we don't rescue, implying null
                ),
                new Promise<{res: IteratorResult<T>} | null>(resolve => setTimeout(() => resolve(null), 0))
             ]);
             
             if (rescue) {
               resultValue = rescue.res;
             } else {
               if (raceResult.type === 'error') throw raceResult.err;
               break;
             }
          } else {
            resultValue = raceResult.res;
          }

          const { done, value } = resultValue;
          if (done) break;

          const stamp = getIteratorEmissionStamp(source);

          if (stamp !== undefined) {
            if (stop) break;
            if (notifierError && notifierErrorAtStamp === null) throw notifierError;
            const s = Math.abs(stamp);
            if (stopAtStamp !== null && s >= Math.abs(stopAtStamp)) break;
            if (notifierErrorAtStamp !== null && s >= Math.abs(notifierErrorAtStamp)) throw notifierError;
            
            processNext(value);
          } else {
            if (stop) break;
            if (notifierError) throw notifierError;
            processNext(value);
          }
        }

        if (!output.completed()) output.complete();
      } catch (err) {
        if (!output.completed()) output.error(err);
      } finally {
        requestUnsubscribe();
        source.return?.();
      }
    };

    iterate();

    return outputIterator;
  });
}
