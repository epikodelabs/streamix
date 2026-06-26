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
 * You can chain extra teardown logic with `compose`:
 *
 * ```ts
 * const unsubscribe = count.subscribe(...).compose(() => {
 *   console.log("extra cleanup");
 * });
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
   * for the first time.
   */
  readonly unsubscribed: boolean;

  /**
   * Registers additional teardown callbacks to run when the subscription is
   * terminated. Callbacks are executed after the original teardown.
   *
   * If the subscription has already been unsubscribed, the new teardowns are
   * run immediately.
   *
   * @param teardowns One or more cleanup callbacks to chain.
   * @returns The same subscription handle, for chaining.
   */
  compose(...teardowns: Array<() => MaybePromise>): Subscription;
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

  const extras: Array<() => MaybePromise> = [];

  const runTeardowns = (): MaybePromise => {
    const results: MaybePromise[] = [];

    const run = (fn?: () => MaybePromise) => {
      try {
        const result = fn?.();
        if (result && typeof (result as PromiseLike<void>).then === "function") {
          results.push(result);
        }
      } catch (err) {
        console.error("Error during unsubscribe callback:", err);
      }
    };

    run(teardown);
    for (const extra of extras) run(extra);

    if (results.length > 0) {
      return Promise.all(results).then(() => undefined);
    }
  };

  const unsubscribe = (): MaybePromise => {
    if (!_unsubscribed) {
      _unsubscribed = true;
      return runTeardowns();
    }
  };

  const subscription = unsubscribe as Subscription;

  Object.defineProperty(subscription, "unsubscribed", {
    get: () => _unsubscribed,
  });

  subscription.compose = (
    ...additional: Array<() => MaybePromise>
  ): Subscription => {
    if (_unsubscribed) {
      for (const fn of additional) {
        try {
          const result = fn();
          if (result && typeof (result as PromiseLike<void>).then === "function") {
            result.catch((err: any) =>
              console.error("Error during compose teardown callback:", err)
            );
          }
        } catch (err) {
          console.error("Error during compose teardown callback:", err);
        }
      }
    } else {
      extras.push(...additional);
    }
    return subscription;
  };

  return subscription;
}
