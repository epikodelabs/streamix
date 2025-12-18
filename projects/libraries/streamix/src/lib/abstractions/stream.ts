import { firstValueFrom } from "../converters";
import { generateStreamId, generateSubscriptionId, getRuntimeHooks } from "./hooks";
import { MaybePromise, Operator, OperatorChain } from "./operator";
import { createReceiver, Receiver } from "./receiver";
import { scheduler } from "./scheduler";
import { createSubscription, Subscription } from "./subscription";

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
  [Symbol.asyncIterator](): AsyncGenerator<T>;
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
): AsyncGenerator<T> {
  async function* generator(): AsyncGenerator<T> {
    /** Resolver for the next awaited iterator result */
    let resolveNext: ((value: IteratorResult<T>) => void) | null = null;

    /** Rejector for the next awaited iterator result */
    let rejectNext: ((error: any) => void) | null = null;

    /** Indicates that the stream has completed */
    let completed = false;

    /** Stores terminal error (if any) */
    let error: any = null;

    /** Value buffer when producer outpaces consumer */
    const queue: T[] = [];

    const subscription = register({
      next(value: T) {
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          rejectNext = null;
          r({ done: false, value });
        } else {
          queue.push(value);
        }
      },

      error(err: any) {
        error = err;
        if (rejectNext) {
          const r = rejectNext;
          resolveNext = null;
          rejectNext = null;
          r(err);
        }
        subscription.unsubscribe();
      },

      complete() {
        completed = true;
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          rejectNext = null;
          r({ done: true, value: undefined });
        }
        subscription.unsubscribe();
      },
    });

    try {
      while (true) {
        if (error) throw error;

        if (queue.length > 0) {
          yield queue.shift()!;
        } else if (completed) {
          break;
        } else {
          const result = await new Promise<IteratorResult<T>>((resolve, reject) => {
            resolveNext = resolve;
            rejectNext = reject;
          });

          if (result.done) {
            break;
          } else {
            yield result.value as T;
          }
        }
      }
    } finally {
      subscription.unsubscribe();
    }
  }

  return generator();
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
  const safeSchedule = (cb: () => MaybePromise) =>
    scheduler.enqueue(cb).catch(() => {});

  if (receiver.next) {
    wrapped.next = (value: T) =>
      safeSchedule(async () => {
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
      return safeSchedule(() => {
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
      safeSchedule(() => {
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
  iterator: AsyncIterator<T>,
  getReceivers: () => Array<SubscriberEntry<T>>,
  signal: AbortSignal
): Promise<void> {
  const abortPromise = waitForAbort(signal);

  try {
    while (true) {
      const winner = await Promise.race([
        abortPromise.then(() => ({ aborted: true } as const)),
        iterator.next().then(result => ({ result })),
      ]);

      if ("aborted" in winner || signal.aborted) break;

      const { result } = winner;
      if (result.done) break;

      const receivers = getReceivers();
      for (const { receiver, subscription } of receivers) {
        if (!subscription.unsubscribed) {
          receiver.next?.(result.value);
        }
      }
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
  generatorFn: () => AsyncGenerator<T, void, unknown>
): Stream<T> {
  const id = generateStreamId();

  getRuntimeHooks()?.onCreateStream?.({ id, name });

  const activeSubscriptions = new Set<SubscriberEntry<T>>();
  let isRunning = false;
  let abortController = new AbortController();

  const getActiveReceivers = () => Array.from(activeSubscriptions);

  /**
   * Starts the shared generator loop.
   * Called only when transitioning from zero to one subscriber.
   */
  const startMulticastLoop = () => {
    isRunning = true;
    abortController = new AbortController();

    (async () => {
      const signal = abortController.signal;
      const iterator = generatorFn()[Symbol.asyncIterator]();

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
      const entry = getActiveReceivers().find(
        s => s.subscription === subscription
      );

      if (entry) {
        activeSubscriptions.delete(entry);
        entry.receiver.complete?.();
      }

      if (activeSubscriptions.size === 0) {
        abortController.abort();
      }
    });

    activeSubscriptions.add({ receiver: wrapped, subscription });

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
    [Symbol.asyncIterator]: () => createAsyncGenerator(registerReceiver),
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
    name: `${source.name}-piped`,
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

    [Symbol.asyncIterator]: () => createAsyncGenerator(registerReceiver),
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
