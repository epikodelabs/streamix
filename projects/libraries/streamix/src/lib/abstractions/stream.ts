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

/** Internal subscriber bookkeeping type. */
type SubscriberEntry<T> = { receiver: Receiver<T>; subscription: Subscription };

/**
 * Returns a promise resolving when an AbortSignal becomes aborted.
 *
 * If already aborted, resolves immediately.
 */
function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve =>
    signal.addEventListener("abort", resolve as any, { once: true })
  );
}

/**
 * Creates a pull-based async iterator view over a stream's push-based events.
 *
 * This powers both `eachValueFrom` and direct `for await...of` consumption.
 * It registers a receiver with the stream, buffers incoming values, and yields
 * them to the consumer until completion or error. The underlying subscription
 * is always cleaned up when iteration ends or the consumer stops early.
 */
export function createAsyncGenerator<T = any>(
  register: (receiver: Receiver<T>) => Subscription
): AsyncGenerator<T> {
  async function* generator(): AsyncGenerator<T> {
    let resolveNext: ((value: IteratorResult<T>) => void) | null = null;
    let rejectNext: ((error: any) => void) | null = null;
    let completed = false;
    let error: any = null;
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
          try {
            const result = await new Promise<IteratorResult<T>>((resolve, reject) => {
              resolveNext = resolve;
              rejectNext = reject;
            });

            if (result.done) {
              break;
            } else {
              yield result.value as T;
            }
          } catch (err) {
            error = err;
            throw error;
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
 * Wraps a `Receiver<T>` so all lifecycle callbacks (`next`, `error`, `complete`)
 * run inside the scheduler's microtask queue.
 *
 * Guarantees:
 * - All user callbacks are async-scheduled.
 * - Errors thrown inside `next` are forwarded to `error` (if provided).
 * - Secondary errors inside `error` or `complete` are swallowed.
 */
function wrapReceiver<T>(receiver: Receiver<T>): Receiver<T> {
  const wrapped: Receiver<T> = {};

  const safeSchedule = (cb: () => MaybePromise) =>
    scheduler.enqueue(cb).catch(() => {});

  if (receiver.next) {
    wrapped.next = (value: T) => safeSchedule(async () => {
      try {
        await receiver.next!(value);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (receiver.error) {
          receiver.error!(error);
        }
      }
    });
  }

  if (receiver.error) {
    wrapped.error = (err: any) => safeSchedule(() => receiver.error!(err));
  }

  if (receiver.complete) {
    wrapped.complete = () => safeSchedule(() => receiver.complete!());
  }

  return wrapped;
}

/**
 * Drains an async iterator and dispatches yielded values to one or more receivers.
 *
 * Behavior:
 * - Uses `Promise.race` to respond to either `iterator.next()` or an abort event.
 * - Forwards values to all receivers whose subscriptions are still active.
 * - Forwards generator-thrown errors to receivers via `error`.
 * - Completes receivers on natural completion (`done: true`), not on abort.
 * - Ensures iterator finalization via `return()` if provided.
 *
 * The receiver callbacks (`next`, `error`, `complete`) are already wrapped to run
 * inside the scheduler, so this function does *not* itself schedule work.
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
    // Only generator-thrown errors reach here (not subscriber errors).
    if (!signal.aborted) {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const { receiver, subscription } of getReceivers()) {
        if (!subscription.unsubscribed) receiver.error?.(error);
      }
    }
  } finally {
    // Always try to finalize iterator
    if (iterator.return) {
      try {
        await iterator.return();
      } catch {}
    }

    // Only naturally-complete subscribers on non-abort
    if (!signal.aborted) {
      for (const { receiver, subscription } of getReceivers()) {
        if (!subscription.unsubscribed) receiver.complete?.();
      }
    }
  }
}

/**
 * Creates a **multicast reactive stream** backed by an async generator.
 *
 * ## Semantics
 * - The generator runs **once per active subscriber group**.
 * - The **first subscriber** starts the generator.
 * - Emitted values are **shared across all subscribers** (hot multicast).
 * - When the **last subscriber unsubscribes**, the generator is aborted.
 * - A later subscriber causes the generator to **restart** (cold restart).
 *
 * ## Scheduler guarantees
 * - All receiver callbacks (`next`, `error`, `complete`) are executed inside
 *   the scheduler's microtask queue.
 *
 * ## Runtime hooks
 * If runtime hooks are registered (e.g. tracing, profiling, devtools),
 * `onCreateStream` is invoked with the generated stream identifier.
 *
 * @template T
 * @param name Optional human-readable stream label.
 * @param generatorFn Function producing an async generator yielding values.
 *
 * @returns A multicast `Stream<T>` instance.
 */
export function createStream<T>(
  name: string,
  generatorFn: () => AsyncGenerator<T, void, unknown>
): Stream<T> {
  const id = generateStreamId();

  getRuntimeHooks()?.onCreateStream?.({
    id,
    name,
  });

  const activeSubscriptions = new Set<SubscriberEntry<T>>();
  let isRunning = false;
  let abortController = new AbortController();

  const getActiveReceivers = () => Array.from(activeSubscriptions);

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
    id, // internal identifier (non-breaking)
    pipe,
    subscribe: cb => registerReceiver(createReceiver(cb)),
    query: () => firstValueFrom(self),
    [Symbol.asyncIterator]: () => createAsyncGenerator(registerReceiver),
  };

  return self;
}

/**
 * Pipes a source stream through a chain of operators to create a **derived stream**.
 *
 * ## Semantics
 * - Derived streams are **unicast**.
 * - Each subscriber receives an **independent execution** of the operator pipeline.
 * - The source stream remains multicast; only the pipeline is per-subscriber.
 *
 * ## Execution model
 * For every subscription:
 * 1. A fresh async iterator is created from the source stream.
 * 2. Runtime hooks may wrap the source iterator and operator chain.
 * 3. Operators are applied sequentially.
 * 4. The resulting iterator is drained until completion or unsubscribe.
 *
 * ## Runtime hooks
 * If registered, `onPipeStream` may:
 * - Wrap the source iterator (e.g. value emission tracing).
 * - Replace or wrap operators.
 * - Wrap the final iterator (e.g. delivery tracking).
 *
 * Hooks are **optional** and impose **zero overhead** when not present.
 *
 * @template TIn
 * @template Ops
 * @param source Source stream to pipe from.
 * @param operators Operator chain applied to the source.
 *
 * @returns A new unicast `Stream` derived from the source.
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

  function registerReceiver(receiver: Receiver<any>): Subscription {
    const wrapped = wrapReceiver(receiver);

    const subscriptionId = generateSubscriptionId();
    const hooks = getRuntimeHooks();

    // Base source iterator
    let iterator: AsyncIterator<any> =
      source[Symbol.asyncIterator]();

    let ops: Operator<any, any>[] = operators;
    let finalWrap:
      | ((it: AsyncIterator<any>) => AsyncIterator<any>)
      | undefined;

    // Allow runtime hooks to patch the pipeline
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

    // Apply operators
    for (const op of ops) {
      iterator = op.apply(iterator);
    }

    // Final wrapping (delivery, instrumentation, etc.)
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
