import type { MaybePromise } from "./operator";

/**
 * Represents a subscription to a stream-like source.
 *
 * A `Subscription` is returned from a stream's `subscribe()` method and
 * represents an active connection between a producer and a consumer.
 *
 * The subscription itself is callable: calling it is shorthand for
 * unsubscription. This supports the idiomatic pattern:
 *
 * ```ts
 * const unsubscribe = count.subscribe((current, previous) => { ... });
 * unsubscribe();
 * // or, if teardown is async:
 * await unsubscribe();
 * ```
 *
 * @template T The type of the values in the source stream.
 */
export type Subscription = (() => MaybePromise) & {
  /**
   * Indicates whether the subscription has been terminated.
   *
   * - `false` - subscription is active
   * - `true`  - subscription has been unsubscribed and is inactive
   *
   * This flag becomes `true` immediately when the subscription is invoked
   * for the first time.
   */
  readonly unsubscribed: boolean;
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

  return subscription;
}
