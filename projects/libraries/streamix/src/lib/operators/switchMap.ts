import type { MaybePromise, Operator, Stream } from "../abstractions";
import {
    createOperator,
    DONE,
    isPromiseLike,
} from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";
import { createSubject } from "../subjects";

/**
 * Transforms each value from the source stream into a new inner stream, promise, or array,
 * and emits values only from the most recently created inner stream.
 *
 * When a new value is emitted from the source, the previous inner stream (if any) is cancelled
 * and unsubscribed, and a new inner stream is created using the `project` function. Only values
 * from the latest inner stream are emitted to the output. If the projected value is a {@link MaybePromise<R>} or array,
 * it is normalized to a stream.
 *
 * If the source completes and there is no active inner stream, the output completes. If an error occurs
 * in the source, the projection function, or the inner stream, the output emits an error and completes.
 *
 * @typeParam T - The type of values emitted by the source stream.
 * @typeParam R - The type of values emitted by the projected inner streams.
 * @param project - A function that receives each value and index from the source stream and returns a stream, a {@link MaybePromise<R>}, or array of values to be emitted.
 * @returns An operator function that can be applied to a stream, emitting values from the most recent inner stream created by the projection function.
 *
 * @example
 * ```ts
 * // For each number, start a new timer stream and emit its ticks, cancelling the previous timer.
 * source.pipe(switchMap(n => timerStream(n)))
 * ```
 */
export function switchMap<T = any, R = any>(
  project: (value: T, index: number) => Stream<R> | MaybePromise<R> | Array<R>
) {
  return createOperator<T, R>("switchMap", function (this: Operator, source) {
    const output = createSubject<R>();
    const outputIterator = eachValueFrom(output);

    let currentInner: { token: object; it: AsyncIterator<R> } | null = null;
    let inputCompleted = false;
    let currentInnerToken: object | null = null;
    let index = 0;
    let stopped = false;

    /**
     * Checks if the overall operator should complete.
     * Only completes if the source is done AND no inner stream is active.
     */
    const checkComplete = () => {
      if (inputCompleted && !currentInner) {
        output.complete();
      }
    };

    const subscribeToInner = (
      innerStream: Stream<R>,
      token: object
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
      currentInner = { token, it };

      void (async () => {
        try {
          while (!stopped && token === currentInnerToken) {
            const r = await it.next();

            if (r.done) break;
            if (stopped || token !== currentInnerToken) break;
            output.next(r.value);
          }
        } catch (err) {
          if (!stopped && token === currentInnerToken) {
            output.error(err);
          }
        } finally {
          if (currentInner?.token === token) {
            currentInner = null;
          }
          checkComplete();
        }
      })();
    };

    const processOuterValue = (value: T) => {
      const token = {};
      currentInnerToken = token;

      let projected: any;
      try {
        projected = project(value, index++);
      } catch (err) {
        output.error(err);
        return;
      }

      if (isPromiseLike(projected)) {
        const capturedToken = token;
        Promise.resolve(projected).then(
          (normalized) => {
            if (stopped || capturedToken !== currentInnerToken) return;
            subscribeToInner(fromAny<R>(normalized as any), capturedToken);
          },
          (err) => {
            if (stopped || capturedToken !== currentInnerToken) return;
            output.error(err);
          }
        );
      } else {
        subscribeToInner(fromAny<R>(projected as any), token);
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
      void (async () => {
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
      return baseReturn ? baseReturn(undefined as any) : DONE;
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
