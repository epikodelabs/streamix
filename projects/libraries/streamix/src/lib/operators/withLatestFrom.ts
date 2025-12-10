import {
  createOperator,
  createReceiver,
  isPromiseLike,
  MaybePromise,
  Operator,
  Receiver,
  Stream,
  Subscription
} from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";
import { createSubject } from "../streams";

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
 *
 * @template T The type of the values in the source stream.
 * @template R The type of the values in the other streams.
 * @param streams An array of streams to combine with the source stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 * The output stream emits tuples of `[T, ...R]`.
 */
export function withLatestFrom<T = any, R extends readonly unknown[] = any[]>(streams: MaybePromise<{ [K in keyof R]: (Stream<R[K]> | Promise<R[K]> | Array<R[K]>)}>) {
  return createOperator<T, [T, ...R]>("withLatestFrom", function (this: Operator, source) {
    const output = createSubject<[T, ...R]>();
    let latestValues: any[] = [];
    let hasValue: boolean[] = [];
    const subscriptions: Subscription[] = [];

    (async () => {
      const resolvedStreams = isPromiseLike(streams) ? await streams : streams;
      const streamEntries = Object.values(resolvedStreams) as Array<Stream<R[number]> | Promise<R[number]> | Array<R[number]>>;
      latestValues = new Array(streamEntries.length).fill(undefined);
      hasValue = new Array(streamEntries.length).fill(false);

      for (let i = 0; i < streamEntries.length; i++) {
        const subscription = fromAny(streamEntries[i]).subscribe({
          next: (value) => {
            latestValues[i] = value;
            hasValue[i] = true;
          },
          error: (err) => {
            output.error(err);
          }
        });
        subscriptions.push(subscription);
      }
    })();

    const abortController = new AbortController();
    const { signal } = abortController;

    const abortPromise = new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
      } else {
        signal.addEventListener("abort", () => resolve(), { once: true });
      }
    });

    const iterator = source;

    (async () => {
      try {
        while (true) {
          const winner = await Promise.race([
            abortPromise.then(() => ({ aborted: true })),
            iterator.next().then(result => ({ result }))
          ]);

          if ('aborted' in winner || signal.aborted) break;
          const result = winner.result;

          if (result.done) break;

          if (hasValue.length > 0 && hasValue.every(Boolean)) {
            output.next([result.value, ...latestValues] as [T, ...R]);
          }
        }
      } catch (err) {
        if (!signal.aborted) {
          output.error(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        output.complete();
      }
    })();

    const originalSubscribe = output.subscribe;
    output.subscribe = (
      callbackOrReceiver?: ((value: [T, ...R]) => MaybePromise) | Receiver<[T, ...R]>
    ): Subscription => {
      const receiver = createReceiver(callbackOrReceiver);
      const subscription = originalSubscribe.call(output, receiver);

      subscription.onUnsubscribe = () => {
        abortController.abort();
        subscription.unsubscribe();
        subscriptions.forEach(sub => sub.unsubscribe());

        if (typeof iterator.return === "function") {
          iterator.return().catch(() => {});
        }
      };

      return subscription;
    };

    const iterable = eachValueFrom<[T, ...R]>(output);
    return iterable[Symbol.asyncIterator]();
  });
}
