import type { MaybePromise, Operator, Stream } from "../abstractions";
import {
  createOperator,
  DONE,
  isPromiseLike,
} from "../abstractions";
import { fromAny } from "../converters";
import { createAsyncPushable, normalizeError } from "../utils";
import { createDisposer } from "../utils/disposal";

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
  project: (
    value: T,
    index: number
  ) =>
    | Stream<R>
    | MaybePromise<R | Stream<R> | Array<R> | Iterable<R> | AsyncIterable<R>>
    | Array<R>
    | Iterable<R>
    | AsyncIterable<R>
) {
  return createOperator<T, R>("switchMap", function (this: Operator, source) {
    const output = createAsyncPushable<R>();
    const outputIterator = output;

    let currentInner: { token: object; it: AsyncIterator<R> } | null = null;
    let pendingInnerToken: object | null = null;
    let inputCompleted = false;
    let currentInnerToken: object | null = null;
    let index = 0;
    let stopped = false;
    const preparations = new Set<Promise<void>>();

    /**
     * Checks if the overall operator should complete.
     * Only completes if the source is done AND no inner stream is active.
     */
    const checkComplete = () => {
      if (inputCompleted && !currentInner && !pendingInnerToken) {
        output.complete();
      }
    };

    const closeInner = async (iterator: AsyncIterator<R>) => {
      try { await iterator.return?.(); } catch { /* Best-effort cleanup. */ }
    };

    const subscribeToInner = (
      innerStream: Stream<R>,
      token: object
    ) => {
      const it = innerStream[Symbol.asyncIterator]() as AsyncIterator<R>;
      if (pendingInnerToken === token) {
        pendingInnerToken = null;
      }
      currentInner = { token, it };

      void (async () => {
        try {
          while (!stopped && token === currentInnerToken) {
            const r = await it.next();

            if (r.done) break;
            if (stopped || token !== currentInnerToken) break;
            output.push(r.value);
          }
        } catch (err) {
          if (!stopped && token === currentInnerToken) {
            output.error(normalizeError(err));
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
      if (stopped) return;
      const previous = currentInner;
      currentInner = null;
      if (previous) void closeInner(previous.it);
      const token = {};
      currentInnerToken = token;

      let projected: any;
      try {
        projected = project(value, index++);
      } catch (err) {
        output.error(normalizeError(err));
        return;
      }

      if (isPromiseLike(projected)) {
        const capturedToken = token;
        pendingInnerToken = capturedToken;
        const preparation = Promise.resolve(projected).then(
          async (normalized) => {
            if (stopped || capturedToken !== currentInnerToken) {
              const iterable = normalized as AsyncIterable<R> | null | undefined;
              const iterator = iterable?.[Symbol.asyncIterator]?.();
              if (iterator) await closeInner(iterator);
              return;
            }
            subscribeToInner(fromAny<R>(normalized as any), capturedToken);
          },
          (err) => {
            if (stopped || capturedToken !== currentInnerToken) return;
            if (pendingInnerToken === capturedToken) {
              pendingInnerToken = null;
            }
            output.error(normalizeError(err));
          }
        );
        preparations.add(preparation);
        void preparation.then(
          () => preparations.delete(preparation),
          error => {
            preparations.delete(preparation);
            if (!stopped && currentInnerToken === capturedToken) {
              pendingInnerToken = null;
              output.error(normalizeError(error));
            }
          }
        );
      } else {
        pendingInnerToken = null;
        subscribeToInner(fromAny<R>(projected as any), token);
      }
    };

    const sourceWithPush = source as AsyncIterator<T> & {
      __tryNext?: () => IteratorResult<T> | null;
      __onPush?: () => void;
    };
    const tryNext = sourceWithPush.__tryNext;
    const originalOnPush = sourceWithPush.__onPush;
    let wiredOnPush: (() => void) | undefined;

    const restoreSourcePush = () => {
      if (wiredOnPush && sourceWithPush.__onPush === wiredOnPush) {
        sourceWithPush.__onPush = originalOnPush;
      }
      wiredOnPush = undefined;
    };

    if (typeof tryNext === "function" && "__onPush" in source) {
      const drain = () => {
        while (!stopped) {
          let result: IteratorResult<T> | null;
          try {
            result = tryNext.call(source);
          } catch (err) {
            restoreSourcePush();
            output.error(normalizeError(err));
            return;
          }

          if (!result) return;
          if (result.done) {
            inputCompleted = true;
            restoreSourcePush();
            checkComplete();
            return;
          }

          processOuterValue(result.value);
        }
      };

      wiredOnPush = drain;
      sourceWithPush.__onPush = wiredOnPush;
      drain();
    } else {
      void (async () => {
        try {
          while (!stopped) {
            const result = tryNext?.call(source) ?? await source.next();
            if (stopped || result.done) break;
            processOuterValue(result.value);
          }

          inputCompleted = true;
          checkComplete();
        } catch (err) {
          output.error(normalizeError(err));
        }
      })();
    }

    const baseReturn = outputIterator.return?.bind(outputIterator);
    const baseThrow = outputIterator.throw?.bind(outputIterator);

    const stop = createDisposer(queue => {
      stopped = true;
      pendingInnerToken = null;
      restoreSourcePush();
      const inner = currentInner;
      currentInner = null;
      if (inner) queue.run(() => closeInner(inner.it));
      queue.run(async () => {
        try { await source.return?.(); } catch { /* Best-effort cleanup. */ }
      });
      for (const preparation of preparations) queue.track(preparation);
    });

    outputIterator.return = async value => {
      const cleanup = stop();
      const result = await (baseReturn?.(value) ?? DONE);
      await cleanup;
      return result;
    };

    outputIterator.throw = async err => {
      const error = normalizeError(err);
      const cleanup = stop();
      try {
        if (baseThrow) return await baseThrow(error);
        throw error;
      } finally {
        await cleanup;
      }
    };
    return outputIterator;
  });
}
