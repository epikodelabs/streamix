import type { MaybePromise } from "./operator";

/**
 * Represents a subscription to a stream-like source.
 *
 * A `Subscription` is returned from a stream's `subscribe()` method and
 * represents an active connection between a producer and a consumer.
 *
 * The subscription itself is callable: calling it is shorthand for calling
 * `unsubscribe()`. This supports the idiomatic pattern:
 *
 * ```ts
 * const unsubscribe = count.subscribe((current, previous) => { ... });
 * unsubscribe();
 * // or, if teardown is async:
 * await unsubscribe();
 * ```
 *
 * The classic object form still works as well:
 *
 * ```ts
 * const subscription = count.subscribe(...);
 * subscription.unsubscribe();
 * ```
 */
export type Subscription = (() => MaybePromise) & {
  /**
   * Indicates whether the subscription has been terminated.
   *
   * - `false` - subscription is active
   * - `true`  - subscription has been unsubscribed and is inactive
   *
   * This flag becomes `true` immediately when the subscription is invoked
   * or when `unsubscribe()` is called for the first time.
   */
  readonly unsubscribed: boolean;

  /**
   * Terminates the subscription.
   *
   * Semantics:
   * - Idempotent: calling multiple times has no additional effect
   * - Marks the subscription as unsubscribed synchronously
   * - Executes cleanup logic (if provided) exactly once
   * - Observers may still get `complete()` as a cleanup signal
   *
   * Errors thrown by cleanup logic are caught and logged.
   *
   * @returns A `MaybePromise<void>` that resolves when cleanup completes
   */
  unsubscribe(): MaybePromise;

  /**
   * Optional cleanup callback executed during unsubscription.
   *
   * Intended usage:
   * - Remove event listeners
   * - Cancel timers or async tasks
   * - Abort generators or observers
   *
   * Guarantees:
   * - Called at most once
   * - Executed only after `unsubscribed` becomes `true`
   * - May be synchronous or asynchronous
   *
   * Any errors thrown by this callback are caught internally.
   */
  teardown?: () => MaybePromise;
};

/**
 * Creates a new `Subscription` instance.
 *
 * This factory encapsulates subscription state and ensures:
 * - Safe, idempotent unsubscription
 * - Proper execution of cleanup logic
 * - Consistent error handling during teardown
 *
 * @param teardown Optional cleanup callback executed on first unsubscribe
 * @returns {Subscription} A callable subscription handle
 */
export function createSubscription(
  teardown?: () => MaybePromise
): Subscription {
  /** Internal mutable subscription state */
  let _unsubscribed = false;

  const unsubscribe = (): MaybePromise => {
    if (!_unsubscribed) {
      _unsubscribed = true;
      try {
        return teardown?.();
      } catch (err) {
        console.error("Error during unsubscribe callback:", err);
      }
    }
  };

  const subscription = unsubscribe as Subscription;

  Object.defineProperty(subscription, "unsubscribed", {
    get: () => _unsubscribed,
  });

  subscription.unsubscribe = unsubscribe;
  subscription.teardown = teardown;

  return subscription;
}
