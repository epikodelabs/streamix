import { eachValueFrom, firstValueFrom } from "../converters";
import { Operator, OperatorChain } from "./operator";
import { CallbackReturnType, createReceiver, Receiver } from "./receiver";
import { scheduler } from "./scheduler";
import { createSubscription, Subscription } from "./subscription";

/**
 * Represents a reactive stream that supports subscriptions and operator chaining.
 *
 * A stream is a sequence of values over time that can be subscribed to for notifications.
 * It is a foundational concept in reactive programming, providing a unified way to handle
 * asynchronous data flows, such as events, data from APIs, or values from an async generator.
 *
 * Streams in this implementation are **multicast** by default, meaning multiple subscribers
 * share the same underlying execution and receive the same values.
 *
 * @template T The type of the values emitted by the stream.
 *
 * @example
 * ```typescript
 * const numberStream = createStream('numbers', async function*() {
 *   yield 1;
 *   yield 2;
 *   yield 3;
 * });
 *
 * // Subscribe to receive values
 * const sub = numberStream.subscribe({
 *   next: (value) => console.log('Received:', value),
 *   complete: () => console.log('Stream completed')
 * });
 *
 * // Unsubscribe when done
 * await sub.unsubscribe();
 * ```
 */
export type Stream<T = any> = {
  /**
   * A type discriminator to differentiate between stream types.
   * - `"stream"` indicates a cold, multicastable stream originating from a generator.
   * - `"subject"` would indicate a hot stream that can be manually controlled.
   */
  type: "stream" | "subject";

  /**
   * An optional, human-readable name for the stream, useful for debugging and logging.
   * This name is also used when creating derived streams through operators.
   */
  name?: string;

  /**
   * Chains one or more operators to transform the stream.
   *
   * This is a critical part of the stream's composability. It takes one or more
   * `Operator`s and returns a new `Stream` that applies each operator's
   * transformation in order. The original stream remains unchanged.
   *
   * @param operators One or more operator functions to apply to the stream.
   * @returns A new `Stream` with the operators applied.
   *
   * @example
   * ```typescript
   * const numberStream = createStream('numbers', async function*() {
   *   yield 1; yield 2; yield 3;
   * });
   *
   * const transformedStream = numberStream.pipe(
   *   map(value => value * 2),
   *   filter(value => value > 3)
   * );
   * // Emits: 4, 6
   * ```
   */
  pipe: OperatorChain<T>;

  /**
   * Subscribes a listener to the stream to receive emitted values.
   *
   * Subscribing starts the stream's execution if it hasn't started yet. Multiple
   * subscriptions will multicast the same values to all listeners, sharing the
   * same underlying generator execution.
   *
   * All value emissions are processed through a scheduler to ensure proper ordering
   * and synchronization across subscribers.
   *
   * @param callback An optional function or `Receiver` object to handle values,
   * errors, and completion of the stream. Can be:
   * - A function: `(value) => void` - called for each emitted value
   * - A Receiver object: `{ next?, error?, complete? }` - called for lifecycle events
   * - Undefined: subscribes without handling (useful for side effects)
   *
   * @returns A `Subscription` object which can be used to unsubscribe and stop
   * listening to the stream. Unsubscribing triggers the completion callback.
   *
   * @example
   * ```typescript
   * // Simple function callback
   * const sub1 = stream.subscribe(value => console.log(value));
   *
   * // Full receiver with lifecycle hooks
   * const sub2 = stream.subscribe({
   *   next: (value) => console.log('Value:', value),
   *   error: (err) => console.error('Error:', err),
   *   complete: () => console.log('Done')
   * });
   *
   * // Unsubscribe when done
   * await sub1.unsubscribe();
   * ```
   */
  subscribe: (callback?: ((value: T) => CallbackReturnType) | Receiver<T>) => Subscription;

  /**
   * Queries the stream for its first emitted value and resolves when that value arrives.
   *
   * This method is useful for scenarios where you only need a single value from the stream,
   * such as a one-off API request or a single button click. It automatically subscribes
   * to the stream, waits for the first value, and then unsubscribes.
   *
   * @returns A promise that resolves with the first value emitted by the stream.
   * If the stream completes without emitting any values, the promise will reject.
   *
   * @example
   * ```typescript
   * const firstValue = await stream.query();
   * console.log('First value:', firstValue);
   * ```
   */
  query: () => Promise<T>;
};

/**
 * Creates a multicast stream from an async generator function.
 *
 * A **multicast stream** (also known as a hot stream) is a stream where multiple subscribers
 * share the same underlying execution. When the first subscriber joins, the generator function
 * starts executing. All subsequent subscriptions receive values from that same single execution.
 * This is different from a cold stream, where each subscription would trigger a new,
 * independent execution.
 *
 * The stream manages the subscription lifecycle automatically:
 * - Starts the generator when the first subscriber joins
 * - Multicasts values to all active subscribers through a scheduler for proper ordering
 * - Performs graceful teardown of the generator when all subscribers leave
 * - Handles errors by propagating them to all active subscribers
 * - Completes all subscribers when the generator finishes naturally
 *
 * All value emissions are processed through a scheduler to ensure proper synchronization
 * and ordering across all subscribers, even in the presence of async operations.
 *
 * @template T The type of the values that the stream will emit.
 *
 * @param name A human-readable name for the stream, useful for debugging and identifying
 * streams in logs. This name is also inherited by derived streams created through operators.
 *
 * @param generatorFn An async generator function that defines the source of the stream's
 * values. The generator's `yield` statements push values to all active subscribers.
 * The generator can:
 * - `yield` values to emit them to subscribers
 * - `throw` errors to propagate them to subscribers
 * - Complete naturally to signal stream completion
 *
 * @returns A new `Stream` instance that can be subscribed to and piped through operators.
 *
 * @example
 * ```typescript
 * // Simple counter stream
 * const counter = createStream('counter', async function*() {
 *   for (let i = 1; i <= 5; i++) {
 *     yield i;
 *     await new Promise(resolve => setTimeout(resolve, 1000));
 *   }
 * });
 *
 * // Multiple subscribers share the same execution
 * counter.subscribe(n => console.log('Sub 1:', n));
 * counter.subscribe(n => console.log('Sub 2:', n));
 * // Both will receive: 1, 2, 3, 4, 5 (same values, same timing)
 * ```
 *
 * @example
 * ```typescript
 * // Stream with error handling
 * const dataStream = createStream('data', async function*() {
 *   try {
 *     const response = await fetch('/api/data');
 *     const data = await response.json();
 *     for (const item of data) {
 *       yield item;
 *     }
 *   } catch (error) {
 *     throw new Error('Failed to fetch data');
 *   }
 * });
 *
 * dataStream.subscribe({
 *   next: (item) => console.log('Received:', item),
 *   error: (err) => console.error('Stream error:', err),
 *   complete: () => console.log('Stream completed')
 * });
 * ```
 */
export function createStream<T>(
  name: string,
  generatorFn: () => AsyncGenerator<T, void, unknown>
): Stream<T> {
  const activeSubscriptions = new Set<{ receiver: Receiver<T>; subscription: Subscription }>();
  let isRunning = false;
  let abortController: AbortController | null = null;

  /**
   * Subscribes a callback or receiver to the stream.
   *
   * Creates a subscription that:
   * - Adds the subscriber to the active set
   * - Starts the generator if not already running
   * - Delivers all future values through the scheduler
   * - Returns a subscription handle for unsubscribing
   *
   * When unsubscribed, the subscriber is removed and its completion callback is triggered.
   * If this was the last subscriber, the generator is aborted and cleaned up.
   *
   * @param callbackOrReceiver Optional function or receiver for handling stream events
   * @returns Subscription object with an unsubscribe method
   */
  const subscribe = (
    callbackOrReceiver?: ((value: T) => CallbackReturnType) | Receiver<T>
  ): Subscription => {
    const receiver = createReceiver(callbackOrReceiver);
    let subscription: Subscription;
    
    subscription = createSubscription(async () => {
      for (const sub of activeSubscriptions) {
        if (sub.subscription === subscription) {
          activeSubscriptions.delete(sub);
          // Complete this specific subscriber
          scheduler.enqueue(async () => {
            try {
              await sub.receiver.complete?.();
            } catch (error) {
              console.warn("Error completing cancelled receiver:", error);
            }
          });
          break;
        }
      }
      
      if (activeSubscriptions.size === 0 && abortController) {
        abortController.abort();
        abortController = null;
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

  /**
   * Starts the multicast loop that executes the generator and distributes values.
   *
   * This internal function:
   * - Creates and executes the async generator
   * - Iterates through yielded values until completion or abort
   * - Distributes each value to all active subscribers via scheduler
   * - Handles errors by propagating them to all subscribers
   * - Performs cleanup when done (natural completion or abort)
   * - Completes remaining subscribers on natural termination
   *
   * The loop respects the abort signal and stops immediately when signaled.
   * All value/error/completion emissions go through the scheduler to maintain ordering.
   *
   * @param genFn The generator function to execute
   * @param controller The abort controller for cancellation
   */
  const startMulticastLoop = (genFn: () => AsyncGenerator<T>, controller: AbortController) => {
    (async () => {
      const { signal } = controller;
      let iterator: AsyncIterator<T> | null = null;

      try {
        iterator = genFn()[Symbol.asyncIterator]();
        
        while (!signal.aborted) {
          const result = await iterator.next();
          
          if (signal.aborted) break;
          if (result.done) break;

          const value = result.value;
          const subscribers = Array.from(activeSubscriptions);

          // Deliver value to active subscribers
          scheduler.enqueue(async () => {
            for (const { receiver, subscription } of subscribers) {
              if (!subscription.unsubscribed) {
                try {
                  await receiver.next?.(value);
                } catch (err) {
                  try {
                    await receiver.error?.(err instanceof Error ? err : new Error(String(err)));
                  } catch {}
                }
              }
            }
          });
        }
      } catch (err) {
        if (!signal.aborted) {
          const error = err instanceof Error ? err : new Error(String(err));
          const subscribers = Array.from(activeSubscriptions);
          scheduler.enqueue(async () => {
            for (const { receiver, subscription } of subscribers) {
              if (!subscription.unsubscribed) {
                try {
                  await receiver.error?.(error);
                } catch {}
              }
            }
          });
        }
      } finally {
        if (iterator?.return) {
          try { await iterator.return(); } catch {}
        }
        
        // Complete remaining subscribers on natural completion only
        if (!signal.aborted) {
          const subscribers = Array.from(activeSubscriptions);
          scheduler.enqueue(async () => {
            for (const { receiver, subscription } of subscribers) {
              if (!subscription.unsubscribed) {
                try {
                  await receiver.complete?.();
                } catch {}
              }
            }
          });
        }
        isRunning = false;
      }
    })();
  };

  let self: Stream<T>;
  const pipe = ((...operators: Operator<any, any>[]) => pipeStream(self, operators)) as OperatorChain<T>;

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
 * Pipes a stream through a series of transformation operators.
 *
 * Creates a new derived stream that applies a chain of operators to transform
 * the values from the source stream. Each operator receives an async iterator
 * and returns a new async iterator, allowing for powerful composition of
 * transformations like mapping, filtering, debouncing, etc.
 *
 * The piped stream:
 * - Subscribes to the source stream when it gets its first subscriber
 * - Applies operators in sequence to create a transformation pipeline
 * - Emits transformed values through the scheduler for proper ordering
 * - Manages the lifecycle of the iterator chain
 * - Propagates errors and completion through the pipeline
 * - Cleans up resources when unsubscribed
 *
 * All emissions go through the scheduler to maintain synchronization and ordering
 * guarantees, even when operators perform async operations.
 *
 * @template TIn The type of values from the source stream
 * @template Ops The tuple type of operators being applied
 *
 * @param source The source stream to transform
 * @param operators Array of operators to apply in sequence
 *
 * @returns A new derived `Stream` with the operators applied. This stream can be
 * further piped with additional operators.
 *
 * @example
 * ```typescript
 * const numbers = createStream('numbers', async function*() {
 *   yield 1; yield 2; yield 3; yield 4;
 * });
 *
 * const transformed = pipeStream(numbers, [
 *   map(n => n * 2),
 *   filter(n => n > 4)
 * ]);
 *
 * transformed.subscribe(n => console.log(n));
 * // Output: 6, 8
 * ```
 *
 * @example
 * ```typescript
 * // Operators can be chained with the pipe method
 * const result = numbers.pipe(
 *   map(n => n * 2),
 *   filter(n => n > 4),
 *   take(1)
 * );
 * ```
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

    /**
     * Subscribes to the piped stream.
     *
     * Creates a subscription that:
     * - Converts the source stream to an async iterator
     * - Applies all operators in sequence to build the transformation pipeline
     * - Iterates through the pipeline, emitting values via scheduler
     * - Handles abort signals for clean cancellation
     * - Manages error propagation and completion
     * - Cleans up the iterator chain on unsubscribe
     *
     * @param cb Optional callback or receiver for handling stream events
     * @returns Subscription object for managing the subscription lifecycle
     */
    subscribe(cb?: ((value: any) => CallbackReturnType) | Receiver<any>) {
      const receiver = createReceiver(cb);
      const sourceIterator = eachValueFrom(source)[Symbol.asyncIterator]() as AsyncIterator<TIn>;
      let currentIterator: AsyncIterator<any> = sourceIterator;

      for (const op of operators) {
        currentIterator = op.apply(currentIterator);
      }

      const abortController = new AbortController();
      const { signal } = abortController;

      const subscription = createSubscription(async () => {
        abortController.abort();
        if (currentIterator.return) {
          await currentIterator.return().catch(() => {});
        }
        // Complete when unsubscribing
        scheduler.enqueue(async () => {
          await receiver.complete?.();
        });
      });

      (async () => {
        try {
          while (!signal.aborted) {
            const result = await currentIterator.next();
            
            if (signal.aborted) break;
            if (result.done) break;

            scheduler.enqueue(async () => {
              if (!subscription.unsubscribed) {
                try {
                  await receiver.next?.(result.value);
                } catch (err) {
                  try {
                    await receiver.error?.(err instanceof Error ? err : new Error(String(err)));
                  } catch {}
                }
              }
            });
          }
        } catch (err: any) {
          if (!signal.aborted && !subscription.unsubscribed) {
            scheduler.enqueue(async () => await receiver.error?.(err));
          }
        } finally {
          // Complete on natural completion (not abort)
          if (!signal.aborted && !subscription.unsubscribed) {
            scheduler.enqueue(async () => {
              await receiver.complete?.();
            });
          }
        }
      })();

      return subscription;
    },

    /**
     * Queries the piped stream for its first value.
     *
     * This is a convenience method that subscribes to the stream, waits for
     * the first emitted value, and then automatically unsubscribes.
     *
     * @returns Promise that resolves with the first emitted value
     * @throws If the stream completes without emitting any values
     */
    async query() {
      return firstValueFrom(pipedStream);
    },
  };

  return pipedStream;
}