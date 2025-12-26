import { createAsyncGenerator, createReceiver, createSubscription, generateStreamId, type MaybePromise, type Operator, pipeSourceThrough, type Receiver, type Stream, type Subscription } from "../abstractions";
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
  let subscriberCount = 0;

  const next = (value: T) => {
    if (isCompleted || hasError) return;
    latestValue = value;
    writeChain = writeChain.then(() => buffer.write(value)).catch(() => {});
  };

  const complete = () => {
    if (isCompleted) return;
    isCompleted = true;
    writeChain = writeChain.then(() => buffer.complete()).catch(() => {});
  };

  const error = (err: any) => {
    if (isCompleted || hasError) return;
    hasError = true;
    isCompleted = true;
    writeChain = writeChain.then(async () => {
      await buffer.error(err);
      await buffer.complete();
    }).catch(() => {});
  };

  const registerReceiver = (receiver: Receiver<T>): Subscription => {
    let unsubscribing = false;
    let readerId: number | null = null;
    let readerLatestValue: T | undefined;
    let drainOnUnsubscribe = false;

    subscriberCount++;
    const subscription = createSubscription(() => {
      if (!unsubscribing) {
        unsubscribing = true;
        subscriberCount--;
        if (subscriberCount === 0) {
          drainOnUnsubscribe = true;
          complete();
        } else if (readerId !== null) {
          void buffer.detachReader(readerId);
        }
      }
    });

    (async () => {
      const attachPromise = writeChain.then(() => buffer.attachReader());
      writeChain = attachPromise.then(() => undefined).catch(() => {});

      readerId = await attachPromise;
      if (unsubscribing && !drainOnUnsubscribe) {
        await buffer.detachReader(readerId);
        return;
      }
      try {
        while (true) {
          const result = await buffer.read(readerId);
          if (result.done) break;
          readerLatestValue = result.value;
          await receiver.next?.(readerLatestValue!);
        }
      } catch (err: any) {
        await receiver.error?.(err);
      } finally {
        if (readerId !== null) {
          await buffer.detachReader(readerId);
        }
        await receiver.complete?.();
      }
    })();

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
