import { firstValueFrom } from "../converters";
import { createAsyncIterator } from "../subjects/helpers";
import {
  getCurrentEmissionStamp,
  getIteratorEmissionStamp,
  nextEmissionStamp,
  withEmissionStamp,
} from "./emission";
import {
  generateStreamId,
  generateSubscriptionId,
  getRuntimeHooks,
} from "./hooks";
import type { MaybePromise, Operator, OperatorChain } from "./operator";
import { createReceiver, type Receiver } from "./receiver";
import { createSubscription, type Subscription } from "./subscription";

/**
 * A reactive stream representing a sequence of values over time.
 *
 * Streams support:
 * - **Subscription** to receive asynchronous values.
 * - **Operator chaining** through `.pipe()`.
 * - **Querying** the first emitted value.
 * - **Async iteration** via `for await...of`.
 *
 * Two variants exist:
 * - `"stream"`: automatically driven, typically created by `createStream()`.
 * - `"subject"`: manually driven (not implemented here but retained for API symmetry).
 *
 * @template T The value type emitted by the stream.
 */
export type Stream<T = any> = AsyncIterable<T> & {
  /** Identifies the underlying behavior of the stream. */
  type: "stream" | "subject";

  /** Human-readable name primarily for debugging and introspection. */
  name?: string;

  /**
   * Internal unique identifier of the stream instance.
   *
   * Used by runtime hooks (e.g. tracing, profiling, devtools).
   * Not part of the public reactive API.
   */
  id: string;

  /**
   * Creates a new derived stream by applying one or more `Operator`s.
   *
   * Operators compose into an async-iterator pipeline, transforming emitted values.
   */
  pipe: OperatorChain<T>;

  /**
   * Subscribes to the stream.
   *
   * A callback or Receiver will be invoked for each next/error/complete event.
   * Returns a `Subscription` that may be used to unsubscribe.
   *
   * Note: `complete` can be invoked on unsubscribe (and after error) to give
   * receivers a single cleanup hook.
   */
  subscribe: (
    callback?: ((value: T) => MaybePromise) | Receiver<T>
  ) => Subscription;

  /**
   * Convenience method for retrieving the first emitted value.
   *
   * Internally subscribes, resolves on the first `next`, and then unsubscribes.
   */
  query: () => Promise<T>;

  /** Allows direct async iteration: `for await (const value of stream) { ... }`. */
  [Symbol.asyncIterator](): AsyncIterator<T>;
};

/**
 * Type guard for Stream-like objects.
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

/**
 * Internal bookkeeping entry binding a receiver to its subscription.
 *
 * This structure is never exposed publicly and is used only for
 * multicast coordination and cleanup.
 */
type SubscriberEntry<T> = {
  receiver: Receiver<T>;
  subscription: Subscription;
};

/**
 * Returns a promise that resolves when an AbortSignal becomes aborted.
 *
 * If the signal is already aborted, the promise resolves immediately.
 *
 * @param signal AbortSignal to observe
 * @returns Promise resolved on abort
 */
function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) =>
    signal.addEventListener("abort", resolve as any, { once: true })
  );
}

/* ========================================================================== */
/* AsyncGenerator bridge removed — consolidated to createAsyncIterator in subjects/helpers */

/* ========================================================================== */
/* Receiver scheduling wrapper                                                 */
/* ========================================================================== */

/**
 * Wraps a Receiver so all callbacks are executed via the scheduler.
 *
 * Guarantees:
 * - All callbacks are async-scheduled (no sync re-entrancy)
 * - Errors thrown in `next` are forwarded to `error` if present
 * - Errors in `error` or `complete` are swallowed
 */
function wrapReceiver<T>(receiver: Receiver<T>): Receiver<T> {
  const wrapped: Receiver<T> = {};

  const execute = (cb: () => MaybePromise) => {
    const stamp = getCurrentEmissionStamp();
    if (stamp !== null) {
      // Synchronous execution when within an emission context
      return cb();
    }
    return Promise.resolve().then(cb).catch(() => {});
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
              /* swallowed by design */
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
          /* swallowed */
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
          /* swallowed */
        }
      });
  }

  return wrapped;
}

/* ========================================================================== */
/* Drain iterator to receivers                                                 */
/* ========================================================================== */

/**
 * Consumes an async iterator and forwards emitted values to receivers.
 *
 * Semantics:
 * - Stops on iterator completion or abort
 * - Abort does NOT trigger `complete`
 * - Natural completion DOES trigger `complete`
 * - Iterator-thrown errors are forwarded to receivers
 */
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
    if (iterator.return) {
      try {
        await iterator.return();
      } catch {}
    }

    if (!signal.aborted && !forwardedError) {
      for (const { receiver, subscription } of getReceivers()) {
        if (!subscription.unsubscribed) {
          receiver.complete?.();
        }
      }
    }
  }
}

/* ========================================================================== */
/* createStream                                                                */
/* ========================================================================== */

/**
 * Creates a multicast stream backed by a shared async generator.
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
      }
    })();
  };

  const registerReceiver = (receiver: Receiver<T>): Subscription => {
    const wrapped = wrapReceiver(receiver);
    let subscription!: Subscription;

    subscription = createSubscription(async () => {
      const entry = activeSubscriptions.find((s) => s.subscription === subscription);

      if (entry) {
        activeSubscriptions = activeSubscriptions.filter((s) => s !== entry);
        entry.receiver.complete?.();
      }

      if (activeSubscriptions.length === 0) {
        abortController.abort();
      }
    });

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
      const factory = createAsyncIterator({ register: registerReceiver });
      const it = factory();
      (it as any).__streamix_streamId = id;
      return it;
    },
  };

  return self;
}

/* ========================================================================== */
/* pipeSourceThrough                                                           */
/* ========================================================================== */

/**
 * Pipes a source stream through a chain of operators,
 * producing a derived unicast stream.
 */
export function pipeSourceThrough<TIn, Ops extends Operator<any, any>[]>(
  source: Stream<TIn>,
  operators: [...Ops]
): Stream<any> {
  const pipedStream: Stream<any> = {
    name: `${source.name}Sink`,
    id: generateStreamId(),
    type: "stream",

    pipe: ((...nextOps: Operator<any, any>[]) =>
      pipeSourceThrough(source, [...operators, ...nextOps])) as OperatorChain<any>,

    subscribe(cb?: ((value: any) => MaybePromise) | Receiver<any>) {
      return registerReceiver(createReceiver(cb));
    },

    query() {
      return firstValueFrom(pipedStream);
    },

    [Symbol.asyncIterator]: () => {
      const factory = createAsyncIterator({ register: registerReceiver });
      const it = factory();
      (it as any).__streamix_streamId = pipedStream.id;
      return it;
    },
  };

  function registerReceiver(receiver: Receiver<any>): Subscription {
    const wrapped = wrapReceiver(receiver);

    const subscriptionId = generateSubscriptionId();
    const hooks = getRuntimeHooks();

    let iterator: AsyncIterator<any> = source[Symbol.asyncIterator]();

    let ops: Operator<any, any>[] = operators;
    let finalWrap: ((it: AsyncIterator<any>) => AsyncIterator<any>) | undefined;

    if (hooks?.onPipeStream) {
      const patch = hooks.onPipeStream({
        streamName: source.name,
        streamId: source.id,
        subscriptionId,
        source: iterator,
        operators: ops,
      });

      if (patch && typeof patch === 'object') {
        if ('source' in patch && patch.source) iterator = patch.source;
        if ('operators' in patch && patch.operators) ops = patch.operators;
        if ('final' in patch && patch.final) finalWrap = patch.final;
      }
    }

    for (const op of ops) {
      iterator = op.apply(iterator);
    }

    if (finalWrap) {
      iterator = finalWrap(iterator);
    }

    const abortController = new AbortController();
    const signal = abortController.signal;

    const subscription = createSubscription(async () => {
      abortController.abort();
      wrapped.complete?.();
    });

    drainIterator(iterator, () => [{ receiver: wrapped, subscription }], signal).catch(
      () => {}
    );

    return subscription;
  }

  return pipedStream;
}
