/**
 * Streamix tracing core primitives.
 *
 * This module provides the foundational tracing infrastructure for Streamix pipelines
 * without any tracer implementations. It defines the contracts, wrapper utilities,
 * and runtime integration points that tracers can use.
 *
 * Tracer implementations should be built separately on top of this core.
 */
import {
  createOperator,
  getValueMeta,
  registerRuntimeHooks,
  setIteratorMeta,
  unwrapPrimitive,
} from "@epikodelabs/streamix";

/* ============================================================================ */
/* PUBLIC TYPES */
/* ============================================================================ */

/**
 * High-level lifecycle state of a traced value.
 */
export type ValueState =
  | "emitted"
  | "transformed"
  | "filtered"
  | "collapsed"
  | "expanded"
  | "errored"
  | "delivered"
  | "dropped";

/**
 * The outcome recorded for a single operator pass over an input value.
 */
export type OperatorOutcome =
  | "transformed"
  | "filtered"
  | "expanded"
  | "collapsed"
  | "errored";

/** One operator invocation within a value's lifecycle. */
export interface OperatorStep {
  operatorIndex: number;
  operatorName: string;
  enteredAt: number;
  exitedAt?: number;
  outcome?: OperatorOutcome;
  inputValue: any;
  outputValue?: any;
  error?: Error;
}

/**
 * Why a value's trace ended without being delivered downstream.
 */
export type TerminalReason = "filtered" | "collapsed" | "errored" | "late";

/**
 * Public snapshot of a value's trace at a moment in time.
 */
export interface ValueTrace {
  valueId: string;
  parentTraceId?: string;
  streamId: string;
  streamName?: string;
  subscriptionId: string;
  emittedAt: number;
  deliveredAt?: number;
  state: ValueState;
  sourceValue: any;
  finalValue?: any;
  operatorSteps: OperatorStep[];
  droppedReason?: {
    operatorIndex: number;
    operatorName: string;
    reason: TerminalReason;
    error?: Error;
  };
  collapsedInto?: {
    operatorIndex: number;
    operatorName: string;
    targetValueId: string;
  };
  expandedFrom?: {
    operatorIndex: number;
    operatorName: string;
    baseValueId: string;
  };
  totalDuration?: number;
  operatorDurations: Map<string, number>;
}

/**
 * Tracer interface used by the runtime hooks to record value lifecycles.
 *
 * Implementations can choose to track full operator steps, minimal terminal states,
 * or anything in between.
 */
export interface ValueTracer {
  /** Begins a new trace record for a value id. */
  startTrace: (vId: string, sId: string, sName: string | undefined, subId: string, val: any) => ValueTrace;
  /** Creates a new trace id that is treated as expanded from `baseId`. */
  createExpandedTrace: (baseId: string, opIdx: number, opName: string, val: any) => string;
  /** Records entering an operator (tracer can choose to ignore if not tracking steps). */
  enterOperator: (vId: string, opIdx: number, opName: string, val: any) => void;
  /**
   * Records an operator exit and (optionally) marks the trace terminal when filtered/errored.
   * Returns the value id on success, or `null` when no update was applied.
   */
  exitOperator: (vId: string, opIdx: number, val: any, filtered?: boolean, outcome?: OperatorOutcome) => string | null;
  /** Marks a value as collapsed into another value id and terminalizes it as `collapsed`. */
  collapseValue: (vId: string, opIdx: number, opName: string, targetId: string, val?: any) => void;
  /** Marks a value as errored in an operator and terminalizes it as `errored`. */
  errorInOperator: (vId: string, opIdx: number, error: Error) => void;
  /** Marks a value trace as delivered (unless already terminal). */
  markDelivered: (vId: string) => void;
  /** Marks the subscription as completed and notifies any per-subscription observers. */
  completeSubscription: (subId: string) => void;
}

/* ============================================================================ */
/* TRACED VALUE WRAPPER */
/* ============================================================================ */

const tracedValueBrand = Symbol("__streamix_traced__");

export interface TracedWrapper<T> {
  [tracedValueBrand]: true;
  value: T;
  meta: { valueId: string; streamId: string; subscriptionId: string };
}

/** Wraps a value with tracing metadata for internal runtime propagation. */
export const wrapTracedValue = <T>(value: T, meta: TracedWrapper<T>["meta"]): TracedWrapper<T> =>
  ({ [tracedValueBrand]: true, value, meta });

/** Unwraps a traced wrapper back to the raw value (or returns the input if it's not traced). */
export const unwrapTracedValue = <T>(v: any): T => (v?.[tracedValueBrand]) ? v.value : v;

/** Type guard for `TracedWrapper`. */
export const isTracedValue = (v: any): v is TracedWrapper<any> => Boolean(v?.[tracedValueBrand]);

/** Extracts the `valueId` from a traced wrapper (if present). */
export const getValueId = (v: any): string | undefined => isTracedValue(v) ? v.meta.valueId : undefined;

/* ============================================================================ */
/* GLOBAL TRACER MANAGEMENT */
/* ============================================================================ */

const TRACER_KEY = "__STREAMIX_GLOBAL_TRACER__";

/** Returns the currently enabled global tracer, if any. */
export const getGlobalTracer = (): ValueTracer | null => (globalThis as any)[TRACER_KEY] ?? null;

/** Installs the tracer into `globalThis` so the Streamix runtime hooks can record traces. */
export function enableTracing(t: ValueTracer): void { (globalThis as any)[TRACER_KEY] = t; }

/** Disables tracing by clearing the global tracer reference. */
export function disableTracing(): void { (globalThis as any)[TRACER_KEY] = null; }

/* ============================================================================ */
/* ID GENERATION */
/* ============================================================================ */

const IDS_KEY = "__STREAMIX_TRACE_IDS__";
const getIds = (): { value: number } => {
  const g = globalThis as any;
  return g[IDS_KEY] ??= { value: 0 };
};

/** Generates a unique value id for the current JS realm (stored on `globalThis`). */
export const generateValueId = (): string => `val_${++getIds().value}`;

/* ============================================================================ */
/* RUNTIME HOOKS */
/* ============================================================================ */

/**
 * Registers runtime hooks that integrate tracing with Streamix's pipe execution.
 * 
 * This should be called once when the tracing module is imported. The hooks will
 * automatically wrap values and operator chains when a global tracer is enabled.
 */
export function installTracingHooks(): void {
  registerRuntimeHooks({
    onPipeStream({ streamId, streamName, subscriptionId, parentValueId, source, operators }) {
      const tracer = getGlobalTracer();
      if (!tracer) return;

      return {
        source: {
          async next() {
            const r = await source.next();
            if (r.done) return r;

            let valueId: string;
            let value: any;

            if (isTracedValue(r.value)) {
              const wrapped = r.value as TracedWrapper<any>;
              valueId = wrapped.meta.valueId;
              value = wrapped.value;
            } else {
              value = r.value;
              valueId = parentValueId || generateValueId();
              if (!parentValueId) {
                tracer.startTrace(valueId, streamId, streamName, subscriptionId, value);
              }
            }

            return {
              done: false,
              value: wrapTracedValue(value, { valueId, streamId, subscriptionId }),
            };
          },
          return: source.return?.bind(source),
          throw: source.throw?.bind(source),
        },

        operators: operators.map((op, i) => {
          const opName = op.name ?? `op${i}`;

          return createOperator(`traced_${opName}`, (src) => {
            const inputQueue: TracedWrapper<any>[] = [];
            const metaByValueId = new Map<string, TracedWrapper<any>["meta"]>();
            let lastSeenMeta: TracedWrapper<any>["meta"] | null = null;
            let lastOutputMeta: TracedWrapper<any>["meta"] | null = null;

            let activeRequestBatch: TracedWrapper<any>[] | null = null;
            const outputCountByBaseKey = new Map<string, number>();

            const removeFromQueue = (valueId: string): void => {
              const idx = inputQueue.findIndex((w) => w.meta.valueId === valueId);
              if (idx >= 0) inputQueue.splice(idx, 1);
            };

            const exitAndRemove = (valueId: string, value: any, filtered: boolean, outcome: OperatorOutcome = "transformed"): void => {
              removeFromQueue(valueId);
              tracer.exitOperator(valueId, i, value, filtered, outcome);
            };

            const handleCollapse = (inputIds: string[], targetId: string, emittedValue: any): { done: false; value: TracedWrapper<any> } | null => {
              if (!metaByValueId.has(targetId)) return null;
              
              const targetMeta = metaByValueId.get(targetId)!;
              
              for (const id of inputIds) {
                if (id === targetId) continue;
                if (!metaByValueId.has(id)) continue;
                removeFromQueue(id);
                tracer.collapseValue(id, i, opName, targetId, emittedValue);
              }
              
              exitAndRemove(targetId, emittedValue, false, "collapsed");
              return wrapOutput(targetMeta, emittedValue);
            };

            const filterBatch = (batch: TracedWrapper<any>[], selectedId: string): void => {
              for (const item of batch) {
                if (item.meta.valueId !== selectedId) {
                  exitAndRemove(item.meta.valueId, item.value, true);
                }
              }
            };

            const handleExpansion = (baseValueId: string, baseMeta: TracedWrapper<any>["meta"], emittedValue: any): { done: false; value: TracedWrapper<any> } => {
              const key = `${baseValueId}:${i}`;
              const count = outputCountByBaseKey.get(key) ?? 0;
              outputCountByBaseKey.set(key, count + 1);

              if (count === 0) {
                exitAndRemove(baseValueId, emittedValue, false, "expanded");
                lastOutputMeta = baseMeta;
                return { done: false, value: wrapTracedValue(emittedValue, baseMeta) };
              }

              const expandedId = tracer.createExpandedTrace(baseValueId, i, opName, emittedValue);
              lastOutputMeta = baseMeta;
              return { done: false, value: wrapTracedValue(emittedValue, { ...baseMeta, valueId: expandedId }) };
            };

            const wrapOutput = (meta: TracedWrapper<any>["meta"], value: any): { done: false; value: TracedWrapper<any> } => {
              lastOutputMeta = meta;
              return { done: false, value: wrapTracedValue(value, meta) };
            };

            const isCollapseMetadata = (meta: any, value: any): meta is { kind: "collapse"; inputValueIds: string[]; valueId?: string } =>
              Array.isArray(value) &&
              meta?.kind === "collapse" &&
              Array.isArray(meta.inputValueIds) &&
              meta.inputValueIds.length > 0;

            const resolveTargetId = (meta: any): string | null => {
              const targetId = (typeof meta.valueId === "string" && meta.valueId) || meta.inputValueIds[meta.inputValueIds.length - 1];
              return typeof targetId === "string" ? targetId : null;
            };

            const rawSource: AsyncIterator<any> = {
              async next() {
                const r = await src.next();
                if (r.done) return r;

                const wrapped = isTracedValue(r.value)
                  ? (r.value as TracedWrapper<any>)
                  : wrapTracedValue(r.value, { valueId: generateValueId(), streamId, subscriptionId });

                inputQueue.push(wrapped);
                metaByValueId.set(wrapped.meta.valueId, wrapped.meta);
                lastSeenMeta = wrapped.meta;
                activeRequestBatch?.push(wrapped);

                setIteratorMeta(rawSource, wrapped.meta, i, opName);
                tracer.enterOperator(wrapped.meta.valueId, i, opName, wrapped.value);

                return { done: false, value: wrapped.value };
              },
              return: src.return?.bind(src),
              throw: src.throw?.bind(src),
            };

            const inner = op.apply(rawSource);

            return {
              async next() {
                try {
                  const requestBatch: TracedWrapper<any>[] = [];
                  activeRequestBatch = requestBatch;

                  let out: IteratorResult<any>;
                  try {
                    out = await inner.next();
                  } finally {
                    activeRequestBatch = null;
                  }

                  if (out.done) {
                    // Mark all pending values as filtered
                    inputQueue.forEach(w => tracer.exitOperator(w.meta.valueId, i, w.value, true));
                    inputQueue.length = 0;
                    return out;
                  }

                  const perValueMeta = getValueMeta(out.value);
                  const emittedValue = unwrapPrimitive(out.value);

                  // Array collapse: multiple inputs → array output
                  if (isCollapseMetadata(perValueMeta, emittedValue) && perValueMeta.inputValueIds.length > 1) {
                    const targetId = resolveTargetId(perValueMeta);
                    if (targetId) {
                      const result = handleCollapse(perValueMeta.inputValueIds, targetId, emittedValue);
                      if (result) return result;
                    }
                  }

                  // Runtime-provided output with expansion/filtering
                  if (perValueMeta?.kind === "expand" && perValueMeta.valueId && metaByValueId.has(perValueMeta.valueId)) {
                    const baseValueId = perValueMeta.valueId as string;
                    const baseMeta = metaByValueId.get(baseValueId)!;

                    // Filter detection: pass-through from one of multiple requests
                    if (requestBatch.length > 1) {
                      const baseRequested = requestBatch.find((w) => w.meta.valueId === baseValueId);
                      if (baseRequested && Object.is(emittedValue, baseRequested.value)) {
                        filterBatch(requestBatch, baseValueId);
                      }
                    }

                    return handleExpansion(baseValueId, baseMeta, emittedValue);
                  }

                  // Expansion: outputs without new input
                  if (requestBatch.length === 0) {
                    if (inputQueue.length > 0) {
                      // Prefer explicit per-value meta for collapse operators
                      if (isCollapseMetadata(perValueMeta, emittedValue)) {
                        const targetId = resolveTargetId(perValueMeta);
                        if (targetId) {
                          const result = handleCollapse(perValueMeta.inputValueIds, targetId, emittedValue);
                          if (result) return result;
                        }
                      }

                      const preferredId = perValueMeta?.valueId;
                      const chosen =
                        (preferredId ? inputQueue.find((w) => w.meta.valueId === preferredId) : undefined) ??
                        [...inputQueue].reverse().find((w) => Object.is(w.value, emittedValue)) ??
                        inputQueue[inputQueue.length - 1];

                      // Mark non-emitted values as filtered
                      for (const pending of [...inputQueue]) {
                        if (pending.meta.valueId === chosen.meta.valueId) continue;
                        exitAndRemove(pending.meta.valueId, pending.value, true);
                      }

                      exitAndRemove(chosen.meta.valueId, emittedValue, false, "transformed");
                      return wrapOutput(chosen.meta, emittedValue);
                    }

                    const baseValueId = perValueMeta?.valueId ?? lastOutputMeta?.valueId ?? lastSeenMeta?.valueId;
                    const baseMeta = baseValueId ? (metaByValueId.get(baseValueId) ?? lastOutputMeta ?? lastSeenMeta) : null;
                    
                    if (baseMeta) {
                      lastOutputMeta = baseMeta;
                      return handleExpansion(baseValueId!, baseMeta, emittedValue);
                    }
                  }

                  // Multiple inputs, one output
                  if (requestBatch.length > 1) {
                    const outputValueId = perValueMeta?.valueId ?? requestBatch[requestBatch.length - 1].meta.valueId;
                    const outputEntry = requestBatch.find((w) => w.meta.valueId === outputValueId) ?? requestBatch[requestBatch.length - 1];

                    const isPassThrough = requestBatch.some((w) => Object.is(w.value, emittedValue));
                    
                    if (isPassThrough) {
                      // Filter case: one input passed through, others filtered out
                      filterBatch(requestBatch, outputEntry.meta.valueId);
                      exitAndRemove(outputEntry.meta.valueId, emittedValue, false, "transformed");
                    } else {
                      // Collapse case: multiple inputs merged into new value
                      for (const item of requestBatch) {
                        if (item.meta.valueId !== outputEntry.meta.valueId) {
                          removeFromQueue(item.meta.valueId);
                          tracer.collapseValue(item.meta.valueId, i, opName, outputEntry.meta.valueId, emittedValue);
                        }
                      }
                      exitAndRemove(outputEntry.meta.valueId, emittedValue, false, "collapsed");
                    }
                    
                    return wrapOutput(outputEntry.meta, emittedValue);
                  }

                  // 1:1 transformation
                  if (requestBatch.length === 1) {
                    const wrapped = requestBatch[0];
                    exitAndRemove(wrapped.meta.valueId, emittedValue, false, "transformed");
                    return wrapOutput(wrapped.meta, emittedValue);
                  }

                  // Fallback: reuse last known metadata
                  const fallbackMeta = lastOutputMeta ?? lastSeenMeta;
                  if (fallbackMeta) return wrapOutput(fallbackMeta, emittedValue);

                  // Last resort: unwrapped value (metadata tracking lost)
                  return { done: false, value: emittedValue };
                } catch (err) {
                  // Report error on first pending input
                  if (inputQueue.length > 0) {
                    tracer.errorInOperator(inputQueue[0].meta.valueId, i, err as Error);
                  }
                  throw err;
                }
              },
              return: inner.return?.bind(inner),
              throw: inner.throw?.bind(inner),
              [Symbol.asyncIterator]() { return this; },
            };
          });
        }),

        final: (it) => ({
          async next() {
            const r = await it.next();
            if (!r.done) {
              if (isTracedValue(r.value)) {
                const wrapped = r.value as TracedWrapper<any>;
                tracer.markDelivered(wrapped.meta.valueId);
                return { done: false, value: unwrapPrimitive(wrapped.value) };
              }

              // Best-effort fallback for values not wrapped by the tracing runtime.
              const valueMeta = getValueMeta(r.value);
              if (valueMeta?.valueId) tracer.markDelivered(valueMeta.valueId);

              return { done: false, value: unwrapPrimitive(r.value) };
            }
            if (r.done) {
              tracer.completeSubscription(subscriptionId);
            }
            return r;
          },
          return: async (v) => {
            tracer.completeSubscription(subscriptionId);
            return it.return ? await it.return(v) : { done: true, value: v };
          },
          throw: async (e) => {
            tracer.completeSubscription(subscriptionId);
            if (it.throw) return await it.throw(e);
            throw e;
          },
        }),
      };
    },
  });
}

// Auto-install hooks when module is imported
installTracingHooks();