import {
  createOperator,
  getIteratorEmissionStamp,
  nextEmissionStamp,
  setIteratorEmissionStamp,
  type Operator,
  type Stream
} from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";
import { createSubject } from "../subjects";

export function skipUntil<T = any, R = any>(
  notifier: Stream<R> | Promise<R>
): Operator<T, T> {
  return createOperator<T, T>("skipUntil", function (
    this: Operator,
    source: AsyncIterator<T>
  ) {
    const output = createSubject<T>();
    const outputIterator = eachValueFrom(output);

    let openedAtStamp: number | null = null;
    let notifierError: any = null;
    let notifierCompletedWithoutEmit = false;

    // --- notifier subscription (push-based, authoritative) ---
    let notifierSub: any;
    
    notifierSub = fromAny(notifier).subscribe({
      next() {
        if (openedAtStamp === null) {
          // FIX: Use getCurrentEmissionStamp or nextEmissionStamp
          // The subscription itself might not have an emission stamp
          openedAtStamp = nextEmissionStamp();
        }
      },
      error(err) {
        notifierError = err;
      },
      complete() {
        if (openedAtStamp === null) {
          notifierCompletedWithoutEmit = true;
        }
      }
    });

    (async () => {
      try {
        while (true) {
          if (notifierError) throw notifierError;

          const r = await source.next();

          if (r.done) break;

          // Skip forever if notifier completed without emission
          if (notifierCompletedWithoutEmit) {
            continue;
          }

          // Gate not opened yet
          if (openedAtStamp === null) {
            continue;
          }

          const sourceStamp = getIteratorEmissionStamp(source);
          if (sourceStamp !== undefined) {
            if (Math.abs(sourceStamp) <= Math.abs(openedAtStamp)) {
              continue; // pre-notifier value
            }
          }

          const emitStamp = sourceStamp ?? nextEmissionStamp();
          setIteratorEmissionStamp(outputIterator as any, emitStamp);
          output.next(r.value);
        }

        output.complete();
      } catch (err) {
        output.error(err);
      } finally {
        notifierSub.unsubscribe();
        source.return?.();
      }
    })();

    return outputIterator;
  });
}