import { eachValueFrom, firstValueFrom } from "../converters";
import { Operator, OperatorChain } from "./operator";
import { CallbackReturnType, createReceiver, Receiver } from "./receiver";
import { scheduler } from "./scheduler";
import { createSubscription, Subscription } from "./subscription";

/**
 * A reactive stream representing a sequence of values over time.
 *
 * Streams support:
 * - **Subscription** to receive asynchronous values.
 * - **Operator chaining** through `.pipe()`.
 * - **Querying** the first emitted value.
 *
 * Two variants exist:
 * - `"stream"` — automatically driven, typically created by `createStream()`.
 * - `"subject"` — manually driven (not implemented here but retained for API symmetry).
 *
 * @template T The value type emitted by the stream.
 */
export type Stream<T = any> = {
  /** Identifies the underlying behavior of the stream. */
  type: "stream" | "subject";

  /** Human-readable name primarily for debugging and introspection. */
  name?: string;

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
    callback?: ((value: T) => CallbackReturnType) | Receiver<T>
  ) => Subscription;

  /**
   * Convenience method for retrieving the first emitted value.
   *
   * Internally subscribes, resolves on the first `next`, and then unsubscribes.
   */
  query: () => Promise<T>;
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
 * Wraps a `Receiver<T>` so all lifecycle callbacks (`next`, `error`, `complete`)
 * run inside the scheduler’s microtask queue.
 *
 * Guarantees:
 * - All user callbacks are async-scheduled.
 * - Errors thrown inside `next` are forwarded to `error` (if provided).
 * - Secondary errors inside `error` or `complete` are swallowed.
 */
function wrapReceiver<T>(receiver: Receiver<T>): Receiver<T> {
  const wrapped: Receiver<T> = {};

  const safeSchedule = (cb: () => CallbackReturnType) =>
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
 * Semantics:
 * - The generator runs once per group of subscribers.
 * - Adding the first subscriber starts the generator.
 * - Values are shared across all subscribers (hot multicast).
 * - When the last subscriber unsubscribes, the generator is aborted.
 * - A later subscriber causes the generator to start again (cold-restart).
 *
 * Scheduler guarantees:
 * - All receiver callbacks (`next`, `error`, `complete`) run in scheduled microtasks.
 *
 * @template T Value type emitted by the generator.
 * @param name Optional human-readable stream label.
 * @param generatorFn Function producing an async iterator yielding values for subscribers.
 */
export function createStream<T>(
  name: string,
  generatorFn: () => AsyncGenerator<T, void, unknown>
): Stream<T> {
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

  const subscribe = (
    callbackOrReceiver?: ((value: T) => CallbackReturnType) | Receiver<T>
  ): Subscription => {
    const receiver = wrapReceiver(createReceiver(callbackOrReceiver));
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

    activeSubscriptions.add({ receiver, subscription });

    if (!isRunning) {
      startMulticastLoop();
    }

    return subscription;
  };

  let self: Stream<T>;
  const pipe = ((...ops: Operator<any, any>[]) =>
    pipeStream(self, ops)) as OperatorChain<T>;

  self = {
    type: "stream",
    name,
    pipe,
    subscribe,
    query: () => firstValueFrom(self),
  };

  return self;
}

/**
 * Pipes a source stream through a chain of operators to produce a **derived stream**.
 *
 * For each subscription:
 * - A fresh iterator is created from the source via `eachValueFrom()`.
 * - All operators transform the iterator in sequence.
 * - `drainIterator` consumes the transformed iterator until completion or abort.
 *
 * Unlike `createStream`, piped streams are **unicast**:
 * - Each subscriber gets an independent execution of the operator pipeline.
 * - Only the source stream remains multicast.
 *
 * @template TIn  Input value type.
 * @template Ops  Tuple of operators used to transform the pipeline.
 */
export function pipeStream<TIn, Ops extends Operator<any, any>[]>(
  source: Stream<TIn>,
  operators: [...Ops]
): Stream<any> {
  const pipedStream: Stream<any> = {
    name: `${source.name}-piped`,
    type: "stream",

    pipe: ((...nextOps: Operator<any, any>[]) =>
      pipeStream(source, [...operators, ...nextOps])) as OperatorChain<any>,

    subscribe(cb?: ((value: any) => CallbackReturnType) | Receiver<any>) {
      const receiver = wrapReceiver(createReceiver(cb));

      const sourceIterator =
        eachValueFrom(source)[Symbol.asyncIterator]() as AsyncIterator<TIn>;

      let iterator: AsyncIterator<any> = sourceIterator;
      for (const op of operators) iterator = op.apply(iterator);

      const abortController = new AbortController();
      const signal = abortController.signal;

      const subscription = createSubscription(async () => {
        abortController.abort();
        receiver.complete?.();
      });

      drainIterator(iterator, () => [{ receiver, subscription }], signal).catch(
        () => {}
      );

      return subscription;
    },

    query() {
      return firstValueFrom(pipedStream);
    },
  };

  return pipedStream;
}
