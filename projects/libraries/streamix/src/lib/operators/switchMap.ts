import type { MaybePromise, Operator, Stream, Subscription } from "../abstractions";
import {
  createOperator,
  getIteratorMeta,
  isPromiseLike,
  setIteratorMeta,
  setValueMeta
} from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";
import { createSubject } from "../subjects";

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
    let stopped = false;

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

    const processOuterValue = (value: T) => {
      const streamId = ++currentInnerStreamId;
      const parentMeta = getIteratorMeta(source);

      let projected: any;
      try {
        projected = project(value, index++);
      } catch (err) {
        output.error(err);
        return;
      }

      if (isPromiseLike(projected)) {
        const capturedId = streamId;
        Promise.resolve(projected).then(
          (normalized) => {
            if (stopped || capturedId !== currentInnerStreamId) return;
            subscribeToInner(fromAny<R>(normalized as any), capturedId, parentMeta);
          },
          (err) => {
            if (stopped || capturedId !== currentInnerStreamId) return;
            output.error(err);
          }
        );
      } else {
        subscribeToInner(fromAny<R>(projected as any), streamId, parentMeta);
      }
    };

    const tryNext = (source as any).__tryNext as undefined | (() => IteratorResult<T> | null);

    if (typeof tryNext === "function") {
      const drain = () => {
        while (!stopped) {
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

          processOuterValue(result.value);
        }
      };

      (source as any).__onPush = drain;
      drain();
    } else {
      (async () => {
        try {
          while (!stopped) {
            const result = await source.next();
            if (result.done) break;
            processOuterValue(result.value);
          }

          inputCompleted = true;
          checkComplete();
        } catch (err) {
          output.error(err);
        }
      })();
    }

    const baseReturn = outputIterator.return?.bind(outputIterator);
    const baseThrow = outputIterator.throw?.bind(outputIterator);

    (outputIterator as any).return = async () => {
      stopped = true;
      try {
        await currentSubscription?.unsubscribe();
      } finally {
        currentSubscription = null;
      }
      return baseReturn ? baseReturn(undefined as any) : { done: true, value: undefined };
    };

    (outputIterator as any).throw = async (err: any) => {
      stopped = true;
      try {
        await currentSubscription?.unsubscribe();
      } finally {
        currentSubscription = null;
      }
      if (baseThrow) return baseThrow(err);
      throw err;
    };

    return outputIterator;
  });
}
