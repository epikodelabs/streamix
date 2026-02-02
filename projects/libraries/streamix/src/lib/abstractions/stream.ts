import { firstValueFrom } from "../converters";
import { enqueueMicrotask, runInMicrotask } from "../primitives/scheduling";
import { createAsyncIterator } from "../subjects/helpers";
import {
  getCurrentEmissionStamp,
  getIteratorEmissionStamp,
  nextEmissionStamp,
  withEmissionStamp
} from "./emission";
import {
  applyPipeStreamHooks,
  generateStreamId,
  generateSubscriptionId,
  getRuntimeHooks
} from "./hooks";
import type { MaybePromise, Operator, OperatorChain } from "./operator";
import { createReceiver, type Receiver } from "./receiver";
import { createSubscription, type Subscription } from "./subscription";

/**
 * A Stream is an async iterable with additional methods for piping, subscribing, and querying values.
 *
 * @template T The type of values emitted by the stream.
 */
export type Stream<T = any> = AsyncIterable<T> & {
  type: "stream" | "subject";
  name?: string;
  id: string;
  pipe: OperatorChain<T>;
  subscribe: (
    callback?: ((value: T) => MaybePromise) | Receiver<T>
  ) => Subscription;
  query: () => Promise<T>;
  [Symbol.asyncIterator](): AsyncIterator<T>;
};

/**
 * Type guard to check if a value is stream-like (has type and async iterator).
 *
 * @template T
 * @param value The value to check.
 * @returns {boolean} True if the value is a Stream.
 */
export const isStreamLike = <T = unknown>(
  value: unknown
): value is Stream<T> => {
  if (!value || (typeof value !== "object" && typeof value !== "function"))
    return false;
  const v: any = value as any;
  return (
    (v.type === "stream" || v.type === "subject") &&
    typeof v[Symbol.asyncIterator] === "function"
  );
};

type SubscriberEntry<T> = {
  receiver: Receiver<T>;
  subscription: Subscription;
};

function waitForAbort(signal: AbortSignal): Promise<void> {

  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener("abort", resolve as any, { once: true })
  );
}

function wrapReceiver<T>(receiver: Receiver<T>): Receiver<T> {
  const wrapped: Receiver<T> = {};

  const execute = (cb: () => MaybePromise) => {
    const stamp = getCurrentEmissionStamp();
    if (stamp !== null) {
      try {
        return cb();
      } catch (err) {
        return Promise.reject(err);
      }
    }

    return runInMicrotask(cb).then(() => void 0);
  };

  if (receiver.next) {
    wrapped.next = (value: T) =>
      execute(async () => {
        try {
          await receiver.next!(value);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          if (receiver.error) {
            try {
              await receiver.error!(error);
            } catch {
            }
          }
        }
      });
  }

  if (receiver.error) {
    wrapped.error = (err: any) => {
      const error = err instanceof Error ? err : new Error(String(err));
      return execute(() => {
        try {
          return receiver.error!(error);
        } catch {
        }
      });
    };
  }

  if (receiver.complete) {
    wrapped.complete = () =>
      execute(() => {
        try {
          return receiver.complete!();
        } catch {
        }
      });
  }

  return wrapped;
}

async function drainIterator<T>(
  iterator: AsyncIterator<T> & { __tryNext?: () => IteratorResult<T> | null },
  getReceivers: () => Array<SubscriberEntry<T>>,
  signal: AbortSignal
): Promise<void> {
  const abortPromise = waitForAbort(signal);

  const processResult = (result: IteratorResult<T>) => {
    if (result.done) return true;

    const stamp = getIteratorEmissionStamp(iterator) ?? nextEmissionStamp();
    const receivers = getReceivers();

    const forward = () => {
      for (const { receiver, subscription } of receivers) {
        if (!subscription.unsubscribed) {
          receiver.next?.(result.value);
        }
      }
    };


  /**
   * Creates a multicast {@link Stream} from an async generator factory.
   *
   * The returned Stream starts producing values on the first subscription and
   * delivers each yielded value to *all* active subscribers.
   *
   * - When the last subscriber unsubscribes, the underlying generator is aborted
   *   via an {@link AbortSignal}.
   * - When the generator completes, subscribers are completed and internal
   *   receiver references are cleared to avoid memory growth in long-running
   *   processes/tests.
   * - A new subscription after completion starts a fresh generator run.
   *
   * Receiver callbacks are executed in a microtask when there is no active
   * emission context, which helps keep delivery ordering consistent and avoids
   * surprising re-entrancy.
   *
   * @template T Value type emitted by the stream.
   * @param name Human-friendly name (used for debugging/tracing).
   * @param generatorFn Async generator factory. Receives an optional AbortSignal
   * that is aborted when the stream is torn down.
   * @returns A Stream that can be piped, subscribed to, or iterated.
   *
   * @example
   * const s = createStream('ticks', async function* (signal) {
   *   while (!signal?.aborted) {
   *     yield Date.now();
   *     await new Promise(r => setTimeout(r, 1000));
   *   }
   * });
   */
    withEmissionStamp(stamp, forward);
    return false;
  };

  let forwardedError = false;

  try {
    while (true) {
      if (iterator.__tryNext) {
        while (true) {
          const nextResult = iterator.__tryNext();
          if (!nextResult) break;
          if (processResult(nextResult)) return;
        }
      }

      const winner = await Promise.race([
        abortPromise.then(() => ({ aborted: true } as const)),
        iterator.next().then((result) => ({ result })),
      ]);

      if ("aborted" in winner || signal.aborted) break;

      if (processResult(winner.result)) break;
    }
  } catch (err) {
    if (!signal.aborted) {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const { receiver, subscription } of getReceivers()) {
        if (!subscription.unsubscribed) {
          receiver.error?.(error);
          forwardedError = true;
        }
      }
    }
  } finally {
    const entries = getReceivers();

    if (iterator.return) {
      try {
        await iterator.return();
      } catch {}
    }

    if (!signal.aborted && !forwardedError) {
      for (const { receiver, subscription } of entries) {
        if (!subscription.unsubscribed) {
          receiver.complete?.();
        }
      }
    }

    // Streams created with `createStream` keep subscribers in an array until they
    // explicitly unsubscribe. Most consumers/tests do not call `unsubscribe()`
    // after natural completion, so we drop references here to prevent receiver
    // growth across long test runs.
    entries.length = 0;
  }
}

/**
 * Creates a multicast {@link Stream} from an async generator factory.
 *
 * The returned Stream starts producing values on the first subscription and
 * delivers each yielded value to *all* active subscribers.
 *
 * - When the last subscriber unsubscribes, the underlying generator is aborted
 *   via an {@link AbortSignal}.
 * - When the generator completes, subscribers are completed and internal
 *   receiver references are cleared to avoid memory growth in long-running
 *   processes/tests.
 * - A new subscription after completion starts a fresh generator run.
 *
 * Receiver callbacks are executed in a microtask when there is no active
 * emission context, which helps keep delivery ordering consistent and avoids
 * surprising re-entrancy.
 *
 * @template T Value type emitted by the stream.
 * @param name Human-friendly name (used for debugging/tracing).
 * @param generatorFn Async generator factory. Receives an optional AbortSignal
 * that is aborted when the stream is torn down.
 * @returns A Stream that can be piped, subscribed to, or iterated.
 *
 * @example
 * const s = createStream('ticks', async function* (signal) {
 *   while (!signal?.aborted) {
 *     yield Date.now();
 *     await new Promise(r => setTimeout(r, 1000));
 *   }
 * });
 */
export function createStream<T>(
  name: string,
  generatorFn: (signal?: AbortSignal) => AsyncGenerator<T, void, unknown>
): Stream<T> {
  const id = generateStreamId();

  getRuntimeHooks()?.onCreateStream?.({ id, name });

  let activeSubscriptions: SubscriberEntry<T>[] = [];
  let isRunning = false;
  let abortController = new AbortController();

  const getActiveReceivers = () => activeSubscriptions;

  const startMulticastLoop = () => {
    isRunning = true;
    abortController = new AbortController();

    (async () => {
      const signal = abortController.signal;
      const iterator = generatorFn(signal)[Symbol.asyncIterator]();
      try {
        await drainIterator(iterator, getActiveReceivers, signal);
      } finally {
        isRunning = false;
        // Once the generator terminates, all current subscribers are terminal.
        // Clear references so future subscriptions restart cleanly and we don't
        // retain completed receivers between runs.
        activeSubscriptions = [];
      }
    })();
  };

  const registerReceiver = (receiver: Receiver<T>): Subscription => {
    const wrapped = wrapReceiver(receiver);
    let subscription!: Subscription;

    subscription = createSubscription(async () => {
      return runInMicrotask(async () => {
        const entry = activeSubscriptions.find(
          (s) => s.subscription === subscription
        );

        if (entry) {
          activeSubscriptions = activeSubscriptions.filter((s) => s !== entry);
          entry.receiver.complete?.();
        }

        if (activeSubscriptions.length === 0) {
          abortController.abort();
        }
      });
    });

    // IMPORTANT: register synchronously so operators like switchMap can
    // subscribe/unsubscribe inner streams in the same tick without racing the
    // microtask-delivery loop. Receiver callbacks are still scheduled by `wrapReceiver`.
    activeSubscriptions = [...activeSubscriptions, { receiver: wrapped, subscription }];

    if (!isRunning) {
      startMulticastLoop();
    }

    return subscription;
  };

  let self!: Stream<T>;

  const pipe = ((...ops: Operator<any, any>[]) =>
    pipeSourceThrough(self, ops)) as OperatorChain<T>;

  self = {
    type: "stream",
    name,
    id,
    pipe,
    subscribe: (cb) => registerReceiver(createReceiver(cb)),
    query: () => firstValueFrom(self),
    [Symbol.asyncIterator]: () => {
      const factory = createAsyncIterator({ register: registerReceiver, lazy: true });
      const it = factory();
      (it as any).__streamix_streamId = id;
      return it;
    },
  };

  return self;
}

/**
 * Applies a list of operators to a source stream and returns the resulting stream.
 *
 * This is the implementation behind `stream.pipe(...)`. It creates a new stream
 * identity (stream id) for the piped stream and ensures runtime hooks are
 * invoked consistently for both `subscribe()` and direct async iteration.
 *
 * @template TIn Source value type.
 * @param source Source stream.
 * @param operators Operators to apply, in order.
 * @returns A new Stream that emits the transformed values.
 */
export function pipeSourceThrough<TIn, Ops extends Operator<any, any>[]>(
  source: Stream<TIn>,
  operators: [...Ops]
): Stream<any> {
  const pipedId = generateStreamId();

  function registerReceiver(receiver: Receiver<any>): Subscription {
    const wrapped = wrapReceiver(receiver);
    const abortController = new AbortController();
    const signal = abortController.signal;

      const subscription = createSubscription(async () => {
        return runInMicrotask(async () => {
          abortController.abort();
          wrapped.complete?.();
        });
      });
      const subscriptionId = subscription.id;
      const baseSource = source[Symbol.asyncIterator]();
      const iterator = applyPipeStreamHooks({
        streamId: pipedId,
        streamName: source.name,
        subscriptionId,
        source: baseSource,
        operators,
      });

    enqueueMicrotask(() => {
      drainIterator(iterator, () => [{ receiver: wrapped, subscription }], signal).catch(
        () => {}
      );
    });

    return subscription;
  }

  const pipedStream: Stream<any> = {
    name: `${source.name}Sink`,
    id: pipedId,
    type: "stream",
    pipe: (...nextOps: Operator<any, any>[]) => pipeSourceThrough(source, [...operators, ...nextOps]),
    subscribe: (cb) => registerReceiver(createReceiver(cb)),
    query: () => firstValueFrom(pipedStream),
    [Symbol.asyncIterator]: () => {
      const subscriptionId = generateSubscriptionId();
      const baseSource = source[Symbol.asyncIterator]();
      return applyPipeStreamHooks({
        streamId: pipedId,
        streamName: source.name,
        subscriptionId,
        source: baseSource,
        operators,
      });
    },
  };

  return pipedStream;
}
