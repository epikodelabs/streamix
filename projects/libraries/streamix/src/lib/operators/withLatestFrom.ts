import { createOperator, createReceiver, isPromiseLike, type MaybePromise, type Operator, type Receiver, type Stream, type Subscription } from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";
import { createSubject } from "../subjects";

/**
 * Creates a stream operator that combines the source stream with the latest values
 * from other provided streams.
 *
 * This operator is useful for merging a "trigger" stream with "state" streams.
 * It waits for a value from the source stream and, when one arrives, it emits a
 * tuple containing that source value along with the most recently emitted value
 * from each of the other streams.
 *
 * The operator is "gated" and will not emit any values until all provided streams
 * have emitted at least one value.
 * Inputs may be streams or values (including promises).
 *
 * @template T The type of the values in the source stream.
 * @template R The tuple type of the values from the other streams (e.g., [R1, R2, R3]).
 * @param streams Streams or values (including promises) to combine with the source stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 * The output stream emits tuples of `[T, ...R]`.
 */
export function withLatestFrom<T = any, R extends readonly unknown[] = any[]>(
  ...streams: { [K in keyof R]: Stream<R[K]> | MaybePromise<R[K]> }
) {
  return createOperator<T, [T, ...R]>("withLatestFrom", function (this: Operator, source) {
    const output = createSubject<[T, ...R]>();
    const abortController = new AbortController();
    const { signal } = abortController;
    
    let latestValues: any[] = [];
    let hasValue: boolean[] = [];
    const subscriptions: Subscription[] = [];

    // The entire operator logic is wrapped in an async function to ensure auxiliary
    // stream subscriptions (and potential sync emissions) are handled before
    // the source stream iteration starts, preventing a race condition.
    (async () => {
      try {
        // --- 1. Setup Auxiliary Streams ---
        const resolvedInputs = await Promise.all(
          streams.map(async (stream) => (isPromiseLike(stream) ? await stream : stream))
        );

        latestValues = new Array(resolvedInputs.length).fill(undefined);
        hasValue = new Array(resolvedInputs.length).fill(false);

        for (let i = 0; i < resolvedInputs.length; i++) {
          const subscription = fromAny(resolvedInputs[i]).subscribe({
            next: (value) => {
              latestValues[i] = value;
              hasValue[i] = true;
            },
            error: (err) => {
              // Immediately propagate errors from auxiliary streams and clean up
              if (!signal.aborted) {
                output.error(err instanceof Error ? err : new Error(String(err)));
                abortController.abort(); // Signal the main loop to stop
              }
            },
            // Note: Auxiliary stream completion does not complete the main stream
            // but stops that specific auxiliary stream from providing updates.
          });
          subscriptions.push(subscription);
        }

        // --- 2. Iterate Source Stream ---
        const iterator = source;
        const abortPromise = new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
          } else {
            signal.addEventListener("abort", () => resolve(), { once: true });
          }
        });

        while (true) {
          const winner = await Promise.race([
            abortPromise.then(() => ({ aborted: true })),
            iterator.next().then(result => ({ result }))
          ]);

          if ('aborted' in winner || signal.aborted) break;
          const result = winner.result;

          if (result.done) break;

          // Gate check: Only emit if ALL auxiliary streams have emitted a value
          if (hasValue.length > 0 && hasValue.every(Boolean)) {
            output.next([result.value, ...latestValues] as [T, ...R]);
          }
        }
      } catch (err) {
        // Catch errors from source iteration
        if (!signal.aborted) {
          output.error(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        // --- 3. Cleanup on Completion/Error ---
        if (!signal.aborted) {
          output.complete();
        }
        // Ensure all resources are closed
        subscriptions.forEach(sub => sub.unsubscribe());
        if (typeof source.return === "function") {
          // Attempt to close the source iterator
          source.return().catch(() => {});
        }
      }
    })(); // End of main async IIFE

    // --- 4. Custom Subscription Handling ---
    const originalSubscribe = output.subscribe;
    output.subscribe = (
      callbackOrReceiver?: ((value: [T, ...R]) => MaybePromise) | Receiver<[T, ...R]>
    ): Subscription => {
      const receiver = createReceiver(callbackOrReceiver);
      const subscription = originalSubscribe.call(output, receiver);

      // Custom unsubscription logic ensures the main loop is aborted
      subscription.onUnsubscribe = () => {
        if (!signal.aborted) {
          abortController.abort();
        }
        subscription.unsubscribe();
        // Auxiliary subscriptions are cleaned up in the `finally` block of the IIFE
        // once the abort signal propagates, but we call them here for immediate effect
        // if they haven't been resolved yet (less common, but safe).
        subscriptions.forEach(sub => sub.unsubscribe()); 
      };

      return subscription;
    };

    // Return the async iterator for stream piping compatibility
    return eachValueFrom(output);
  });
}
