import { eachValueFrom, firstValueFrom } from "../converters";
import { Operator, OperatorChain } from "./operator";
import { CallbackReturnType, createReceiver, Receiver } from "./receiver";
import { scheduler } from "./scheduler";
import { createSubscription, Subscription } from "./subscription";

/* -------------------------------------------------------------------------- */
/*                               Helper utilities                             */
/* -------------------------------------------------------------------------- */

/**
 * Resolves when the given AbortSignal fires.
 * If the signal is already aborted, resolves immediately.
 */
function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve =>
    signal.addEventListener("abort", resolve as any, { once: true })
  );
}

/**
 * Wraps a receiver so that all `next`, `error`, and `complete` calls
 * are dispatched through the scheduler.
 *
 * This preserves the original semantics:
 * - All user callbacks happen in scheduled microtasks.
 * - Errors thrown in `next` are routed to `error` but do NOT terminate the stream.
 * - Errors thrown in `error`/`complete` are swallowed.
 */
function wrapReceiver<T>(receiver: Receiver<T>): Receiver<T> {
  const wrapped: Receiver<T> = {};

  if (receiver.next) {
    wrapped.next = (value: T) =>
      scheduler.enqueue(async () => {
        try {
          await receiver.next!(value);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          if (receiver.error) {
            try {
              await receiver.error(error);
            } catch {
              // swallow secondary errors
            }
          }
        }
      });
  }

  if (receiver.error) {
    wrapped.error = (err: any) =>
      scheduler.enqueue(async () => {
        try {
          await receiver.error!(err);
        } catch {
          // swallow errors from error handlers
        }
      });
  }

  if (receiver.complete) {
    wrapped.complete = () =>
      scheduler.enqueue(async () => {
        try {
          await receiver.complete!();
        } catch {
          // swallow errors from completion handlers
        }
      });
  }

  return wrapped;
}

/**
 * Drains an async iterator with abort support and scheduled delivery.
 *
 * Semantics:
 * - Uses Promise.race between `iterator.next()` and abort signal.
 * - On each value:
 *   - calls `receiver.next` for all active receivers (wrapped → scheduled).
 * - On generator error:
 *   - calls `receiver.error` for all active receivers.
 *   - then completes them in the `finally` block (natural end path).
 * - On abort:
 *   - iterator is finalized, but no `complete` is called here.
 */
async function drainIterator<T>(
  iterator: AsyncIterator<T>,
  getReceivers: () => Array<{ receiver: Receiver<T>; subscription: Subscription }>,
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

      const value = result.value;
      const receivers = getReceivers();

      for (const { receiver, subscription } of receivers) {
        if (!subscription.unsubscribed) {
          receiver.next?.(value);
        }
      }
    }
  } catch (err) {
    if (!signal.aborted) {
      const error = err instanceof Error ? err : new Error(String(err));
      const receivers = getReceivers();

      for (const { receiver, subscription } of receivers) {
        if (!subscription.unsubscribed) {
          receiver.error?.(error);
        }
      }
    }
  } finally {
    if (iterator.return) {
      try {
        await iterator.return();
      } catch {
        // ignore iterator finalization errors
      }
    }

    // Only complete on natural completion (not abort)
    if (!signal.aborted) {
      const receivers = getReceivers();
      for (const { receiver, subscription } of receivers) {
        if (!subscription.unsubscribed) {
          receiver.complete?.();
        }
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Stream                                   */
/* -------------------------------------------------------------------------- */

export type Stream<T = any> = {
  type: "stream" | "subject";
  name?: string;
  pipe: OperatorChain<T>;
  subscribe: (
    callback?: ((value: T) => CallbackReturnType) | Receiver<T>
  ) => Subscription;
  query: () => Promise<T>;
};

/* -------------------------------------------------------------------------- */
/*                               createStream()                               */
/* -------------------------------------------------------------------------- */

/**
 * Creates a multicast stream backed by an async generator.
 *
 * - Starts generator on first subscriber.
 * - Shares values across all subscribers (multicast).
 * - Aborts generator when the last subscriber unsubscribes.
 * - Restarts generator if new subscribers arrive after teardown.
 */
export function createStream<T>(
  name: string,
  generatorFn: () => AsyncGenerator<T, void, unknown>
): Stream<T> {
  const activeSubscriptions = new Set<{ receiver: Receiver<T>; subscription: Subscription }>();
  let isRunning = false;
  let abortController = new AbortController();

  const subscribe = (
    callbackOrReceiver?: ((value: T) => CallbackReturnType) | Receiver<T>
  ): Subscription => {
    const baseReceiver = createReceiver(callbackOrReceiver);
    const receiver = wrapReceiver(baseReceiver);

    let subscription!: Subscription;

    subscription = createSubscription(async () => {
      const entry = [...activeSubscriptions].find(
        s => s.subscription === subscription
      );

      if (entry) {
        activeSubscriptions.delete(entry);
        entry.receiver.complete?.();
      }

      if (activeSubscriptions.size === 0) {
        abortController.abort();
        isRunning = false;
      }
    });

    activeSubscriptions.add({ receiver, subscription });

    if (!isRunning) {
      isRunning = true;
      abortController = new AbortController();
      startMulticastLoop(generatorFn, abortController);
    }

    return subscription;
  };

  const startMulticastLoop = (
    genFn: () => AsyncGenerator<T>,
    controller: AbortController
  ) => {
    (async () => {
      const signal = controller.signal;
      const iterator = genFn()[Symbol.asyncIterator]();

      try {
        await drainIterator(
          iterator,
          () => Array.from(activeSubscriptions),
          signal
        );
      } finally {
        isRunning = false;
      }
    })();
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

/* -------------------------------------------------------------------------- */
/*                                pipeStream()                                */
/* -------------------------------------------------------------------------- */

/**
 * Pipes a source stream through a chain of operators, producing a derived stream.
 *
 * Each subscription to the derived stream:
 *  - builds a fresh iterator chain from the source via `eachValueFrom(source)`,
 *  - applies all operators in order,
 *  - drains the iterator with abort support,
 *  - delivers values via scheduled receivers.
 */
export function pipeStream<TIn, Ops extends Operator<any, any>[]>(
  source: Stream<TIn>,
  operators: [...Ops]
): Stream<any> {
  const pipedStream: Stream<any> = {
    name: `${source.name}-sink`,
    type: "stream",

    pipe: ((...nextOps: Operator<any, any>[]) =>
      pipeStream(source, [...operators, ...nextOps])) as OperatorChain<any>,

    subscribe(cb?: ((value: any) => CallbackReturnType) | Receiver<any>) {
      const baseReceiver = createReceiver(cb);
      const receiver = wrapReceiver(baseReceiver);

      const sourceIterator =
        eachValueFrom(source)[Symbol.asyncIterator]() as AsyncIterator<TIn>;

      let iterator: AsyncIterator<any> = sourceIterator;
      for (const op of operators) {
        iterator = op.apply(iterator);
      }

      const abortController = new AbortController();
      const signal = abortController.signal;

      const subscription = createSubscription(async () => {
        abortController.abort();
        receiver.complete?.();
      });

      // Fire-and-forget: errors and completion are handled inside drainIterator + receiver wrappers
      drainIterator(
        iterator,
        () => [{ receiver, subscription }],
        signal
      ).catch(() => {});

      return subscription;
    },

    query() {
      return firstValueFrom(pipedStream);
    },
  };

  return pipedStream;
}
