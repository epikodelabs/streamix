import {
  createOperator,
  DONE,
  getIteratorEmissionStamp,
  isPromiseLike,
  NEXT,
  nextEmissionStamp,
  type MaybePromise,
  type Operator,
  type Stream
} from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";

/**
 * Maps each value from the source stream to an inner stream, ignoring 
 * new outer values while the current inner stream is still executing.
 *
 * This operator is useful for preventing overlapping operations (e.g., preventing 
 * multiple simultaneous form submissions or API calls). If a new value arrives 
 * from the source while an earlier projected stream is still active, that 
 * new value is silently discarded.
 * * Only after the current inner stream completes will the operator become 
 * "idle" and ready to accept the next value from the source.
 *
 * @template T The type of values emitted by the source stream.
 * @template R The type of values emitted by the produced inner streams.
 * @param project A function that transforms a source value into a {@link Stream}, 
 * a {@link MaybePromise}, or an array. It receives the source value and a 
 * zero-based index of the emission.
 * @returns An {@link Operator} that performs the "exhaust" transformation.
 */
export const exhaustMap = <T = any, R = T>(
  project: (value: T, index: number) => Stream<R> | MaybePromise<R> | Array<R>
) =>
  createOperator<T, R>("exhaustMap", function (this: Operator, source) {
    let outerIndex = 0;
    let innerIterator: AsyncIterator<R> | null = null;
    let isSourceDone = false;

    // Drop source emissions that happened while an inner was active.
    // We implement this by recording an emission stamp window for the inner:
    // (ignoreStartStamp, ignoreEndStamp]. Any source value with a stamp inside
    // that window is skipped.
    let ignoreStartStamp: number | null = null;
    let ignoreEndStamp: number | null = null;

    const stampOf = (it: any) => {
      const s = getIteratorEmissionStamp(it);
      return typeof s === "number" ? s : nextEmissionStamp();
    };

    return {
      async next() {
        while (true) {
          if (innerIterator) {
            const result = await innerIterator.next();

            if (!result.done) return NEXT(result.value);
            
            innerIterator = null;
            if (ignoreStartStamp !== null && ignoreEndStamp === null) {
              ignoreEndStamp = nextEmissionStamp();
            }
            if (isSourceDone) return DONE;
            continue;
          }

          const result = await source.next();
          if (result.done) {
            isSourceDone = true;
            return DONE;
          }

          // Ignore values that arrived while the previous inner was active.
          if (ignoreStartStamp !== null && ignoreEndStamp !== null) {
            const stamp = stampOf(source);
            if (stamp > ignoreStartStamp && stamp <= ignoreEndStamp) {
              continue;
            }
          }

          const projected = project(result.value, outerIndex++);

          // Mark the start of a new active-inner window.
          ignoreStartStamp = nextEmissionStamp();
          ignoreEndStamp = null;

          if (isPromiseLike(projected)) {
            const normalized = await projected;
            innerIterator = eachValueFrom(fromAny<R>(normalized));
          } else {
            innerIterator = eachValueFrom(fromAny<R>(projected as any));
          }
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
        try {
          await innerIterator?.return?.();
        } catch {}
        try {
          await source.return?.();
        } catch {}
        innerIterator = null;
        throw err;
      }
    };
  });
