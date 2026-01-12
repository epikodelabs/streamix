import { firstValueFrom } from "../converters";
import { getCurrentEmissionStamp, getIteratorEmissionStamp, nextEmissionStamp, setIteratorEmissionStamp, withEmissionStamp } from "./emission";
import { generateStreamId, generateSubscriptionId, getRuntimeHooks } from "./hooks";
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
export const isStreamLike = <T = unknown>(value: unknown): value is Stream<T> => {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  const v: any = value as any;
  return (v.type === "stream" || v.type === "subject") && typeof v[Symbol.asyncIterator] === "function";
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

  return new Promise(resolve =>
    signal.addEventListener("abort", resolve as any, { once: true })
  );
}

/**
 * Creates a pull-based async generator view over a stream.
 *
 * This bridges the push-based subscription model with
 * the pull-based async-iterator protocol.
 *
 * Characteristics:
 * - Buffers values when the producer is faster than the consumer
 * - Propagates errors via generator throws
 * - Guarantees subscription cleanup on completion, error, or early exit
 *
 * @template T
 * @param register Function registering a receiver and returning a subscription
 * @returns AsyncGenerator yielding stream values
 */
export function createAsyncGenerator<T = any>(
  register: (receiver: Receiver<T>) => Subscription
): AsyncIterator<T> {
  let resolveNext: ((value: IteratorResult<T>) => void) | null = null;
  let rejectNext: ((error: any) => void) | null = null;
  let completed = false;
  let terminalError: any = null;
  const queue: Array<{ value: T; stamp: number; resolve?: () => void }> = [];
  let ackResolver: (() => void) | null = null;

  let subscription: Subscription | undefined;
  let pendingUnsubscribe = false;

  const ensureSubscription = () => {
    if (subscription || completed || terminalError) return;
    subscription = register(receiverCallbacks);
    if (pendingUnsubscribe) {
      const sub = subscription;
      subscription = undefined;
      pendingUnsubscribe = false;
      sub?.unsubscribe();
    }
  };

  const requestUnsubscribe = (): void => {
    if (subscription) {
      const sub = subscription;
      subscription = undefined;
      sub.unsubscribe();
      return;
    }

    pendingUnsubscribe = true;
  };

  const iterator: AsyncIterator<T> & AsyncIterable<T> & {
    __tryNext?: () => IteratorResult<T> | null;
    __hasBufferedValues?: () => boolean;
  } = {
    async next(): Promise<IteratorResult<T>> {
      if (ackResolver) { const r = ackResolver; ackResolver = null; r(); }

      if (terminalError) throw terminalError;

      ensureSubscription();
      if (terminalError) throw terminalError;

      if (queue.length > 0) {
        const item = queue.shift()!;
        if (item.resolve) ackResolver = item.resolve;
        setIteratorEmissionStamp(iterator as any, item.stamp);
        return { done: false, value: item.value };
      }

      if (completed) {
        return { done: true, value: undefined };
      }

      return await new Promise<IteratorResult<T>>((resolve, reject) => {
        resolveNext = resolve;
        rejectNext = reject;
      });
    },

    async return(value?: any): Promise<IteratorResult<T>> {
      if (ackResolver) { const r = ackResolver; ackResolver = null; r(); }
      completed = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        rejectNext = null;
        r({ done: true, value });
      }
      requestUnsubscribe();
      return { done: true, value };
    },

    async throw(err?: any): Promise<IteratorResult<T>> {
      if (ackResolver) { const r = ackResolver; ackResolver = null; r(); }
      terminalError = err;
      if (rejectNext) {
        const r = rejectNext;
        resolveNext = null;
        rejectNext = null;
        r(err);
      }
      requestUnsubscribe();
      throw err;
    },

    [Symbol.asyncIterator]() {
      return this as any;
    },
  };

  iterator.__tryNext = (): IteratorResult<T> | null => {
    if (ackResolver) { const r = ackResolver; ackResolver = null; r(); }

    if (terminalError) throw terminalError;

    ensureSubscription();

    if (terminalError) throw terminalError;

    if (queue.length > 0) {
      const item = queue.shift()!;
      if (item.resolve) ackResolver = item.resolve;
      setIteratorEmissionStamp(iterator as any, item.stamp);
      return { done: false, value: item.value };
    }

    if (completed) {
      return { done: true, value: undefined };
    }

    return null;
  };

  iterator.__hasBufferedValues = () => queue.length > 0;

  const receiverCallbacks: Receiver<T> = {
    next(value: T) {
      if (completed || terminalError) return;

      const currentStamp = getCurrentEmissionStamp();
      const baseStamp = currentStamp ?? nextEmissionStamp();
      const stamp = currentStamp === null ? -baseStamp : baseStamp;

      let resolve!: () => void;
      const p = new Promise<void>(r => resolve = r);

      if (resolveNext) {
        setIteratorEmissionStamp(iterator as any, stamp);
        const r = resolveNext;
        resolveNext = null;
        rejectNext = null;
        ackResolver = resolve;
        r({ done: false, value });
      } else {
        queue.push({ value, stamp, resolve });
      }

      return p;
    },

    error(err: any) {
      if (completed || terminalError) return;
      terminalError = err;
      completed = true;

      const currentStamp = getCurrentEmissionStamp();
      const stamp = currentStamp ?? nextEmissionStamp();

      if (rejectNext) {
        setIteratorEmissionStamp(iterator, stamp);
        const r = rejectNext;
        resolveNext = null;
        rejectNext = null;
        r(err);
      }
      requestUnsubscribe();
    },

    complete() {
      if (completed || terminalError) return;
      completed = true;

      const currentStamp = getCurrentEmissionStamp();
      const stamp = currentStamp ?? nextEmissionStamp();

      if (resolveNext) {
        setIteratorEmissionStamp(iterator, stamp);
        const r = resolveNext;
        resolveNext = null;
        rejectNext = null;
        r({ done: true, value: undefined });
      }
      requestUnsubscribe();
    },
  };

  (receiverCallbacks as any).__wantsRawValues = true;

  return iterator;
}

/**
 * Wraps a Receiver so all callbacks are executed via the scheduler.
 *
 * Guarantees:
 * - All callbacks are async-scheduled (no sync re-entrancy)
 * - Errors thrown in `next` are forwarded to `error` if present
 * - Errors in `error` or `complete` are swallowed
 *
 * @template T
 * @param receiver Original receiver
 * @returns Wrapped receiver
 */
function wrapReceiver<T>(receiver: Receiver<T>): Receiver<T> {
  const wrapped: Receiver<T> = {};

  /**
   * Schedules a callback safely, ensuring scheduler errors
   * do not propagate into the stream core.
   */
  const execute = (cb: () => MaybePromise) => {
    const stamp = getCurrentEmissionStamp();
    if (stamp !== null) {
      // ⚡️ Synchronous execution when within an emission context
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

/**
 * Consumes an async iterator and forwards emitted values to receivers.
 *
 * Semantics:
 * - Stops on iterator completion or abort
 * - Abort does NOT trigger `complete`
 * - Natural completion DOES trigger `complete`
 * - Generator-thrown errors are forwarded to receivers
 *
 * @template T
 * @param iterator Async iterator to drain
 * @param getReceivers Function returning active receivers
 * @param signal Abort signal controlling cancellation
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
        iterator.next().then(result => ({ result })),
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
        }
      }
    }
  } finally {
    if (iterator.return) {
      try {
        await iterator.return();
      } catch {}
    }

    if (!signal.aborted) {
      for (const { receiver, subscription } of getReceivers()) {
        if (!subscription.unsubscribed) {
          receiver.complete?.();
        }
      }
    }
  }
}

/**
 * Creates a multicast stream backed by a shared async generator.
 *
 * @template T
 * @param name Stream name (debugging / tooling)
 * @param generatorFn Factory producing an async generator
 * @returns Multicast Stream instance
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

  /**
   * Starts the shared generator loop.
   * Called only when transitioning from zero to one subscriber.
   */
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

  /**
   * Registers a receiver and manages generator lifecycle.
   *
   * @param receiver Receiver to attach
   * @returns Subscription controlling the attachment
   */
  const registerReceiver = (receiver: Receiver<T>): Subscription => {
    const wrapped = wrapReceiver(receiver);
    let subscription!: Subscription;

    subscription = createSubscription(async () => {
      const entry = activeSubscriptions.find(
        s => s.subscription === subscription
      );

      if (entry) {
        activeSubscriptions = activeSubscriptions.filter(s => s !== entry);
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
    subscribe: cb => registerReceiver(createReceiver(cb)),
    query: () => firstValueFrom(self),
    [Symbol.asyncIterator]: () => {
      const it = createAsyncGenerator(registerReceiver);
      (it as any).__streamix_streamId = id;
      return it;
    },
  };

  return self;
}

/**
 * Pipes a source stream through a chain of operators,
 * producing a derived unicast stream.
 *
 * @template TIn
 * @template Ops
 * @param source Source stream
 * @param operators Operators applied to the source
 * @returns Derived unicast Stream
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
      const it = createAsyncGenerator(registerReceiver);
      (it as any).__streamix_streamId = pipedStream.id;
      return it;
    },
  };

  /**
   * Registers a receiver for a derived (unicast) stream.
   *
   * @param receiver Receiver to attach
   * @returns Subscription controlling execution
   */
  function registerReceiver(receiver: Receiver<any>): Subscription {
    const wrapped = wrapReceiver(receiver);

    const subscriptionId = generateSubscriptionId();
    const hooks = getRuntimeHooks();

    let iterator: AsyncIterator<any> =
      source[Symbol.asyncIterator]();

    let ops: Operator<any, any>[] = operators;
    let finalWrap:
      | ((it: AsyncIterator<any>) => AsyncIterator<any>)
      | undefined;

    if (hooks?.onPipeStream) {
      const patch = hooks.onPipeStream({
        streamName: source.name,
        streamId: source.id,
        subscriptionId,
        source: iterator,
        operators: ops,
      });

      if (patch?.source) iterator = patch.source;
      if (patch?.operators) ops = patch.operators;
      if (patch?.final) finalWrap = patch.final;
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

    drainIterator(
      iterator,
      () => [{ receiver: wrapped, subscription }],
      signal
    ).catch(() => {});

    return subscription;
  }

  return pipedStream;
}
