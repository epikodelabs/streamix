import { type Operator } from "./operator";

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

  /** Traced outer value id associated with an inner stream */
  parentValueId?: string;

  /** Source async iterator before operators are applied */
  source: AsyncIterator<any>;

  /** List of operators applied to the stream */
  operators: Operator<any, any>[];
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
export type IteratorMetaKind = "transform" | "collapse" | "expand";
export type IteratorMetaTag = {
  valueId: string;
  kind?: IteratorMetaKind;
  inputValueIds?: string[];
};

const ITERATOR_META = new WeakMap<
  AsyncIterator<any>,
  { valueId: string; operatorIndex: number; operatorName: string; kind?: IteratorMetaKind; inputValueIds?: string[] }
>();

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

/**
 * Associates the latest traced metadata with an iterator.
 *
 * Used to connect operator execution with outer values
 * without mutating iterator results.
 */
export function setIteratorMeta(
  iterator: AsyncIterator<any>,
  meta: IteratorMetaTag,
  operatorIndex: number,
  operatorName: string
): void {
  const entry: {
    valueId: string;
    operatorIndex: number;
    operatorName: string;
    kind?: IteratorMetaKind;
    inputValueIds?: string[];
  } = {
    valueId: meta.valueId,
    operatorIndex,
    operatorName,
  };

  if (meta.kind !== undefined) entry.kind = meta.kind;
  if (meta.inputValueIds !== undefined) entry.inputValueIds = meta.inputValueIds;

  ITERATOR_META.set(iterator, entry);
}

/**
 * Retrieves the latest traced metadata for an iterator.
 */
export function getIteratorMeta(
  iterator: AsyncIterator<any>
):
  | {
      valueId: string;
      operatorIndex: number;
      operatorName: string;
      kind?: IteratorMetaKind;
      inputValueIds?: string[];
    }
  | undefined {
  return ITERATOR_META.get(iterator);
}

/**
 * Applies any registered `onPipeStream` patch to an iterator pipeline.
 *
 * This helper is useful for wrapping inner streams that are consumed
 * via async iterators and do not automatically trigger `onPipeStream`.
 */
export function applyPipeStreamHooks(
  ctx: PipeStreamHookContext
): AsyncIterator<any> {
  const hooks = getRuntimeHooks();
  let iterator: AsyncIterator<any> = ctx.source;
  let ops = ctx.operators;
  let finalWrap: ((it: AsyncIterator<any>) => AsyncIterator<any>) | undefined;

  if (hooks?.onPipeStream) {
    const patch = hooks.onPipeStream(ctx);
    if (patch?.source) iterator = patch.source;
    if (patch?.operators) ops = patch.operators;
    if (patch?.final) finalWrap = patch.final;
  }

  for (const op of ops) {
    iterator = op.apply(iterator);
  }

  if (finalWrap) {
    iterator = finalWrap(iterator);
  }

  if (typeof (iterator as any)[Symbol.asyncIterator] !== "function") {
    (iterator as any)[Symbol.asyncIterator] = () => iterator;
  }

  return iterator;
}
