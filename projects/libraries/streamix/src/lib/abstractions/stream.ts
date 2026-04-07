import { firstValueFrom } from "../converters";
import { createSubject } from "../subjects";
import { createAsyncIterator } from "../utils/iterator";
import type { MaybePromise, Operator, OperatorChain } from "./operator";
import { createReceiver, type Receiver } from "./receiver";
import { createSubscription, type Subscription } from "./subscription";

const RAW_ASYNC_ITERATOR = Symbol.for("streamix.rawAsyncIterator");

/**
 * A Stream is an async iterable with additional methods for piping, subscribing, and querying values.
 *
 * @template T The type of values emitted by the stream.
 */
export type Stream<T = any> = AsyncIterable<T> & {
  type: "stream" | "subject";
  name?: string;
  pipe: OperatorChain<T>;
  subscribe(callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription;
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

function waitForAbort(signal: AbortSignal): Promise<void> {

  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener("abort", resolve as any, { once: true })
  );
}

type SubscriberEntry<T> = {
  receiver: Receiver<T>;
  subscription: Subscription;
};

async function drainIterator<T>(
  iterator: AsyncIterator<T> & { __tryNext?: () => IteratorResult<T> | null },
  getReceivers: () => Array<SubscriberEntry<T>>,
  signal: AbortSignal
): Promise<void> {
  const abortPromise = waitForAbort(signal);

  const processResult = (result: IteratorResult<T>) => {
    if (result.done) return true;

    // Do not forward dropped results to subscribers — they are internal
    // backpressure signals emitted by filter/skip/debounce etc.
    if ((result as any).dropped) return false;

    const receivers = getReceivers();
    for (const { receiver, subscription } of receivers) {
      if (!subscription.unsubscribed) {
        receiver.next?.(result.value);
      }
    }
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
  interface ActiveRun {
    subject: Stream<T> & { next: (v: T) => void; error: (e: any) => void; complete: () => void; };
    abortController: AbortController;
  }

  let activeRun: ActiveRun | null = null;
  let subscriberCount = 0;

  const startNewRun = (): ActiveRun => {
    // Create new run state
    const abortController = new AbortController();
    const subject = createSubject<T>();
    const run: ActiveRun = { subject, abortController };
    
    // activeRun = run; // Caller handles this

    void (async () => {
      const signal = abortController.signal;
      const gen = generatorFn(signal)[Symbol.asyncIterator]() as AsyncIterator<T> & { __tryNext?: () => IteratorResult<T> | null };

      try {
        while (!signal.aborted) {
          if (gen.__tryNext) {
            while (true) {
              const result = gen.__tryNext();
              if (!result) break;
              if (result.done) {
                run.subject.complete();
                return;
              }
              // Do not forward dropped results — they are internal backpressure signals.
              if ((result as any).dropped) continue;
              run.subject.next(result.value);
            }
          }

          const result = await Promise.race([
            waitForAbort(signal).then(() => ({ aborted: true } as const)),
            gen.next().then((r) => ({ result: r })),
          ]);

          if ("aborted" in result || signal.aborted) break;

          if (result.result.done) {
            run.subject.complete();
            break;
          }

          // Do not forward dropped results — they are internal backpressure signals.
          if ((result.result as any).dropped) continue;

          run.subject.next(result.result.value);
        }
      } catch (err) {
        if (!signal.aborted) {
          run.subject.error(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (gen.return) {
          try {
            await gen.return();
          } catch {}
        }
        // If this was the active run, clear it.
        // Note: It might have been replaced already if we restarted.
        if (activeRun === run) {
           activeRun = null;
        }
      }
    })();

    return run;
  };

  /**
   * Wrapper to track subscriber count and manage generator lifecycle.
   */
  const wrappedSubscribe = (cb?: ((value: T) => MaybePromise) | Receiver<T>): Subscription => {
    if (!activeRun || activeRun.abortController.signal.aborted) {
      activeRun = startNewRun();
    }
    
    subscriberCount++;
    const sub = activeRun.subject.subscribe(cb);

    const originalUnsubscribe = sub.unsubscribe.bind(sub);
    sub.unsubscribe = async () => {
      await originalUnsubscribe();
      subscriberCount--;
      if (subscriberCount === 0) {
        if (activeRun && !activeRun.abortController.signal.aborted) {
          activeRun.abortController.abort();
        }
      }
    };

    return sub;
  };

  let self!: Stream<T>;

  const pipe = ((...ops: Operator<any, any>[]) =>
    pipeSourceThrough(self, ops)) as OperatorChain<T>;

  self = {
    type: "stream",
    name,
    pipe,
    subscribe: wrappedSubscribe,
    query: () => firstValueFrom(self),
    [Symbol.asyncIterator]: () => {
      const factory = createAsyncIterator({ 
        register: (receiver) => wrappedSubscribe(receiver) 
      });
      return factory() as AsyncIterator<T>;
    },
  };

  return self;
}

/**
 * Applies a list of operators to a source stream and returns the resulting stream.
 *
 * This is the implementation behind `stream.pipe(...)`.
 *
 * @template TIn Source value type.
 * @param source Source stream.
 * @param operators Operators to apply, in order.
 * @returns A new Stream that emits the transformed values.
 */
export function pipeSourceThrough<TIn, TOut = TIn, Ops extends Operator<any, any>[] = Operator<any, any>[]>(
  source: Stream<TIn>,
  operators: [...Ops]
): Stream<TOut> {
  const getRawIterator = (stream: any) => {
    const factory = stream[RAW_ASYNC_ITERATOR] ?? stream[Symbol.asyncIterator];
    return factory.call(stream);
  };

  const applyOperators = (baseSource: AsyncIterator<any>) => {
    let iterator: AsyncIterator<any> = baseSource;
    for (const op of operators) {
      iterator = op.apply(iterator);
    }
    if (typeof (iterator as any)[Symbol.asyncIterator] !== "function") {
      (iterator as any)[Symbol.asyncIterator] = () => iterator;
    }
    return iterator;
  };

  function registerReceiver(receiver: Receiver<TOut>): Subscription {
    const abortController = new AbortController();
    const signal = abortController.signal;

    const subscription = createSubscription(async () => {
      abortController.abort();
      receiver.complete?.();
    });

    const baseSource = getRawIterator(source);
    const iterator = applyOperators(baseSource);

    queueMicrotask(() => {
      drainIterator(iterator, () => [{ receiver, subscription }], signal).catch(
        () => {}
      );
    });

    return subscription;
  }

  const pipedStream: Stream<TOut> = {
    name: `${source.name}Sink`,
    type: "stream",
    pipe: (...nextOps: Operator<any, any>[]) => pipeSourceThrough<TOut, any>(pipedStream, nextOps),
    subscribe: (cb) => registerReceiver(createReceiver(cb)),
    query: () => firstValueFrom(pipedStream),
    [Symbol.asyncIterator]: () => {
      const iterator = applyOperators(getRawIterator(source));
      const publicIterator: AsyncIterator<TOut> = {
        async next() {
          while (true) {
            const result = await iterator.next();
            if (result.done) return result;
            if ((result as any).dropped) continue;
            return result;
          }
        },
        async return(value?: any) {
          if (iterator.return) {
            return iterator.return(value);
          }
          return { done: true, value };
        },
        async throw(err?: any) {
          if (iterator.throw) {
            return iterator.throw(err);
          }
          throw err;
        },
      };
      (publicIterator as any)[Symbol.asyncIterator] = () => publicIterator;
      return publicIterator;
    },
  };

  (pipedStream as any)[RAW_ASYNC_ITERATOR] = () => applyOperators(getRawIterator(source));

  return pipedStream as Stream<TOut>;
}