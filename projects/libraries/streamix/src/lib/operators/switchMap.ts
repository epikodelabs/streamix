import type { MaybePromise, Operator, Stream, Subscription } from "@epikodelabs/streamix";
import {
  createOperator,
  createSubject,
  eachValueFrom,
  fromAny,
  getIteratorMeta,
  isPromiseLike,
  setIteratorMeta,
  setValueMeta
} from "@epikodelabs/streamix";

/**
 * Projects each source value to a Stream which is merged into the output Stream,
 * emitting values only from the most recently projected Stream.
 */
export function switchMap<T = any, R = any>(
  project: (value: T, index: number) => Stream<R> | MaybePromise<R> | Array<R>
) {
  return createOperator<T, R>("switchMap", function (this: Operator, source) {
    const output = createSubject<R>();
    const outputIterator = eachValueFrom(output);

    let currentSubscription: Subscription | null = null;
    let inputCompleted = false;
    let currentInnerStreamId = 0;
    let index = 0;

    /**
     * Checks if the overall operator should complete.
     * Only completes if the source is done AND no inner stream is active.
     */
    const checkComplete = () => {
      if (inputCompleted && !currentSubscription) {
        output.complete();
      }
    };

    const subscribeToInner = (
      innerStream: Stream<R>,
      streamId: number,
      parentMeta?: any
    ) => {
      const previousSubscription = currentSubscription;

      let unsubscribed = false;
      let innerSubscription: Subscription | null = null;

      const thisSubscription: Subscription = {
        unsubscribe() {
          if (unsubscribed) return Promise.resolve();
          unsubscribed = true;
          return innerSubscription?.unsubscribe() ?? Promise.resolve();
        },
        get unsubscribed() {
          return unsubscribed;
        }
      };

      // Set BEFORE subscribing so synchronous inner completion can't
      // "re-activate" this subscription after it already completed.
      currentSubscription = thisSubscription;

      // Unsubscribe the previous inner after the new one is marked active.
      if (previousSubscription) {
        void previousSubscription.unsubscribe();
      }

      innerSubscription = innerStream.subscribe({
        next: (value) => {
          if (streamId !== currentInnerStreamId || thisSubscription.unsubscribed) {
            return;
          }

          const operatorIndex = (this as any).index ?? 0;
          const operatorName = "switchMap";
          let outputValue = value;
          if (parentMeta) {
            setIteratorMeta(
              outputIterator,
              { valueId: parentMeta.valueId, kind: "expand" },
              operatorIndex,
              operatorName
            );
            outputValue = setValueMeta(
              outputValue,
              { valueId: parentMeta.valueId, kind: "expand" },
              operatorIndex,
              operatorName
            );
          }
          output.next(outputValue);
        },

        error: (err) => {
          if (streamId !== currentInnerStreamId || thisSubscription.unsubscribed) {
            return;
          }
          currentSubscription = null;
          output.error(err);
        },
 
        complete: () => {
          if (streamId !== currentInnerStreamId || thisSubscription.unsubscribed) {
            return;
          }
          currentSubscription = null;
          checkComplete();
        }
      });
    };

    const drainOuter = () => {
      const tryNext = (source as any).__tryNext as undefined | (() => IteratorResult<T> | null);

      // Fallback for iterators without buffering support.
      if (typeof tryNext !== "function") {
        (async () => {
          try {
            while (true) {
              const result = await source.next();
              if (result.done) break;

              const streamId = ++currentInnerStreamId;
              const parentMeta = getIteratorMeta(source);

              let projected: any;
              try {
                projected = project(result.value, index++);
              } catch (err) {
                output.error(err);
                return;
              }

              if (isPromiseLike(projected)) {
                const capturedId = streamId;
                Promise.resolve(projected).then(
                  (normalized) => {
                    if (capturedId !== currentInnerStreamId) return;
                    subscribeToInner(
                      fromAny<R>(normalized as any),
                      capturedId,
                      parentMeta
                    );
                  },
                  (err) => {
                    if (capturedId !== currentInnerStreamId) return;
                    output.error(err);
                  }
                );
              } else {
                subscribeToInner(fromAny<R>(projected as any), streamId, parentMeta);
              }
            }

            inputCompleted = true;
            checkComplete();
          } catch (err) {
            output.error(err);
          }
        })();
        return;
      }

      while (true) {
        let result: IteratorResult<T> | null;
        try {
          result = tryNext.call(source);
        } catch (err) {
          output.error(err);
          return;
        }

        if (!result) return;

        if (result.done) {
          inputCompleted = true;
          checkComplete();
          return;
        }

        const streamId = ++currentInnerStreamId;
        const parentMeta = getIteratorMeta(source);

        let projected: any;
        try {
          projected = project(result.value, index++);
        } catch (err) {
          output.error(err);
          return;
        }

        if (isPromiseLike(projected)) {
          const capturedId = streamId;
          Promise.resolve(projected).then(
            (normalized) => {
              if (capturedId !== currentInnerStreamId) return;
              subscribeToInner(fromAny<R>(normalized as any), capturedId, parentMeta);
            },
            (err) => {
              if (capturedId !== currentInnerStreamId) return;
              output.error(err);
            }
          );
        } else {
          subscribeToInner(fromAny<R>(projected as any), streamId, parentMeta);
        }
      }
    };

    (source as any).__onPush = drainOuter;
    drainOuter();

    return outputIterator;
  });
}
