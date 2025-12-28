import { createAsyncGenerator, createReceiver, createSubscription, generateStreamId, type MaybePromise, type Operator, pipeSourceThrough, type Receiver, scheduler, type Stream, type Subscription } from "../abstractions";
import { firstValueFrom } from "../converters";
import { createReplayBuffer, type ReplayBuffer } from "../primitives";
import type { Subject } from "./subject";

/**
 * A type alias for a ReplaySubject, which is a type of Subject.
 *
 * A ReplaySubject stores a specified number of the latest values it has emitted
 * and "replays" them to any new subscribers. This allows late subscribers to
 * receive past values they may have missed.
 *
 * @template T The type of the values emitted by the subject.
 * @extends {Subject<T>}
 */
export type ReplaySubject<T = any> = Subject<T>;

/**
 * Creates a new ReplaySubject.
 *
 * A ReplaySubject is a variant of a Subject that stores a specified number of
 * the latest values it has emitted and "replays" them to any new subscribers.
 * This allows late subscribers to receive past values they may have missed.
 *
 * This subject provides asynchronous delivery while preserving emission order.
 *
 * @template T The type of the values the subject will emit.
 * @param {number} [capacity=Infinity] The maximum number of past values to buffer and replay to new subscribers.
 * @returns {ReplaySubject<T>} A new ReplaySubject instance.
 */
export function createReplaySubject<T = any>(capacity: number = Infinity): ReplaySubject<T> {
  const buffer = createReplayBuffer<T>(capacity) as ReplayBuffer;
  let isCompleted = false;
  let hasError = false;
  let latestValue: T | undefined = undefined;
  let writeChain = Promise.resolve();

  const enqueueWrite = (task: () => Promise<void>) => {
    writeChain = writeChain.then(task).catch(() => {});
    return writeChain;
  };

  const next = (value: T) => {
    scheduler.enqueue(() => {
      if (isCompleted || hasError) return;
      latestValue = value;
      void enqueueWrite(() => buffer.write(value));
    });
  };

  const complete = () => {
    scheduler.enqueue(() => {
      if (isCompleted) return;
      isCompleted = true;
      void enqueueWrite(() => buffer.complete());
    });
  };

  const error = (err: any) => {
    scheduler.enqueue(() => {
      if (isCompleted || hasError) return;
      hasError = true;
      isCompleted = true;
      void enqueueWrite(async () => {
        await buffer.error(err);
        await buffer.complete();
      });
    });
  };

  const registerReceiver = (receiver: Receiver<T>): Subscription => {
    let unsubscribing = false;
    let readerId: number | null = null;
    let readerLatestValue: T | undefined;

    const subscription = createSubscription(() => {
      if (!unsubscribing) {
        unsubscribing = true;
        if (readerId !== null) {
          scheduler.enqueue(async () => {
            if (readerId !== null) await buffer.detachReader(readerId);
          });
        }
      }
    });

    scheduler.enqueue(() => buffer.attachReader()).then(async (id: number) => {
      readerId = id;
      try {
        while (true) {
          const result = await buffer.read(readerId!);
          if (result.done) break;
          readerLatestValue = result.value;
          await receiver.next?.(readerLatestValue!);
        }
      } catch (err: any) {
        await receiver.error?.(err);
      } finally {
        if (readerId !== null) {
          scheduler.enqueue(async () => {
            await buffer.detachReader(readerId!);
            await receiver.complete?.();
          });
        } else {
          scheduler.enqueue(async () => {
            await receiver.complete?.();
          });
        }
      }
    });

    return subscription;
  };

  const subscribe = (callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription => {
    const receiver = createReceiver(callbackOrReceiver);
    return registerReceiver(receiver);
  };

  const replaySubject: ReplaySubject<T> = {
    type: "subject",
    name: "replaySubject",
    id: generateStreamId(),
    pipe(...operators: Operator<any, any>[]): Stream<any> {
      return pipeSourceThrough(this, operators);
    },
    subscribe,
    async query(): Promise<T> {
      return await firstValueFrom(this);
    },
    get snappy(): T | undefined {
      return latestValue;
    },
    next,
    complete,
    completed: () => isCompleted,
    error,
    [Symbol.asyncIterator]: () => createAsyncGenerator(registerReceiver),
  };

  return replaySubject;
}
