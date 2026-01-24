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
  getRuntimeHooks
} from "./hooks";
import type { MaybePromise, Operator, OperatorChain } from "./operator";
import { createReceiver, type Receiver } from "./receiver";
import { scheduler } from "./scheduler";
import { createSubscription, type Subscription } from "./subscription";

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
      return cb();
    }
    return scheduler.enqueue(cb);
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
      return scheduler.enqueue(async () => {
        const entry = activeSubscriptions.find((s) => s.subscription === subscription);

        if (entry) {
          activeSubscriptions = activeSubscriptions.filter((s) => s !== entry);
          entry.receiver.complete?.();
        }

        if (activeSubscriptions.length === 0) {
          abortController.abort();
        }
      });
    });

    scheduler.enqueue(() => {
      activeSubscriptions = [...activeSubscriptions, { receiver: wrapped, subscription }];

      if (!isRunning) {
        startMulticastLoop();
      }
    });

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

export function pipeSourceThrough<TIn, Ops extends Operator<any, any>[]>(
  source: Stream<TIn>,
  operators: [...Ops]
): Stream<any> {
  function registerReceiver(receiver: Receiver<any>): Subscription {
    const wrapped = wrapReceiver(receiver);
    const abortController = new AbortController();
    const signal = abortController.signal;

    let iterator: AsyncIterator<any> = source[Symbol.asyncIterator]();
    let ops: Operator<any, any>[] = operators;
    for (const op of ops) {
      iterator = op.apply(iterator);
    }

    const subscription = createSubscription(async () => {
      return scheduler.enqueue(async () => {
        abortController.abort();
        wrapped.complete?.();
      });
    });

    scheduler.enqueue(() => {
      drainIterator(iterator, () => [{ receiver: wrapped, subscription }], signal).catch(() => {});
    });

    return subscription;
  }

  const pipedStream: Stream<any> = {
    name: `${source.name}Sink`,
    id: generateStreamId(),
    type: "stream",
    pipe: (...nextOps: Operator<any, any>[]) => pipeSourceThrough(source, [...operators, ...nextOps]),
    subscribe: (cb) => registerReceiver(createReceiver(cb)),
    query: () => firstValueFrom(pipedStream),
    [Symbol.asyncIterator]: () => {
      let it = source[Symbol.asyncIterator]();
      for (const op of operators) {
        it = op.apply(it);
      }
      return it;
    },
  };

  return pipedStream;
}