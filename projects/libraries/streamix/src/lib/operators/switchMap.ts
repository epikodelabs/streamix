import type { MaybePromise, Operator } from "../atoms";
import { createOperator, DONE, isPromiseLike } from "../atoms";
import type { PipeInput } from "../atoms/pipe";
import { from } from "../factories";
import { createAsyncPushable } from "../utils";
import { normalizeError } from "../atoms";
import { SwitchingInnerExecution } from "../runtime/inner-execution";

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
 * pipe(source, switchMap(n => timerStream(n)))
 * ```
 */
export function switchMap<T = any, R = any>(
  project: (value: T, index: number) => PipeInput<R> | MaybePromise<R> | Array<R>
) {
  return createOperator<T, R>("switchMap", function (this: Operator, source) {
    const output = createAsyncPushable<R>();
    const execution = new SwitchingInnerExecution<R>();
    let inputCompleted = false;
    let pendingProjection = false;
    let index = 0;
    let stopped = false;

    const checkComplete = () => {
      if (!stopped && inputCompleted && !execution.active && !pendingProjection) {
        stopped = true;
        output.dispose();
      }
    };

    const fail = (error: unknown) => {
      if (stopped) return;
      stopped = true;
      void execution.close();
      output.fail(normalizeError(error));
      void Promise.resolve(source.return?.()).catch(() => {});
    };

    const consumeInner = (generation: number, inner: PipeInput<R>) => {
      if (!execution.isCurrent(generation)) return;
      let iterator: AsyncIterator<R>;
      try {
        iterator = from<R>(inner as any)[Symbol.asyncIterator]() as AsyncIterator<R>;
      } catch (error) {
        fail(error);
        return;
      }
      if (!execution.attach(generation, iterator)) return;
      void (async () => {
        try {
          while (execution.isCurrent(generation)) {
            const item = await iterator.next();
            if (!execution.isCurrent(generation)) break;
            if (item.done) break;
            output.push(item.value);
          }
        } catch (error) {
          if (execution.isCurrent(generation)) fail(error);
        } finally {
          execution.release(generation, iterator);
          if (execution.isCurrent(generation)) checkComplete();
        }
      })();
    };

    const processOuterValue = (value: T) => {
      const generation = execution.advance();
      pendingProjection = false;
      let projected: ReturnType<typeof project>;
      try {
        projected = project(value, index++);
      } catch (error) {
        fail(error);
        return;
      }
      if (isPromiseLike(projected)) {
        pendingProjection = true;
        Promise.resolve(projected).then(
          resolved => {
            if (!execution.isCurrent(generation)) return;
            pendingProjection = false;
            consumeInner(generation, resolved as PipeInput<R>);
            checkComplete();
          },
          error => {
            if (!execution.isCurrent(generation)) return;
            pendingProjection = false;
            fail(error);
          }
        );
      } else {
        consumeInner(generation, projected as PipeInput<R>);
      }
    };

    const tryNext = (source as any).__tryNext as undefined | (() => IteratorResult<T> | null);
    if (typeof tryNext === 'function') {
      const drain = () => {
        while (!stopped) {
          let item: IteratorResult<T> | null;
          try { item = tryNext.call(source); }
          catch (error) { fail(error); return; }
          if (!item) return;
          if (item.done) {
            inputCompleted = true;
            checkComplete();
            return;
          }
          processOuterValue(item.value);
        }
      };
      (source as any).__onPush = drain;
      drain();
    } else {
      void (async () => {
        try {
          while (!stopped) {
            const item = await source.next();
            if (item.done) break;
            processOuterValue(item.value);
          }
          if (!stopped) { inputCompleted = true; checkComplete(); }
        } catch (error) { fail(error); }
      })();
    }

    const baseReturn = output.return?.bind(output);
    const baseThrow = output.throw?.bind(output);
    output.return = async () => {
      stopped = true;
      await execution.close();
      try { await source.return?.(); } catch { /* best effort */ }
      return baseReturn ? baseReturn() : DONE;
    };
    output.throw = async (error: unknown) => {
      stopped = true;
      await execution.close();
      try { await source.return?.(); } catch { /* best effort */ }
      if (baseThrow) return baseThrow(normalizeError(error));
      throw normalizeError(error);
    };
    return output;
  });
}
