import { type Operator } from "./operator";

/* ============================================================================
 * Pipe / Runtime hook types
 * ========================================================================== */

export type PipeStreamHookContext = {
  streamId: string;
  streamName?: string;
  subscriptionId: string;
  parentValueId?: string;
  source: AsyncIterator<any>;
  operators: Operator<any, any>[];
};

export type PipeStreamHookResult = {
  source?: AsyncIterator<any>;
  operators?: any[];
  final?: (iterator: AsyncIterator<any>) => AsyncIterator<any>;
};

export type StreamRuntimeHooks = {
  onCreateStream?: (info: { id: string; name?: string }) => void;
  onPipeStream?: (
    ctx: PipeStreamHookContext
  ) => PipeStreamHookResult | void;
};

/* ============================================================================
 * Global hook registry
 * ========================================================================== */

const HOOKS_KEY = "__STREAMIX_RUNTIME_HOOKS__";

export function registerRuntimeHooks(hooks: StreamRuntimeHooks): void {
  (globalThis as any)[HOOKS_KEY] = hooks;
}

export function getRuntimeHooks(): StreamRuntimeHooks | null {
  return ((globalThis as any)[HOOKS_KEY] ?? null) as StreamRuntimeHooks | null;
}

/* ============================================================================
 * Iterator & value metadata (unchanged, but cleaned)
 * ========================================================================== */

export type IteratorMetaKind = "transform" | "collapse" | "expand";

export type IteratorMetaTag = {
  valueId: string;
  kind?: IteratorMetaKind;
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

export const VALUE_META_SYMBOL = Symbol("__streamix_value_meta__");

export function setIteratorMeta(
  iterator: AsyncIterator<any>,
  meta: IteratorMetaTag,
  operatorIndex: number,
  operatorName: string
): void {
  ITERATOR_META.set(iterator, {
    valueId: meta.valueId,
    operatorIndex,
    operatorName,
    kind: meta.kind,
    inputValueIds: meta.inputValueIds,
  });
}

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
    kind: meta.kind,
    inputValueIds: meta.inputValueIds,
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

export function getValueMeta(value: any) {
  if (value !== null && typeof value === "object") {
    return VALUE_META.get(value);
  }
  return undefined;
}

export function isWrappedPrimitive(value: any): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    VALUE_META_SYMBOL in value
  );
}

export function unwrapPrimitive(value: any): any {
  return isWrappedPrimitive(value) ? value[VALUE_META_SYMBOL] : value;
}

/* ============================================================================
 * Pipe hook application
 * ========================================================================== */

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
    if (patch?.source) iterator = patch.source;
    if (patch?.operators) operators = patch.operators;
    if (patch?.final) finalWrap = patch.final;
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
 * Until-gate (shared synchronization primitive)
 * ========================================================================== */

/**
 * Gate used by until-style operators (skipUntil, takeUntil, etc).
 *
 * IMPORTANT:
 * - Populated at EMISSION TIME (via hooks / emission context)
 * - Never mutated from iterator pull logic
 */
export type UntilGate = {
  /** First notifier emission stamp */
  openStamp: number | null;

  /** Notifier terminal stamp if completed before open */
  closeStamp: number | null;

  /** Notifier error, if any */
  error: any | null;
};

/**
 * Factory – NEVER use a global singleton gate.
 * Each notifier must have its own gate.
 */
export function createUntilGate(): UntilGate {
  return {
    openStamp: null,
    closeStamp: null,
    error: null,
  };
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
 * Generates a unique stream identifier.
 *
 * Used for:
 * - runtime hooks
 * - tracing
 * - gate ownership (until-operators)
 */
export function generateStreamId(): string {
  return `str_${++streamIdCounter}`;
}

/**
 * Generates a unique subscription identifier.
 *
 * Used to:
 * - distinguish concurrent subscribers
 * - correlate lifecycle events
 */
export function generateSubscriptionId(): string {
  return `sub_${++subscriptionIdCounter}`;
}