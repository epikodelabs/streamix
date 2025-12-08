import { eachValueFrom, firstValueFrom } from "../converters";
import { Operator, OperatorChain } from "./operator";
import { CallbackReturnType, createReceiver, Receiver } from "./receiver";
import { scheduler } from "./scheduler";
import { createSubscription, Subscription } from "./subscription";

/* -------------------------------------------------------------------------- */
/*                             Abort Helper (safe)                             */
/* -------------------------------------------------------------------------- */

/**
 * Resolves when the given AbortSignal fires.
 * If the signal is already aborted, resolves immediately.
 *
 * This preserves the original semantics where `abort` can win a Promise.race()
 * synchronously.
 */
function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>(resolve =>
    signal.addEventListener("abort", () => resolve(), { once: true })
  );
}

/* -------------------------------------------------------------------------- */
/*                          Iterator Draining (core)                           */
/* -------------------------------------------------------------------------- */

/**
 * Drains an async iterator using Promise.race() to support abort semantics.
 *
 * This preserves the original behavior:
 *  - iterator.next() races against an abort signal
 *  - values delivered via scheduler
 *  - errors forwarded via scheduler
 *  - completion delivered via scheduler (only if not aborted)
 *  - iterator.return() is called in all cases
 *
 * @template T
 * @param iterator Async iterator to drain
 * @param getReceivers Returns current receivers + subscriptions
 * @param signal Abort signal used to interrupt iteration
 */
async function drainIterator<T>(
  iterator: AsyncIterator<T>,
  getReceivers: () => Array<{ receiver: Receiver<T>; subscription: Subscription }>,
  signal: AbortSignal
): Promise<void> {
  const abortPromise = waitForAbort(signal);

  try {
    while (true) {
      // Preserves the original race semantics:
      const winner = await Promise.race([
        abortPromise.then(() => ({ aborted: true } as const)),
        iterator.next().then(result => ({ result })),
      ]);

      if ("aborted" in winner || signal.aborted) break;

      const { result } = winner;
      if (result.done) break;

      const value = result.value;
      const receivers = getReceivers();

      scheduler.enqueue(async () => {
        for (const { receiver, subscription } of receivers) {
          if (!subscription.unsubscribed) {
            try {
              await receiver.next?.(value);
            } catch (err) {
              const error = err instanceof Error ? err : new Error(String(err));
              try { await receiver.error?.(error); } catch {}
            }
          }
        }
      });
    }

  } catch (err) {
    if (!signal.aborted) {
      const error = err instanceof Error ? err : new Error(String(err));
      const receivers = getReceivers();

      scheduler.enqueue(async () => {
        for (const { receiver, subscription } of receivers) {
          if (!subscription.unsubscribed) {
            try { await receiver.error?.(error); } catch {}
          }
        }
      });
    }

  } finally {
    // Always attempt generator cleanup
    if (iterator.return) {
      try { await iterator.return(); } catch {}
    }

    // COMPLETE only on natural completion
    if (!signal.aborted) {
      const receivers = getReceivers();

      scheduler.enqueue(async () => {
        for (const { receiver, subscription } of receivers) {
          if (!subscription.unsubscribed) {
            try { await receiver.complete?.(); } catch {}
          }
        }
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Stream type                                 */
/* -------------------------------------------------------------------------- */

export type Stream<T = any> = {
  type: "stream" | "subject";
  name?: string;
  pipe: OperatorChain<T>;
  subscribe: (callback?: ((value: T) => CallbackReturnType) | Receiver<T>) => Subscription;
  query: () => Promise<T>;
};

/* -------------------------------------------------------------------------- */
/*                               createStream()                                */
/* -------------------------------------------------------------------------- */

/**
 * Creates a multicast stream backed by an async generator.
 *
 * Behavior (identical to original):
 *  - Start generator on first subscriber
 *  - Share values with all subscribers (multicast)
 *  - Abort generator when last subscriber unsubscribes
 *  - Restart generator if new subscriber arrives after completion
 *  - Deliver next/error/complete via scheduler (microtask sync model)
 */
export function createStream<T>(
  name: string,
  generatorFn: () => AsyncGenerator<T, void, unknown>
): Stream<T> {

  const activeSubscriptions = new Set<{ receiver: Receiver<T>; subscription: Subscription }>();
  let isRunning = false;
  let abortController = new AbortController(); // must never be null

  /**
   * Subscribe to the stream.
   */
  const subscribe = (
    callbackOrReceiver?: ((value: T) => CallbackReturnType) | Receiver<T>
  ): Subscription => {

    const receiver = createReceiver(callbackOrReceiver);
    let subscription!: Subscription;

    subscription = createSubscription(async () => {
      // Remove receiver
      for (const sub of activeSubscriptions) {
        if (sub.subscription === subscription) {
          activeSubscriptions.delete(sub);

          scheduler.enqueue(async () => {
            try { await sub.receiver.complete?.(); }
            catch (err) { console.warn("Error completing cancelled receiver:", err); }
          });
          break;
        }
      }

      // If last subscriber → abort generator
      if (activeSubscriptions.size === 0) {
        abortController.abort();
        isRunning = false;
      }
    });

    activeSubscriptions.add({ receiver, subscription });

    // Start generator if needed
    if (!isRunning) {
      isRunning = true;
      abortController = new AbortController();
      startMulticastLoop(generatorFn, abortController);
    }

    return subscription;
  };

  /**
   * Internal multicast loop.
   */
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
  const pipe = ((...ops: Operator<any, any>[]) => pipeStream(self, ops)) as OperatorChain<T>;

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
/*                                pipeStream()                                 */
/* -------------------------------------------------------------------------- */

/**
 * Pipes a stream through a chain of operators, producing a new derived stream.
 *
 * Behavior preserved exactly:
 *  - each subscription creates a fresh operator iterator chain
 *  - source is consumed via eachValueFrom(source)
 *  - unsubscribe aborts only this derived iterator, not the source
 *  - errors and completions propagate through scheduler
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
      const receiver = createReceiver(cb);

      const sourceIterator =
        eachValueFrom(source)[Symbol.asyncIterator]() as AsyncIterator<TIn>;

      let iterator: AsyncIterator<any> = sourceIterator;
      for (const op of operators) iterator = op.apply(iterator);

      const abortController = new AbortController();
      const signal = abortController.signal;

      const subscription = createSubscription(async () => {
        abortController.abort();
        scheduler.enqueue(async () => { await receiver.complete?.(); });
      });

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
