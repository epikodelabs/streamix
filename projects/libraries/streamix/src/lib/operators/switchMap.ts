import type { MaybePromise, Operator, Stream } from "../abstractions";
import {
  createOperator,
  getIteratorEmissionStamp,
  getIteratorMeta,
  isPromiseLike,
  nextEmissionStamp,
  scheduler,
  setIteratorEmissionStamp,
  setIteratorMeta,
  setValueMeta,
  withEmissionStamp
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

    let currentInner: { id: number; it: AsyncIterator<R> } | null = null;
    let inputCompleted = false;
    let currentInnerStreamId = 0;
    let index = 0;
    let stopped = false;

    /**
     * Checks if the overall operator should complete.
     * Only completes if the source is done AND no inner stream is active.
     */
    const checkComplete = () => {
      // Only complete when source is done AND no inner stream is active
      if (!inputCompleted || currentInner || stopped) return;

      // Enqueue completion on the same global scheduler as Subjects.
      // This guarantees FIFO ordering vs. already-enqueued `output.next(...)`
      // commits and prevents "complete" overtaking the last value.
      const token = currentInnerStreamId;
      scheduler.enqueue(() => {
        if (stopped) return;
        if (!inputCompleted || currentInner) return;
        if (token !== currentInnerStreamId) return;
        if (output.completed()) return;
        output.complete();
      });
    };

    const subscribeToInner = (
      innerStream: Stream<R>,
      streamId: number,
      parentMeta?: any
    ) => {
      // Cancel the previous inner immediately so sync inner streams can't
      // interleave emissions out-of-order via re-entrant scheduler execution.
      const prev = currentInner;
      if (prev) {
        try {
          void prev.it.return?.();
        } catch {}
      }

      const it = innerStream[Symbol.asyncIterator]();
      currentInner = { id: streamId, it };

      const innerTryNext = (it as any).__tryNext as undefined | (() => IteratorResult<R> | null);

      const forwardValue = (value: R) => {
        const stamp = getIteratorEmissionStamp(it) ?? nextEmissionStamp();
        if (stopped || streamId !== currentInnerStreamId) return;

        const operatorIndex = (this as any).index ?? 0;
        const operatorName = "switchMap";
        let outputValue: any = value;

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

        withEmissionStamp(stamp, () => {
          setIteratorEmissionStamp(outputIterator as any, stamp);
          output.next(outputValue);
        });
      };

      const finishInner = () => {
        if (currentInner?.id === streamId) {
          currentInner = null;
        }
        if (streamId === currentInnerStreamId) {
          checkComplete();
        }
      };

      if (typeof innerTryNext === "function") {
        const drainInner = () => {
          while (!stopped && streamId === currentInnerStreamId) {
            let r: IteratorResult<R> | null;
            try {
              r = innerTryNext.call(it);
            } catch (err) {
              if (!stopped && streamId === currentInnerStreamId) {
                output.error(err as any);
              }
              finishInner();
              return;
            }

            if (!r) return;
            if (r.done) {
              finishInner();
              return;
            }

            forwardValue(r.value);
          }
        };

        (it as any).__onPush = drainInner;
        drainInner();
        return;
      }

      void (async () => {
        try {
          while (!stopped && streamId === currentInnerStreamId) {
            const r = await it.next();

            if (r.done) break;
            if (stopped || streamId !== currentInnerStreamId) break;

            forwardValue(r.value);
          }
        } catch (err) {
          if (!stopped && streamId === currentInnerStreamId) {
            output.error(err);
          }
        } finally {
          finishInner();
        }
      })();
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
        try {
          await currentInner?.it.return?.();
        } catch {}
      } finally {
        currentInner = null;
      }
      return baseReturn ? baseReturn(undefined as any) : { done: true, value: undefined };
    };

    (outputIterator as any).throw = async (err: any) => {
      stopped = true;
      try {
        try {
          await currentInner?.it.return?.();
        } catch {}
      } finally {
        currentInner = null;
      }
      if (baseThrow) return baseThrow(err);
      throw err;
    };

    return outputIterator;
  });
}