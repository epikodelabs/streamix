import { createOperator, createReceiver, DONE, getIteratorMeta, isPromiseLike, Receiver, type MaybePromise, type Operator, type Stream, type Subscription } from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";
import { createSubject } from "../subjects";
import { tagValue } from "./helpers";

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
): Operator<T, [T, ...R]>;

/**
 * Overload that accepts an array/tuple of auxiliary sources.
 *
 * @template T
 * @template R
 * @param streams Tuple/array of auxiliary sources.
 * @returns An operator that emits `[sourceValue, ...latestAuxValues]`.
 */
export function withLatestFrom<T = any, R extends readonly unknown[] = any[]>(
  streams: { [K in keyof R]: Stream<R[K]> | MaybePromise<R[K]> }
): Operator<T, [T, ...R]>;

/**
 * Implementation signature.
 *
 * @internalRemarks
 * Supports both `withLatestFrom(a, b, c)` and `withLatestFrom([a, b, c])`.
 */
export function withLatestFrom<T = any, R extends readonly unknown[] = any[]>(
  ...streams: any[]
) {
  return createOperator<T, [T, ...R]>("withLatestFrom", function (this: Operator, source) {
    const output = createSubject<[T, ...R]>();
    const outputIterator = eachValueFrom(output);
    const abortController = new AbortController();
    const { signal } = abortController;
    
    let latestValues: any[] = [];
    let hasValue: boolean[] = [];
    const subscriptions: Subscription[] = [];
    let errorEmitted = false;
    let auxiliaryError: any = null;
    let isCompleted = false;
    const normalizedInputs = streams.length === 1 && Array.isArray(streams[0]) ? streams[0] : streams;

    // Setup function for auxiliary streams
    const setupAuxiliary = (inputs: any[]) => {
      latestValues = new Array(inputs.length).fill(undefined);
      hasValue = new Array(inputs.length).fill(false);

      for (let i = 0; i < inputs.length; i++) {
        const subscription = fromAny(inputs[i]).subscribe({
          next: (value) => {
            latestValues[i] = value;
            hasValue[i] = true;
          },
          error: (err) => {
            // Only the first error is recorded
            if (!errorEmitted && !isCompleted) {
              errorEmitted = true;
              auxiliaryError = err instanceof Error ? err : new Error(String(err));
              // Emit error in next microtask to ensure proper propagation
              queueMicrotask(() => {
                if (!isCompleted) {
                  output.error(auxiliaryError);
                  abortController.abort();
                }
              });
            }
          },
        });
        subscriptions.push(subscription);
      }
    };

    const cleanup = async () => {
      subscriptions.forEach(sub => sub.unsubscribe());
      try {
        await source.return?.();
      } catch {}
    };

    // Main iteration function
    const iterate = async () => {
      try {
        // --- 1. Setup Auxiliary Streams ---
        const hasPromises = normalizedInputs.some(isPromiseLike);
        
        if (hasPromises) {
          const resolvedInputs = await Promise.all(
            normalizedInputs.map(async (stream) => (isPromiseLike(stream) ? await stream : stream))
          );
          
          if (signal.aborted) {
            cleanup();
            return;
          }
          
          setupAuxiliary(resolvedInputs);
        } else {
          setupAuxiliary(normalizedInputs);
        }

        // Check for auxiliary errors that occurred during setup
        if (auxiliaryError || signal.aborted) {
          cleanup();
          return;
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

          // Check for auxiliary errors each iteration
          if (auxiliaryError || signal.aborted) {
            cleanup();
            return;
          }

          if ('aborted' in winner) break;
          const result = winner.result;

          if (result.done) break;
          const meta = getIteratorMeta(source);

          // Gate check: Only emit if ALL auxiliary streams have emitted a value
          if (hasValue.length > 0 && hasValue.every(Boolean)) {
            const combined = tagValue(outputIterator, [result.value, ...latestValues] as [T, ...R], meta);
            output.next(combined);
          }
        }

        // Complete normally if no errors occurred
        if (!errorEmitted && !isCompleted) {
          isCompleted = true;
          output.complete();
        }
      } catch (err) {
        // Catch errors from source iteration
        if (!errorEmitted && !isCompleted) {
          errorEmitted = true;
          output.error(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        cleanup();
      }
    };

    // Start iteration
    iterate();

    // --- Custom Subscription Handling ---
    const originalSubscribe = output.subscribe;
    output.subscribe = (
      callbackOrReceiver?: ((value: [T, ...R]) => MaybePromise) | Receiver<[T, ...R]>
    ): Subscription => {
      const receiver = createReceiver(callbackOrReceiver);
      const subscription = originalSubscribe.call(output, receiver);

      const originalOnUnsubscribe = subscription.onUnsubscribe;
      subscription.onUnsubscribe = () => {
        if (!signal.aborted) {
          abortController.abort();
        }
        subscriptions.forEach(sub => sub.unsubscribe());
        originalOnUnsubscribe?.call(subscription);
      };

      return subscription;
    };

    const baseReturn = outputIterator.return?.bind(outputIterator);
    const baseThrow = outputIterator.throw?.bind(outputIterator);

    (outputIterator as any).return = async (value?: any) => {
      abortController.abort();
      await cleanup();
      if (!output.completed()) output.complete();
      return baseReturn ? baseReturn(value) : DONE;
    };

    (outputIterator as any).throw = async (err: any) => {
      abortController.abort();
      await cleanup();
      if (!output.completed()) output.error(err);
      if (baseThrow) return baseThrow(err);
      throw err;
    };

    return outputIterator;
  });
}