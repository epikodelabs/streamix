import type { MaybePromise, Operator, Stream, Subscription } from "@epikodelabs/streamix";
import {
  createOperator,
  createSubject,
  eachValueFrom,
  fromAny,
  getIteratorMeta,
  isPromiseLike,
  setIteratorMeta, setValueMeta
} from "@epikodelabs/streamix";

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

    /**
     * Checks if the overall operator should complete.
     * Only completes if the source is done AND no inner stream is active.
     */
    const checkComplete = () => {
      if (inputCompleted && !currentSubscription) {
        output.complete();
      }
    };

    const subscribeToInner = async (
      innerStream: Stream<R>,
      streamId: number,
      parentMeta?: any
    ) => {
      // 1. Unsubscribe from previous inner stream
      const previousSubscription = currentSubscription;
      if (previousSubscription) {
        void previousSubscription.unsubscribe();
      }

      const iterator = eachValueFrom(innerStream);

      // 2. Create and immediately set the new subscription
      const thisSubscription: Subscription = {
        unsubscribe() {
          try {
            return (iterator as any).return?.();
          } catch (e) {
            return Promise.resolve();
          }
        },
        unsubscribed: false
      };

      // Set BEFORE starting the async loop
      currentSubscription = thisSubscription;

      // 3. Start the drain loop for this inner stream
      (async () => {
        try {
          while (true) {
            // ID Guard: If a new inner stream has started, kill this loop
            if (streamId !== currentInnerStreamId || thisSubscription.unsubscribed) {
              return;
            }

            // Prefer synchronous pulling via __tryNext if available
            const tryNext = (iterator as any).__tryNext;
            let res: IteratorResult<R> | null = null;

            if (typeof tryNext === "function") {
              res = tryNext.call(iterator);
            }

            // Fall back to async pull if no sync value is ready
            if (res === null) {
              res = await iterator.next();
            }

            // Re-check ID after await
            if (streamId !== currentInnerStreamId || thisSubscription.unsubscribed) {
              return;
            }

            if (res.done) {
              // Only clear currentSubscription if we are still the active generation
              if (currentSubscription === thisSubscription) {
                currentSubscription = null;
                checkComplete();
              }
              return;
            }

            // Handle metadata for tracing/debugging
            // Replace this.index and this.name with the actual operator metadata
            const operatorIndex = (this as any).index ?? 0; // The position in the .pipe() chain
            const operatorName = "switchMap";
            let outputValue = res.value;
            
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
          }
        } catch (err) {
          if (streamId === currentInnerStreamId) {
            currentSubscription = null;
            output.error(err);
          }
        }
      })();
    };

    // Main source consumption loop
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

          // Initiate inner subscription (non-blocking)
          subscribeToInner(innerStream, streamId, parentMeta);
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