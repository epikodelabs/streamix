import { createOperator, getCurrentEmissionStamp, getIteratorEmissionStamp, getIteratorMeta, isPromiseLike, setIteratorMeta, setValueMeta, type Operator, type Stream, type Subscription } from "../abstractions";
import { eachValueFrom, fromAny } from '../converters';
import { createSubject } from "../subjects";

/**
 * Creates a stream operator that delays the emission of values from the source stream
 * until a separate `notifier` stream emits at least one value.
 *
 * This operator acts as a gate. It buffers all values from the source stream
 * until the `notifier` stream emits its first value. Once the notifier emits,
 * the operator immediately flushes all buffered values and then passes through
 * all subsequent values from the source without delay.
 *
 * If the `notifier` stream completes without ever emitting a value, the buffered 
 * values are DISCARDED, and the operator simply waits for the source to complete.
 *
 * @template T The type of the values in the source and output streams.
 * @param notifier The stream or promise that acts as a gatekeeper.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export function delayUntil<T = any, R = T>(notifier: Stream<R> | Promise<R>) {
  return createOperator<T, T>("delayUntil", function (this: Operator, source: AsyncIterator<T>) {
    const output = createSubject<T>();
    const outputIterator = eachValueFrom(output);
    let canEmit = false;
    let notifierEmitted = false;
    let gateClosedWithoutEmit = false;
    let buffer: { value: T; meta?: { valueId: string; operatorIndex: number; operatorName: string } }[] = [];
    let notifierSubscription: Subscription | undefined;

    let notifierError: any = null;
    let notifierErrorAtStamp: number | null = null;
    let openedAtStamp: number | null = null;
    
    let signalResolve: (val: { kind: 'next' | 'complete' }) => void;
    let signalReject: (err: any) => void;
    const notifierSignal = new Promise<{ kind: 'next' | 'complete' }>((resolve, reject) => {
      signalResolve = resolve;
      signalReject = reject;
    });
    notifierSignal.catch(() => {});

    const setupNotifier = async () => {
      try {
        const resolvedNotifier = isPromiseLike(notifier) ? await notifier : notifier;
        console.log('DEBUG: Subscribing to notification stream'); 
        notifierSubscription = fromAny(resolvedNotifier).subscribe({
          next: () => {
             const stamp = getCurrentEmissionStamp();
             console.log('DEBUG: Notifier NEXT', { stamp });
             if (stamp !== null) openedAtStamp = stamp;
             signalResolve({ kind: 'next' });
             notifierSubscription?.unsubscribe();
          },
          error: (err) => {
            console.log('DEBUG: Notifier ERROR', err);
            notifierError = err;
            const stamp = getCurrentEmissionStamp();
             if (stamp !== null) notifierErrorAtStamp = stamp;
            signalReject(err);
            notifierSubscription?.unsubscribe();
          },
          complete: () => {
             console.log('DEBUG: Notifier COMPLETE');
             signalResolve({ kind: 'complete' });
             notifierSubscription?.unsubscribe();
          },
        });
      } catch (err) {
         notifierError = err instanceof Error ? err : new Error(String(err));
         signalReject(notifierError);
      }
    };

    setupNotifier();

    (async () => {
      try {
        let activeNextPromise: Promise<IteratorResult<T>> | null = null;

        while (true) {
          console.log('DEBUG: Loop Start', { canEmit, hasBuffer: buffer.length, raceEnabled: (!canEmit && !gateClosedWithoutEmit) });
          // console.log('DEBUG: Loop Start', { canEmit, hasBuffer: buffer.length });
          if (notifierError && notifierErrorAtStamp === null) throw notifierError;
          
          let resultValue: IteratorResult<T> | undefined;

          // We only race if we haven't decided the gate state yet
          const raceEnabled = !canEmit && !gateClosedWithoutEmit;

          if (raceEnabled) {
             if (!activeNextPromise) {
               activeNextPromise = source.next();
             }
             
             const raceResult = await Promise.race([
                activeNextPromise.then(res => ({ type: 'source', res } as const)),
                notifierSignal.then(
                    (val) => ({ type: 'signal', kind: val.kind } as const),
                    (err) => ({ type: 'error', err } as const)
                )
             ]);

             if (raceResult.type === 'signal' || raceResult.type === 'error') {
                 // Rescue pending source value
                 const rescue = await Promise.race([
                    activeNextPromise.then(res => ({ res })),
                    new Promise<{res: IteratorResult<T>} | null>(resolve => setTimeout(() => resolve(null), 0))
                 ]);

                 if (rescue) {
                    resultValue = rescue.res;
                    activeNextPromise = null;
                 } else {
                    if (raceResult.type === 'error') throw raceResult.err;
                    
                    if (raceResult.type === 'signal') {
                        if (raceResult.kind === 'next') {
                            // Gate opens
                            console.log('DEBUG: Gate Opening. Flushing buffer count:', buffer.length);
                            if (!canEmit && !gateClosedWithoutEmit) {
                                canEmit = true;
                                notifierEmitted = true;
                                // Flush buffer
                                for (const entry of buffer) {
                                    console.log('DEBUG: Flushing value', entry.value);
                                    let value = entry.value;
                                    if (entry.meta) {
                                    setIteratorMeta(
                                        outputIterator,
                                        { valueId: entry.meta.valueId },
                                        entry.meta.operatorIndex,
                                        entry.meta.operatorName
                                    );
                                    value = setValueMeta(value, { valueId: entry.meta.valueId }, entry.meta.operatorIndex, entry.meta.operatorName);
                                    }
                                    output.next(value);
                                }
                                buffer.length = 0;
                            }
                        } else {
                            // Complete without next
                            if (!canEmit && !notifierEmitted) {
                                gateClosedWithoutEmit = true;
                                buffer.length = 0;
                            }
                        }
                    }
                    continue; // Loop back with new state
                 }
             } else {
                resultValue = raceResult.res;
                activeNextPromise = null;
             }
          } else {
             // Not racing logic
             if (activeNextPromise) {
                resultValue = await activeNextPromise;
                activeNextPromise = null;
             } else {
                resultValue = await source.next();
             }
          }
          
          const { done, value } = resultValue!;
          if (done) break;
          const meta = getIteratorMeta(source);
          const stamp = getIteratorEmissionStamp(source);

          if (stamp !== undefined) {
             if (notifierError && notifierErrorAtStamp === null) throw notifierError;
             const s = Math.abs(stamp);
             if (notifierErrorAtStamp !== null && s >= Math.abs(notifierErrorAtStamp)) throw notifierError;
          } else {
             if (notifierError) throw notifierError;
          }

          // Check if we should effectively open gate based on stamps
          // If notifier opened at Stamp X, and Source value is at Stamp Y > X, then we should emit.
          
          let effectivelyCanEmit = canEmit;
          if (stamp !== undefined && stamp > 0 && openedAtStamp !== null) {
              effectivelyCanEmit = stamp > openedAtStamp;
          } 

          if (effectivelyCanEmit && !canEmit && !gateClosedWithoutEmit) {
               canEmit = true;
               notifierEmitted = true;
               // Flush buffer
               if (buffer.length > 0) {
                 // console.log('DEBUG: Late Flush due to stamps', buffer.length);
                 for (const entry of buffer) {
                       let value = entry.value;
                       if (entry.meta) {
                           setIteratorMeta(
                               outputIterator,
                               { valueId: entry.meta.valueId },
                               entry.meta.operatorIndex,
                               entry.meta.operatorName
                           );
                           value = setValueMeta(value, { valueId: entry.meta.valueId }, entry.meta.operatorIndex, entry.meta.operatorName);
                       }
                       output.next(value);
                 }
                 buffer.length = 0;
               }
          }
          
          if (effectivelyCanEmit) {
            console.log('DEBUG: Emitting value directly', value);
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
          } else if (!gateClosedWithoutEmit) {
            console.log('DEBUG: Buffering value', value);
            buffer.push({ value, meta });
          }
        }
      } catch (err) {
        output.error(err);
      } finally {
        output.complete();
        notifierSubscription?.unsubscribe();
      }
    })();

    return outputIterator;
  });
}
