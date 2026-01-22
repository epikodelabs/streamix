import { createOperator, getIteratorMeta, isPromiseLike, setIteratorMeta, setValueMeta, type MaybePromise, type Operator, type Stream, type Subscription } from "../abstractions";
import { eachValueFrom, fromAny } from '../converters';
import { createSubject } from "../subjects";

/**
 * Creates a stream operator that maps each value from the source stream to a new inner stream
 * and "switches" to emitting values from the most recent inner stream, canceling the previous one.
 *
 * For each value from the source:
 * 1. The `project` function is called with the value and its index.
 * 2. The returned value is normalized into a stream using {@link fromAny}.
 * 3. The operator subscribes to the new inner stream and immediately cancels any previous active inner stream.
 * 4. Only values from the latest inner stream are emitted.
 *
 * This operator is useful for scenarios such as:
 * - Type-ahead search where only the latest query results are relevant.
 * - Handling user events where new events invalidate previous operations.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the inner and output streams.
 * @param project A function that maps a source value and its index to either:
 *   - a {@link Stream<R>},
 *   - a {@link MaybePromise<R>} (value or promise),
 *   - or an array of `R`.
 * @returns An {@link Operator} instance suitable for use in a stream's `pipe` method.
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

    const checkComplete = () => {
      if (inputCompleted && !currentSubscription) {
        output.complete();
      }
    };

    const subscribeToInner = (
      innerStream: Stream<R>,
      streamId: number,
      parentMeta?: { valueId: string; operatorIndex: number; operatorName: string }
    ) => {
      // Cancel previous inner stream
      if (currentSubscription) {
        currentSubscription.unsubscribe();
        currentSubscription = null;
      }

      const iterator = eachValueFrom(innerStream);

      // Expose an unsubscribe wrapper so callers can cancel the iterator.
      currentSubscription = {
        unsubscribe() {
          try {
            (iterator as any).return && (iterator as any).return();
          } catch (e) {
            // ignore
          }
        },
        unsubscribed: false
      };

      // Start async drain task — do not await here so subscribeToInner returns
      // immediately (matching the previous subscribe-based behavior).
      (async () => {
        try {
          for (;;) {
            if (streamId !== currentInnerStreamId) return;

            // Prefer synchronous drain when possible to avoid races where an
            // inner reports completion before an already-buffered value is
            // observed by the operator.
            const tryNext = (iterator as any).__tryNext;
            let res: IteratorResult<R> | null;

            if (typeof tryNext === "function") {
              try {
                res = tryNext.call(iterator);
              } catch (err) {
                if (streamId !== currentInnerStreamId) return;
                currentSubscription = null;
                output.error(err);
                return;
              }
              if (res === null) {
                res = await iterator.next();
              }
            } else {
              res = await iterator.next();
            }

            if (streamId !== currentInnerStreamId) return;

            if (res.done) {
              // active inner completed
              currentSubscription = null;
              checkComplete();
              return;
            }

            let outputValue: any = res.value;
            if (parentMeta) {
              setIteratorMeta(
                outputIterator,
                { valueId: parentMeta.valueId, kind: "expand" },
                parentMeta.operatorIndex,
                parentMeta.operatorName
              );
              outputValue = setValueMeta(
                outputValue,
                { valueId: parentMeta.valueId, kind: "expand" },
                parentMeta.operatorIndex,
                parentMeta.operatorName
              );
            }
            output.next(outputValue);
          }
        } catch (err) {
          if (streamId !== currentInnerStreamId) return;
          currentSubscription = null;
          output.error(err);
        }
      })();
    };

    (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (result.done) break;

          const streamId = ++currentInnerStreamId;
          const parentMeta = getIteratorMeta(source);
          const projected = project(result.value, index++);
          const normalized = isPromiseLike(projected) ? await projected : projected;
          const innerStream = fromAny(normalized);
          await subscribeToInner(innerStream, streamId, parentMeta);
        }

        inputCompleted = true;
        checkComplete();
      } catch (err) {
        output.error(err);
      }
    })();

    return outputIterator;
  });
}
