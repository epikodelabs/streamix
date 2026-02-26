import type { MaybePromise } from "./operator";

/**
 * Represents a subscription to a stream-like source.
 *
 * A `Subscription` is returned from a stream's `subscribe()` method and
 * represents an active connection between a producer and a consumer.
 *
 * Responsibilities:
 * - Tracks whether the subscription is active
 * - Provides an idempotent mechanism to unsubscribe
 * - Optionally executes cleanup logic on unsubscribe
 */
export type Subscription = {
  /**
   * Indicates whether the subscription has been terminated.
   *
   * - `false` - subscription is active
   * - `true`  - subscription has been unsubscribed and is inactive
   *
   * This flag becomes `true` immediately when `unsubscribe()` is invoked
   * for the first time.
   */
  readonly unsubscribed: boolean;

  /**
   * Terminates the subscription.
   *
   * Semantics:
   * - Idempotent: calling multiple times has no additional effect
   * - Marks the subscription as unsubscribed synchronously
   * - Executes cleanup logic (if provided) exactly once
   * - Stream receivers may still get `complete()` as a cleanup signal
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
  onUnsubscribe?: () => MaybePromise;
};

/**
 * Creates a new `Subscription` instance.
 *
 * This factory encapsulates subscription state and ensures:
 * - Safe, idempotent unsubscription
 * - Proper execution of cleanup logic
 * - Consistent error handling during teardown
 *
 * @param onUnsubscribe Optional cleanup callback executed on first unsubscribe
 * @returns {Subscription} A new Subscription object
 */
export function createSubscription(
  onUnsubscribe?: () => MaybePromise
): Subscription {
  /** Internal mutable subscription state */
  let _unsubscribed = false;

  return {
    /**
   * - `true`  - subscription has been unsubscribed and is inactive
     */
    get unsubscribed() {
      return _unsubscribed;
    },

    /**
     * Unsubscribes from the subscription.
     *
     * This method:
     * 1. Marks the subscription as unsubscribed
     * 2. Executes the `onUnsubscribe` callback (if present)
     * 3. Suppresses and logs any errors thrown during cleanup
     */
    unsubscribe: async function (): Promise<void> {
      if (!_unsubscribed) {
        _unsubscribed = true;
        try {
          await this.onUnsubscribe?.();
        } catch (err) {
          console.error("Error during unsubscribe callback:", err);
        }
      }
    },

    /**
     * Cleanup callback executed when unsubscribing.
     */
    onUnsubscribe
  };
}
