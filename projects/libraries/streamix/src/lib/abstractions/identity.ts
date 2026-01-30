/* ============================================================================
 * Stream & subscription identity
 * ========================================================================== */

/**
 * Monotonically increasing counters for ID generation.
 *
 * These counters are intentionally process-local and reset on reload.
 * They are NOT persisted and MUST NOT be reused across runtimes.
 */
let streamIdCounter = 0;
let subscriptionIdCounter = 0;

/**
 * Generate a short, unique stream id for runtime tracing.
 */
export function generateStreamId(): string {
  return `str_${++streamIdCounter}`;
}

/**
 * Generate a short, unique subscription id used to correlate subscriptions.
 */
export function generateSubscriptionId(): string {
  return `sub_${++subscriptionIdCounter}`;
}
