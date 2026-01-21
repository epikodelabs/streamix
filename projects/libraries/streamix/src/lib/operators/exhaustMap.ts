import { createOperator, DONE, isPromiseLike, NEXT, type MaybePromise, type Operator, type Stream } from "../abstractions";
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

    const drainIgnored = () => {
      while ((source as any).__tryNext?.()) { /* Drop */ }
    };

    return {
      async next() {
        while (true) {
          if (innerIterator) {
            const result = await innerIterator.next();
            drainIgnored(); // Clear values that arrived during the await

            if (!result.done) return NEXT(result.value);
            
            innerIterator = null;
            if (isSourceDone) return DONE;
            continue;
          }

          const result = await source.next();
          if (result.done) return DONE;

          const projected = project(result.value, outerIndex++);
          const normalized = isPromiseLike(projected) ? await projected : projected;
          innerIterator = eachValueFrom(fromAny<R>(normalized));
        }
      },
    };
  });