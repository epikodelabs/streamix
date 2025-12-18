/**
 * Context object passed to `onPipeStream` runtime hook.
 *
 * Describes the stream being piped, its subscription,
 * the original source iterator, and the operator chain.
 */
export type PipeStreamHookContext = {
  /** Unique identifier of the stream instance */
  streamId: string;

  /** Optional human-readable stream name */
  streamName?: string;

  /** Unique identifier of the subscription */
  subscriptionId: string;

  /** Source async iterator before operators are applied */
  source: AsyncIterator<any>;

  /** List of operators applied to the stream */
  operators: any[];
};

/**
 * Result returned from `onPipeStream` runtime hook.
 *
 * Allows intercepting and replacing parts of the stream pipeline.
 */
export type PipeStreamHookResult = {
  /** Optionally replace the source iterator */
  source?: AsyncIterator<any>;

  /** Optionally replace or mutate the operator list */
  operators?: any[];

  /**
   * Optional final wrapper applied after operators
   * but before the stream is consumed.
   */
  final?: (iterator: AsyncIterator<any>) => AsyncIterator<any>;
};

/**
 * Runtime hooks for Streamix internal lifecycle events.
 *
 * These hooks are intended for tracing, debugging,
 * profiling, and developer tooling.
 */
export type StreamRuntimeHooks = {
  /**
   * Called when a stream is created.
   *
   * Useful for registering stream metadata
   * or initializing tracing structures.
   */
  onCreateStream?: (info: {
    /** Generated stream identifier */
    id: string;

    /** Optional stream name */
    name?: string;
  }) => void;

  /**
   * Called when a stream is piped.
   *
   * Allows observing or modifying the pipeline,
   * including source, operators, or final iterator.
   */
  onPipeStream?: (
    ctx: PipeStreamHookContext
  ) => PipeStreamHookResult | void;
};

/**
 * Global symbol key used to store runtime hooks.
 *
 * Stored on `globalThis` to allow cross-module access
 * without introducing hard dependencies.
 */
const HOOKS_KEY = "__STREAMIX_RUNTIME_HOOKS__";

/**
 * Monotonically increasing counters for ID generation.
 *
 * These counters are intentionally process-local
 * and reset on application restart.
 */
let streamIdCounter = 0;
let subscriptionIdCounter = 0;

/**
 * Generates a unique stream identifier.
 *
 * IDs are stable within a single runtime session
 * and deterministic for tracing purposes.
 */
export function generateStreamId(): string {
  return `str_${++streamIdCounter}`;
}

/**
 * Generates a unique subscription identifier.
 *
 * Used to correlate subscriptions with
 * emitted values and lifecycle events.
 */
export function generateSubscriptionId(): string {
  return `sub_${++subscriptionIdCounter}`;
}

/**
 * Registers runtime hooks globally.
 *
 * Calling this function replaces any previously
 * registered hooks.
 */
export function registerRuntimeHooks(hooks: StreamRuntimeHooks): void {
  (globalThis as any)[HOOKS_KEY] = hooks;
}

/**
 * Retrieves the currently registered runtime hooks.
 *
 * Returns `null` if no hooks are registered.
 */
export function getRuntimeHooks(): StreamRuntimeHooks | null {
  return ((globalThis as any)[HOOKS_KEY] ?? null) as StreamRuntimeHooks | null;
}
