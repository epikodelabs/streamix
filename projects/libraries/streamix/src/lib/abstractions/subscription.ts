import type { MaybePromise } from "../abstractions";

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
 * @returns A new `Subscription` object
 */
export function createSubscription(
  onUnsubscribe?: () => MaybePromise
): Subscription {
  /** Internal mutable subscription state */
  let _unsubscribed = false;
  let _unsubscribing = false;

  const subscription: Subscription = {
    get unsubscribed() {
      return _unsubscribed;
    },

    unsubscribe: function (): void {
      // Prevent double unsubscribe
      if (_unsubscribed || _unsubscribing) {
        return;
      }
      
      _unsubscribing = true;
      
      try {
        const result = onUnsubscribe?.();
        
        if (result && typeof result === 'object' && 'then' in result) {
          // Handle async cleanup
          result.then(
            () => {
              _unsubscribed = true;
              _unsubscribing = false;
            },
            (err: any) => {
              console.error("Error during unsubscribe callback:", err);
              _unsubscribed = true;
              _unsubscribing = false;
            }
          );
        } else {
          // Sync cleanup
          _unsubscribed = true;
          _unsubscribing = false;
        }
      } catch (err: any) {
        // Handle sync errors
        console.error("Error during unsubscribe callback:", err);
        _unsubscribed = true;
        _unsubscribing = false;
      }
    },

    onUnsubscribe
  };

  return subscription;
}