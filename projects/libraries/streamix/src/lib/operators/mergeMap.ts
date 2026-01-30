import { createOperator, getIteratorMeta, setIteratorMeta, setValueMeta, type MaybePromise, type Operator, type Stream } from '../abstractions';
import { eachValueFrom, fromAny } from '../converters';
import { createSubject, type Subject } from '../subjects';

/**
 * Creates a stream operator that maps each value from the source stream to an "inner" stream
 * and merges all inner streams concurrently into a single output stream.
 *
 * For each value from the source stream:
 * 1. The `project` function is called with the value and its index.
 * 2. The returned value is normalized into a stream using {@link fromAny}.
 * 3. The inner stream is consumed concurrently with all other active inner streams.
 * 4. Emitted values from all inner streams are interleaved into the output stream
 *    in the order they are produced, without waiting for other inner streams to complete.
 *
 * This operator is useful for performing parallel asynchronous operations while
 * preserving all emitted values in a merged output.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the inner and output streams.
 * @param project A function that maps a source value and its index to either:
 *   - a {@link Stream<R>},
 *   - a {@link MaybePromise<R>} (value or promise),
 *   - or an array of `R`.
 * @returns An {@link Operator} instance that can be used in a stream's `pipe` method.
 */
export function mergeMap<T = any, R = any>(
  project: (value: T, index: number) => Stream<R> | MaybePromise<R> | Array<R>,
) {
  return createOperator<T, R>('mergeMap', function (this: Operator, source) {
    const output: Subject<R> = createSubject<R>();
    const outputIterator = eachValueFrom(output);

    let index = 0;
    let activeInner = 0;
    let outerCompleted = false;
    let errorOccurred = false;
    let stopped = false;

    const activeInnerIterators = new Set<AsyncIterator<R>>();

    // Process each inner stream concurrently.
    const processInner = async (
      innerStream: Stream<R>,
      parentMeta?: { valueId: string; operatorIndex: number; operatorName: string }
    ) => {
      const innerIt = innerStream[Symbol.asyncIterator]();
      activeInnerIterators.add(innerIt);
      try {
        while (!stopped) {
          const r = await innerIt.next();
          if (r.done) break;
          if (stopped || errorOccurred) break;

          let value = r.value;
          if (parentMeta) {
            setIteratorMeta(
              outputIterator,
              { valueId: parentMeta.valueId, kind: "expand" },
              parentMeta.operatorIndex,
              parentMeta.operatorName
            );
            value = setValueMeta(
              value,
              { valueId: parentMeta.valueId, kind: "expand" },
              parentMeta.operatorIndex,
              parentMeta.operatorName
            );
          }
          output.next(value);
        }
      } catch (err) {
        if (!errorOccurred) {
          errorOccurred = true;
          output.error(err);
        }
      } finally {
        activeInnerIterators.delete(innerIt);
        activeInner--;
        if (outerCompleted && activeInner === 0 && !errorOccurred) {
          output.complete();
        }
      }
    };

    (async () => {
      try {
        while (!stopped) {
          const result = await source.next();
          if (result.done) break;
          if (errorOccurred) break;

          const projected = project(result.value, index++);
          // IMPORTANT: do NOT await promises here; each projected value/promise/stream
          // should start concurrently.
          const inner = fromAny(projected as any);
          const parentMeta = getIteratorMeta(source);
          activeInner++;
          processInner(inner, parentMeta);
        }

        outerCompleted = true;
        if (activeInner === 0 && !errorOccurred) {
          output.complete();
        }
      } catch (err) {
        if (!errorOccurred) {
          errorOccurred = true;
          output.error(err);
        }
      }
    })();

    const baseReturn = outputIterator.return?.bind(outputIterator);
    const baseThrow = outputIterator.throw?.bind(outputIterator);

    (outputIterator as any).return = async () => {
      stopped = true;
      try {
        try { await source.return?.(); } catch {}
        for (const it of activeInnerIterators) {
          try { await it.return?.(); } catch {}
        }
        activeInnerIterators.clear();
      } finally {
        return baseReturn ? baseReturn(undefined as any) : { done: true, value: undefined };
      }
    };

    (outputIterator as any).throw = async (err: any) => {
      stopped = true;
      try {
        try { await source.return?.(); } catch {}
        for (const it of activeInnerIterators) {
          try { await it.return?.(); } catch {}
        }
        activeInnerIterators.clear();
      } finally {
        if (baseThrow) return baseThrow(err);
      }
      throw err;
    };

    return outputIterator;
  });
}
