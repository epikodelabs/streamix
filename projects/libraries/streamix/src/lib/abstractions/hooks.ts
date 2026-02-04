import { type Operator } from "./operator";

/* ============================================================================
 * Pipe / Runtime hook types
 * ========================================================================== */

/**
 * Context object provided to the `onPipeStream` runtime hook.
 *
 * Contains identifiers and the current operator chain so tooling can
 * inspect or modify the stream pipeline before it is executed.
 */
export type PipeStreamHookContext = {
  streamId: string;
  streamName?: string;
  subscriptionId: string;
  parentValueId?: string;
  source: AsyncIterator<any>;
  operators: Operator<any, any>[];
};

/**
 * Result returned by an `onPipeStream` hook.
 *
 * Any provided fields patch the pipeline used for the subscription.
 */
export type PipeStreamHookResult = {
  source?: AsyncIterator<any>;
  operators?: any[];
  final?: (iterator: AsyncIterator<any>) => AsyncIterator<any>;
};

/**
 * Hooks that can be registered to observe or modify runtime stream behavior.
 */
export type StreamRuntimeHooks = {
  /** Called when a stream is created. Useful for tracing and instrumentation. */
  onCreateStream?: (info: { id: string; name?: string }) => void;
  /**
   * Called when a source stream is piped through operators. Returning a
   * `PipeStreamHookResult` allows modifying the source iterator, operator
   * list or applying a final wrapper around the iterator.
   */
  onPipeStream?: (
    ctx: PipeStreamHookContext
  ) => PipeStreamHookResult | void;
};

/* ============================================================================
 * Global hook registry
 * ========================================================================== */

const HOOKS_KEY = "__STREAMIX_RUNTIME_HOOKS__";

/**
 * Registers runtime hooks used by instrumentation and devtools.
 *
 * Replaces any previously-registered hooks for the current global context.
 */
export function registerRuntimeHooks(hooks: StreamRuntimeHooks): void {
  (globalThis as any)[HOOKS_KEY] = hooks;
}

/**
 * Unregisters the current runtime hooks, if any.
 */
export function unregisterRuntimeHooks(): void {
  delete (globalThis as any)[HOOKS_KEY];
}

/**
 * Returns the currently-registered runtime hooks, if any.
 *
 * @returns {StreamRuntimeHooks | null} The registered hooks or null.
 */
export function getRuntimeHooks(): StreamRuntimeHooks | null {
  return ((globalThis as any)[HOOKS_KEY] ?? null) as StreamRuntimeHooks | null;
}

/* ============================================================================
 * Iterator & value metadata (unchanged, but cleaned)
 * ========================================================================== */

/**
 * Kinds of iterator metadata describing how a value was produced.
 */
export type IteratorMetaKind = "transform" | "collapse" | "expand";

/**
 * Metadata tag attached to iterators to correlate values across operators.
 */
export type IteratorMetaTag = {
  /** Unique identifier for the value produced by the iterator. */
  valueId: string;
  /** Optional kind describing the transformation performed. */
  kind?: IteratorMetaKind;
  /** Optional list of parent value ids (for collapse/expand operations). */
  inputValueIds?: string[];
};

const ITERATOR_META = new WeakMap<
  AsyncIterator<any>,
  {
    valueId: string;
    operatorIndex: number;
    operatorName: string;
    kind?: IteratorMetaKind;
    inputValueIds?: string[];
  }
>();

const VALUE_META = new WeakMap<
  object,
  {
    valueId: string;
    operatorIndex: number;
    operatorName: string;
    kind?: IteratorMetaKind;
    inputValueIds?: string[];
  }
>();

/** Symbol key used when wrapping primitive values with metadata. */
export const VALUE_META_SYMBOL = Symbol("__streamix_value_meta__");

/**
 * Attach iterator-level metadata used by tracing and until-style operators.
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
 * Retrieve attached iterator metadata, if present.
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
 * Attach metadata to a value. Object values receive metadata directly; primitive
 * values are wrapped in a small object so their metadata can be tracked.
 */
export function setValueMeta(
  value: any,
  meta: IteratorMetaTag,
  operatorIndex: number,
  operatorName: string
): any {
  const entry = {
    valueId: meta.valueId,
    operatorIndex,
    operatorName,
    // only include optional fields when provided so equality checks
    // don't see explicit `undefined` properties
    ...(meta.kind !== undefined ? { kind: meta.kind } : {}),
    ...(meta.inputValueIds !== undefined ? { inputValueIds: meta.inputValueIds } : {}),
  };

  if (value !== null && typeof value === "object") {
    VALUE_META.set(value, entry);
    return value;
  }

  if (value !== null && value !== undefined) {
    const wrapper = { [VALUE_META_SYMBOL]: value };
    VALUE_META.set(wrapper, entry);
    return wrapper;
  }

  return value;
}

/**
 * Return metadata previously attached to a value, or `undefined` if none.
 */
export function getValueMeta(value: any) {
  if (value !== null && typeof value === "object") {
    return VALUE_META.get(value);
  }
  return undefined;
}

/**
 * Returns true when a value is a wrapper created to hold metadata for a
 * primitive value.
 */
export function isWrappedPrimitive(value: any): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    VALUE_META_SYMBOL in value
  );
}

/**
 * Unwrap a primitive value previously wrapped by `setValueMeta`.
 */
export function unwrapPrimitive(value: any): any {
  return isWrappedPrimitive(value) ? value[VALUE_META_SYMBOL] : value;
}

/* ============================================================================
 * Pipe hook application
 * ========================================================================== */

/**
 * Apply any configured `onPipeStream` hooks and then materialize the
 * operator chain into a final `AsyncIterator`.
 */
export function applyPipeStreamHooks(
  ctx: PipeStreamHookContext
): AsyncIterator<any> {
  const hooks = getRuntimeHooks();

  let iterator: AsyncIterator<any> = ctx.source;
  let operators = ctx.operators;
  let finalWrap:
    | ((it: AsyncIterator<any>) => AsyncIterator<any>)
    | undefined;

  if (hooks?.onPipeStream) {
    const patch = hooks.onPipeStream(ctx);
    if (patch && typeof patch === 'object') {
      if ('source' in patch && patch.source) iterator = patch.source;
      if ('operators' in patch && patch.operators) operators = patch.operators;
      if ('final' in patch && patch.final) finalWrap = patch.final;
    }
  }

  for (const op of operators) {
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