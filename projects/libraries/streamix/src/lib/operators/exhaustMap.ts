import { createOperator, DONE, isPromiseLike, MaybePromise, NEXT, type Operator } from "../atoms";
import type { PipeInput } from "../atoms/pipe";
import { from } from "../factories";
import { normalizeError } from "../utils/helpers";

/**
 * Maps each value from the source stream to an inner stream, ignoring 
 * new outer values while the current inner stream is still executing.
 *
 * This operator is useful for preventing overlapping operations (e.g. preventing 
 * multiple simultaneous form submissions or API calls). If a new value arrives 
 * from the source while an earlier projected stream is still active, that 
 * new value is silently discarded.
 * * Only after the current inner stream completes will the operator become 
 * "idle" and ready to accept the next value from the source.
 *
 * @template T The type of values emitted by the source stream.
 * @template R The type of values emitted by the produced inner streams.
 * @param project A function that transforms a source value into a {@link AtomBase}, 
 * a {@link MaybePromise<R>}, or an array. It receives the source value and a
 * zero-based index of the emission.
 * @returns An {@link Operator} that performs the "exhaust" transformation.
 */
export const exhaustMap = <T = any, R = any>(
  project: (value: T, index: number) => PipeInput<R> | MaybePromise<R> | Array<R>
) =>
  createOperator<T, R>("exhaustMap", function (this: Operator, source) {
    let outerIndex = 0;
    let innerIterator: AsyncIterator<R> | null = null;
    let isSourceDone = false;

    const drainBufferedOuterValues = (): IteratorResult<T> | null => {
      const tryNext = (source as any).__tryNext as undefined | (() => IteratorResult<T> | null);
      if (!tryNext) return null;

      while (true) {
        const r = tryNext.call(source);
        if (!r) return null;
        if (r.done) {
          isSourceDone = true;
          return null;
        }
      }
    };

    return {
      async next() {
        while (true) {
          if (innerIterator) {
            const result = await innerIterator.next();

            if (!result.done) {
              return NEXT(result.value);
            }

            innerIterator = null;
            const buffered = drainBufferedOuterValues();
            if (buffered) return buffered as any;
            if (isSourceDone) return DONE;
            continue;
          }

          const result = await source.next();
          if (result.done) {
            isSourceDone = true;
            return DONE;
          }

          let projected: any;
          try {
            projected = project(result.value, outerIndex++);
          } catch (err) {
            isSourceDone = true;
            throw normalizeError(err);
          }
          if (isPromiseLike(projected)) {
            try {
              projected = await projected;
            } catch (err) {
              isSourceDone = true;
              throw normalizeError(err);
            }
          }

          const innerStream = from<R>(projected as any);
          innerIterator = innerStream[Symbol.asyncIterator]() as AsyncIterator<R>;
        }
      },

      async return(value?: any) {
        try {
          await innerIterator?.return?.(value);
        } catch {}
        try {
          await source.return?.();
        } catch {}
        innerIterator = null;
        return DONE;
      },

      async throw(err: any) {
        const error = normalizeError(err);
        try {
          await innerIterator?.return?.();
        } catch {}
        try {
          await source.return?.();
        } catch {}
        innerIterator = null;
        throw error;
      }
    };
  });
