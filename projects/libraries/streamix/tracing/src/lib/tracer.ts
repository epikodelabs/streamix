/**
 * Streamix tracing system.
 *
 * This module instruments Streamix streams via runtime hooks so it can observe
 * values as they flow through operators, without modifying the operators
 * themselves.
 *
 * Operator behavior (filter/collapse/expand) is inferred from request/emission
 * patterns rather than operator names:
 * - Filter: an operator requests multiple inputs before emitting one output;
 *   skipped inputs are marked as `filtered`.
 * - Collapse: multiple inputs contribute to a single output; earlier inputs are
 *   marked as `collapsed` into the target input.
 * - Expand: an operator emits multiple outputs without requesting new input;
 *   additional outputs are modeled as `expanded` traces derived from the base.
 */
import {
  createOperator,
  getIteratorMeta,
  registerRuntimeHooks,
  setIteratorMeta
} from "@epikodelabs/streamix";

/* ============================================================================
 * TYPES
 * ========================================================================== */

/**
 * Lifecycle state for a traced value.
 *
 * A value starts at `emitted`, then proceeds through operator outcomes and
 * finally becomes `delivered` if it reaches the subscriber.
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

/** Outcome of a single operator step. */
export type OperatorOutcome =
  | "transformed"
  | "filtered"
  | "expanded"
  | "collapsed"
  | "errored";

/** One operator invocation for a single traced value. */
export interface OperatorStep {
  /** Operator position in the pipeline (0-based). */
  operatorIndex: number;
  /** Operator display name. */
  operatorName: string;
  /** Timestamp when the value entered the operator. */
  enteredAt: number;
  /** Timestamp when the operator produced an outcome for this value. */
  exitedAt?: number;
  /** The inferred outcome for this step. */
  outcome?: OperatorOutcome;
  /** The input value seen by the operator (unwrapped). */
  inputValue: any;
  /** The output value produced by the operator (unwrapped). */
  outputValue?: any;
  /** Error thrown by the operator, if any. */
  error?: Error;
}

/** Full trace record for a single valueId. */
export interface ValueTrace {
  /** Unique identifier for this trace. */
  valueId: string;
  /** Base trace id for expansions (children created from a single input). */
  parentTraceId?: string;
  /** Stream identifier provided by Streamix runtime. */
  streamId: string;
  /** Optional stream name provided by Streamix runtime. */
  streamName?: string;
  /** Subscription identifier provided by Streamix runtime. */
  subscriptionId: string;
  /** Timestamp when the value was emitted by the source. */
  emittedAt: number;
  /** Timestamp when the value was delivered to the subscriber. */
  deliveredAt?: number;
  /** Current lifecycle state. */
  state: ValueState;
  /** Raw value emitted by the source. */
  sourceValue: any;
  /** Latest value after the last completed operator step. */
  finalValue?: any;
  /** Operator steps recorded for this value. */
  operatorSteps: OperatorStep[];
  /** If the value was terminated early, why. */
  droppedReason?: {
    operatorIndex: number;
    operatorName: string;
    reason: "filtered" | "collapsed" | "errored" | "late";
    error?: Error;
  };
  /** Collapse linkage for values that were merged into a later value. */
  collapsedInto?: {
    operatorIndex: number;
    operatorName: string;
    targetValueId: string;
  };
  /** Expansion linkage for values created from a base value. */
  expandedFrom?: {
    operatorIndex: number;
    operatorName: string;
    baseValueId: string;
  };
  /** Total duration from emitted → delivered. */
  totalDuration?: number;
  /** Per-operator timing by operatorName. */
  operatorDurations: Map<string, number>;
}

/** Global subscriber callbacks for trace events. */
export type TracerEventHandlers = {
  delivered?: (trace: ValueTrace) => void;
  filtered?: (trace: ValueTrace) => void;
  collapsed?: (trace: ValueTrace) => void;
  dropped?: (trace: ValueTrace) => void;
};

export type TracerSubscriptionEventHandlers = TracerEventHandlers & {
  complete?: () => void;
};

export interface ValueTracerOptions {
  /** Maximum number of traces to retain in memory. */
  maxTraces?: number;
  devMode?: boolean;
  /** Called when a trace changes; `step` is provided for operator-step events. */
  onTraceUpdate?: (trace: ValueTrace, step?: OperatorStep) => void;
}

/* ============================================================================
 * INTERFACE & ID GEN
 * ========================================================================== */

export interface ValueTracer {
  /**
   * Subscribe to trace events across all subscriptions.
   * Returns an unsubscribe function.
   */
  subscribe: (handlers: TracerEventHandlers) => () => void;
  /**
   * Subscribe to trace events for a specific subscription id.
   * Returns an unsubscribe function.
   */
  observeSubscription: (subId: string, handlers: TracerSubscriptionEventHandlers) => () => void;
  /** Emits a complete event for per-subscription observers and clears them. */
  completeSubscription: (subId: string) => void;
  /** Creates and stores a new trace for an emitted value. */
  startTrace: (vId: string, sId: string, sName: string | undefined, subId: string, val: any) => ValueTrace;
  /** Creates a child trace representing an expanded output value. */
  createExpandedTrace: (baseId: string, opIdx: number, opName: string, val: any) => string;
  /** Marks operator entry for a value (records an operator step). */
  enterOperator: (vId: string, opIdx: number, opName: string, val: any) => void;
  /**
   * Marks operator exit for a value (finalizes the matching operator step).
   * Returns the valueId when successful, otherwise null.
   */
  exitOperator: (vId: string, opIdx: number, val: any, filtered?: boolean, outcome?: OperatorOutcome) => string | null;
  /** Marks a value as collapsed into a target value at an operator index. */
  collapseValue: (vId: string, opIdx: number, opName: string, targetId: string, val?: any) => void;
  /** Records an operator error for a value. */
  errorInOperator: (vId: string, opIdx: number, error: Error) => void;
  /** Marks a value as delivered to the subscriber. */
  markDelivered: (vId: string) => void;
  /** Returns all currently retained traces. */
  getAllTraces: () => ValueTrace[];
  /** Returns basic tracer stats. */
  getStats: () => { total: number };
  /** Clears all in-memory traces and observers. */
  clear: () => void;
}

const IDS_KEY = "__STREAMIX_TRACE_IDS__";
function getIds(): { value: number } {
  const g = globalThis as any;
  if (!g[IDS_KEY]) g[IDS_KEY] = { value: 0 };
  return g[IDS_KEY];
}

/** Generates a globally unique value id (`val_1`, `val_2`, ...). */
export function generateValueId(): string {
  return `val_${++getIds().value}`;
}

type SubscriptionState = "active" | "completed" | "errored";

type DropReason = "filtered" | "collapsed" | "errored" | "late";

export const isAfterComplete = (state?: SubscriptionState) =>
  state === "completed";

/* ============================================================================
 * TRACER IMPLEMENTATION
 * ========================================================================== */

/**
 * Creates a full-featured tracer that records operator steps and timings.
 *
 * Note: expanded child traces are still stored, but they do not emit `delivered`
 * events (to avoid over-counting a single logical input producing many outputs).
 */
export function createValueTracer(
  options: ValueTracerOptions = {}
): ValueTracer {
  const {
    maxTraces = 10_000,
    onTraceUpdate,
  } = options;

  /** Insertion order = chronological order */
  const traces = new Map<string, ValueTrace>();

  const subscribers: TracerEventHandlers[] = [];
  const subscriptionSubscribers = new Map<
    string,
    Set<TracerSubscriptionEventHandlers>
  >();
  const subscriptionStates = new Map<string, SubscriptionState>();

  const isCompleted = (subId: string) =>
    subscriptionStates.get(subId) === "completed";

  const notify = (event: keyof TracerEventHandlers, trace: ValueTrace) => {
    subscribers.forEach((s) => s[event]?.(trace));
    subscriptionSubscribers.get(trace.subscriptionId)?.forEach((s) =>
      s[event]?.(trace)
    );
  };

  const retain = (valueId: string, trace: ValueTrace) => {
    traces.set(valueId, trace);
    if (traces.size > maxTraces) {
      const oldestKey = traces.keys().next().value;
      if (oldestKey !== undefined) traces.delete(oldestKey);
    }
  };

  const drop = (
    trace: ValueTrace,
    operatorIndex: number,
    operatorName: string,
    reason: DropReason,
    error?: Error
  ) => {
    trace.state = "dropped" as ValueState;
    trace.droppedReason = {
      operatorIndex,
      operatorName,
      reason: reason as any,
      error,
    };
    notify("dropped", trace);
    onTraceUpdate?.(trace);
  };

  return {
    /* ------------------------------------------------------------ */
    /* subscriptions                                                 */
    /* ------------------------------------------------------------ */

    subscribe(h) {
      subscribers.push(h);
      return () => {
        const i = subscribers.indexOf(h);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },

    observeSubscription(id, h) {
      if (!subscriptionSubscribers.has(id)) {
        subscriptionSubscribers.set(id, new Set());
      }
      subscriptionSubscribers.get(id)!.add(h);
      return () => subscriptionSubscribers.get(id)?.delete(h);
    },

    completeSubscription(subId) {
      if (subscriptionStates.get(subId) === "completed") return;
      subscriptionStates.set(subId, "completed");
      subscriptionSubscribers.get(subId)?.forEach((s) => s.complete?.());
      subscriptionSubscribers.delete(subId);
    },

    /* ------------------------------------------------------------ */
    /* trace creation                                                */
    /* ------------------------------------------------------------ */

    startTrace(valueId, streamId, streamName, subId, value) {
      if (!subscriptionStates.has(subId)) {
        subscriptionStates.set(subId, "active");
      }

      const trace: ValueTrace = {
        valueId,
        streamId,
        streamName,
        subscriptionId: subId,
        emittedAt: Date.now(),
        state: "emitted",
        sourceValue: value,
        operatorSteps: [],
        operatorDurations: new Map(),
      };

      retain(valueId, trace);

      if (isCompleted(subId)) {
        drop(trace, -1, "subscription", "late");
      } else {
        onTraceUpdate?.(trace);
      }

      return trace;
    },

    createExpandedTrace(baseId, opIdx, opName, value) {
      const base = traces.get(baseId);
      const valueId = generateValueId();

      if (!base || isCompleted(base.subscriptionId)) {
        const trace: ValueTrace = {
          valueId,
          parentTraceId: baseId,
          streamId: base?.streamId ?? "unknown",
          streamName: base?.streamName,
          subscriptionId: base?.subscriptionId ?? "unknown",
          emittedAt: Date.now(),
          state: "dropped" as ValueState,
          sourceValue: value,
          operatorSteps: [],
          operatorDurations: new Map(),
          droppedReason: {
            operatorIndex: opIdx,
            operatorName: opName,
            reason: "late",
          },
        };
        retain(valueId, trace);
        notify("dropped", trace);
        onTraceUpdate?.(trace);
        return valueId;
      }

      const trace: ValueTrace = {
        valueId,
        parentTraceId: baseId,
        streamId: base.streamId,
        streamName: base.streamName,
        subscriptionId: base.subscriptionId,
        emittedAt: base.emittedAt,
        state: "expanded",
        sourceValue: base.sourceValue,
        finalValue: value,
        operatorSteps: base.operatorSteps.map((s) => ({ ...s })),
        operatorDurations: new Map(),
        expandedFrom: {
          operatorIndex: opIdx,
          operatorName: opName,
          baseValueId: baseId,
        },
      };

      retain(valueId, trace);
      onTraceUpdate?.(trace);
      return valueId;
    },

    /* ------------------------------------------------------------ */
    /* operator lifecycle                                            */
    /* ------------------------------------------------------------ */

    enterOperator(vId, idx, name, val) {
      const t = traces.get(vId);
      if (!t || isCompleted(t.subscriptionId)) return;

      t.operatorSteps.push({
        operatorIndex: idx,
        operatorName: name,
        enteredAt: Date.now(),
        inputValue: val,
      });

      onTraceUpdate?.(t);
    },

    exitOperator(vId, idx, val, filtered = false, outcome = "transformed") {
      const t = traces.get(vId);
      if (!t) return null;

      if (isCompleted(t.subscriptionId)) {
        drop(
          t,
          idx,
          t.operatorSteps.find((s) => s.operatorIndex === idx)?.operatorName ??
            `op${idx}`,
          "late"
        );
        return null;
      }

      const step = t.operatorSteps.find(
        (s) => s.operatorIndex === idx && !s.exitedAt
      );
      if (!step) return null;

      step.exitedAt = Date.now();
      step.outcome = filtered ? "filtered" : (outcome as any);
      step.outputValue = val;

      t.finalValue = val;
      t.state = filtered ? "filtered" : (outcome as ValueState);

      if (filtered) {
        t.droppedReason = {
          operatorIndex: idx,
          operatorName: step.operatorName,
          reason: "filtered",
        };
        notify("filtered", t);
      }

      onTraceUpdate?.(t, step);
      return vId;
    },

    collapseValue(vId, idx, name, targetId, _) {
      const t = traces.get(vId);
      if (!t) return;

      if (isCompleted(t.subscriptionId)) {
        drop(t, idx, name, "late");
        return;
      }

      t.state = "collapsed";
      t.collapsedInto = {
        operatorIndex: idx,
        operatorName: name,
        targetValueId: targetId,
      };
      t.droppedReason = {
        operatorIndex: idx,
        operatorName: name,
        reason: "collapsed",
      };

      notify("collapsed", t);
      onTraceUpdate?.(t);
    },

    errorInOperator(vId, idx, err) {
      const t = traces.get(vId);
      if (!t) return;

      t.state = "errored";
      t.droppedReason = {
        operatorIndex: idx,
        operatorName:
          t.operatorSteps.find((s) => s.operatorIndex === idx)?.operatorName ??
          `op${idx}`,
        reason: "errored",
        error: err,
      };

      notify("dropped", t);
      onTraceUpdate?.(t);
    },

    /* ------------------------------------------------------------ */
    /* delivery                                                      */
    /* ------------------------------------------------------------ */

    markDelivered(vId) {
      const t = traces.get(vId);
      if (!t || isCompleted(t.subscriptionId)) return;

      t.state = "delivered";
      t.deliveredAt = Date.now();
      t.totalDuration = t.deliveredAt - t.emittedAt;
      notify("delivered", t);
      onTraceUpdate?.(t);
    },

    /* ------------------------------------------------------------ */

    getAllTraces: () => Array.from(traces.values()),
    getStats: () => ({ total: traces.size }),
    clear() {
      traces.clear();
      subscriptionSubscribers.clear();
      subscriptionStates.clear();
    },
  };
}

/**
 * Creates a lightweight tracer that captures terminal states only.
 *
 * This tracer does not record `operatorSteps` (they remain empty arrays), but it
 * still reports `emitted`, `filtered`, `collapsed`, `errored`, and `delivered`
 * events so UIs can show high-level lifecycle information.
 */
export function createTerminalTracer(
  options: ValueTracerOptions = {}
): ValueTracer {
  const {
    maxTraces = 10_000,
    onTraceUpdate,
  } = options;

  const traces = new Map<string, ValueTrace>();
  const subscribers: TracerEventHandlers[] = [];
  const subscriptionSubscribers = new Map<
    string,
    Set<TracerSubscriptionEventHandlers>
  >();
  const subscriptionStates = new Map<string, SubscriptionState>();

  const isCompleted = (id: string) =>
    subscriptionStates.get(id) === "completed";

  const notify = (event: keyof TracerEventHandlers, trace: ValueTrace) => {
    subscribers.forEach((s) => s[event]?.(trace));
    subscriptionSubscribers.get(trace.subscriptionId)?.forEach((s) =>
      s[event]?.(trace)
    );
  };

  const retain = (id: string, trace: ValueTrace) => {
    traces.set(id, trace);
    if (traces.size > maxTraces) {
      const oldestKey = traces.keys().next().value;
      if (oldestKey !== undefined) traces.delete(oldestKey);
    }
  };

  return {
    subscribe(h) {
      subscribers.push(h);
      return () => subscribers.splice(subscribers.indexOf(h), 1);
    },

    observeSubscription(id, h) {
      if (!subscriptionSubscribers.has(id)) {
        subscriptionSubscribers.set(id, new Set());
      }
      subscriptionSubscribers.get(id)!.add(h);
      return () => subscriptionSubscribers.get(id)?.delete(h);
    },

    completeSubscription(id) {
      subscriptionStates.set(id, "completed");
      subscriptionSubscribers.get(id)?.forEach((s) => s.complete?.());
      subscriptionSubscribers.delete(id);
    },

    startTrace(valueId, streamId, streamName, subId, value) {
      if (!subscriptionStates.has(subId)) {
        subscriptionStates.set(subId, "active");
      }

      const dropped = isCompleted(subId);

      const trace: ValueTrace = {
        valueId,
        streamId,
        streamName,
        subscriptionId: subId,
        emittedAt: Date.now(),
        state: dropped ? ("dropped" as ValueState) : "emitted",
        sourceValue: value,
        operatorSteps: [],
        operatorDurations: new Map(),
      };

      if (dropped) {
        trace.droppedReason = {
          operatorIndex: -1,
          operatorName: "subscription",
          reason: "late",
        };
        notify("dropped", trace);
      }

      retain(valueId, trace);
      onTraceUpdate?.(trace);
      return trace;
    },

    createExpandedTrace(baseId, idx, name, value) {
      const base = traces.get(baseId);
      const valueId = generateValueId();
      const subId = base?.subscriptionId ?? "unknown";
      const dropped = isCompleted(subId);

      const trace: ValueTrace = {
        valueId,
        parentTraceId: baseId,
        streamId: base?.streamId ?? "unknown",
        streamName: base?.streamName,
        subscriptionId: subId,
        emittedAt: Date.now(),
        state: dropped ? ("dropped" as ValueState) : "expanded",
        sourceValue: value,
        operatorSteps: [],
        operatorDurations: new Map(),
      };

      if (dropped) {
        trace.droppedReason = {
          operatorIndex: idx,
          operatorName: name,
          reason: "late",
        };
        notify("dropped", trace);
      }

      retain(valueId, trace);
      onTraceUpdate?.(trace);
      return valueId;
    },

    enterOperator() {},
    exitOperator() { return null; },
    collapseValue() {},
    errorInOperator() {},

    markDelivered(vId) {
      const t = traces.get(vId);
      if (!t || isCompleted(t.subscriptionId)) return;
      t.state = "delivered";
      notify("delivered", t);
      onTraceUpdate?.(t);
    },

    getAllTraces: () => Array.from(traces.values()),
    getStats: () => ({ total: traces.size }),
    clear() {
      traces.clear();
      subscriptionSubscribers.clear();
      subscriptionStates.clear();
    },
  };
}



/* ============================================================================
 * RUNTIME INTERNALS
 * ========================================================================== */

const tracedValueBrand = Symbol("__streamix_traced__");
const TRACER_KEY = "__STREAMIX_GLOBAL_TRACER__";

export interface TracedWrapper<T> {
  [tracedValueBrand]: true;
  value: T;
  meta: { valueId: string; streamId: string; subscriptionId: string };
}

/** Wraps a runtime value with tracing metadata. */
export const wrapTracedValue = <T>(value: T, meta: TracedWrapper<T>["meta"]): TracedWrapper<T> =>
  ({ [tracedValueBrand]: true, value, meta });
/** Unwraps a runtime traced value (returns the raw value). */
export const unwrapTracedValue = <T>(v: any): T => (v && v[tracedValueBrand]) ? v.value : v;
/** Type guard for traced wrappers. */
export const isTracedValue = (v: any): v is TracedWrapper<any> => !!(v && v[tracedValueBrand]);
/** Returns the trace valueId for a traced wrapper. */
export const getValueId = (v: any): string | undefined => isTracedValue(v) ? v.meta.valueId : undefined;
/** Returns the current global tracer instance (if tracing is enabled). */
export const getGlobalTracer = (): ValueTracer | null => (globalThis as any)[TRACER_KEY] ?? null;
/** Enables tracing for all streams by setting the global tracer. */
export function enableTracing(t: ValueTracer): void { (globalThis as any)[TRACER_KEY] = t; }
/** Disables tracing for all streams by clearing the global tracer. */
export function disableTracing(): void { (globalThis as any)[TRACER_KEY] = null; }

/* ============================================================================
 * RUNTIME HOOKS - FIXED VERSION 2
 * ========================================================================== */

registerRuntimeHooks({
  onPipeStream({ streamId, streamName, subscriptionId, parentValueId, source, operators }) {
    const tracer = getGlobalTracer();
    if (!tracer) return;

    return {
      source: {
        /**
         * Wraps source emissions into `TracedWrapper` values and starts new traces.
         * If we are in an inner stream (parentValueId is present), the parent id is reused.
         */
        async next() {
          const r = await source.next();
          if (r.done) return r;
          
          let valueId: string;
          let value: any;
          
          if (isTracedValue(r.value)) {
            // Already wrapped from parent stream
            const wrapped = r.value as TracedWrapper<any>;
            valueId = wrapped.meta.valueId;
            value = wrapped.value;
          } else {
            // New value from source
            value = r.value;
            valueId = parentValueId || generateValueId();
            if (!parentValueId) {
              tracer.startTrace(valueId, streamId, streamName, subscriptionId, value);
            }
          }
          
          return { 
            done: false, 
            value: wrapTracedValue(value, { valueId, streamId, subscriptionId }) 
          };
        },
        return: source.return?.bind(source),
        throw: source.throw?.bind(source),
      },
      
      operators: operators.map((op, i) => {
        const opName = op.name ?? `op${i}`;
        
        return createOperator(`traced_${opName}`, (src) => {
          /**
           * Inputs observed by this operator in arrival order.
           * This is used to infer filtering (skipped inputs) and collapsing (multi-input → one output).
           */
          const inputQueue: TracedWrapper<any>[] = [];
          const metaByValueId = new Map<string, TracedWrapper<any>["meta"]>();
          let lastSeenMeta: TracedWrapper<any>["meta"] | null = null;
          let lastOutputMeta: TracedWrapper<any>["meta"] | null = null;

          /**
           * During a single `inner.next()` call we track which inputs were requested.
           * This lets us reason about:
           * - "how many requests were made before an output"
           * - "how many outputs occur without requesting new input"
           */
          let activeRequestBatch: TracedWrapper<any>[] | null = null;
          const outputCountByBaseKey = new Map<string, number>();

          const removeFromQueue = (valueId: string) => {
            const idx = inputQueue.findIndex((w) => w.meta.valueId === valueId);
            if (idx > -1) inputQueue.splice(idx, 1);
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
               
              // Set metadata on the source iterator
              setIteratorMeta(rawSource, wrapped.meta, i, opName);
               
              // Enter the operator
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
                  while (inputQueue.length > 0) {
                    const wrapped = inputQueue.shift()!;
                    tracer.exitOperator(wrapped.meta.valueId, i, wrapped.value, true);
                  }
                  return out;
                }
                 
                // Get metadata from the inner iterator if available
                const outputMeta = getIteratorMeta(inner as any) as any;
                if (outputMeta?.valueId) {
                  setIteratorMeta(this as any, { valueId: outputMeta.valueId }, outputMeta.operatorIndex, outputMeta.operatorName);
                }

                // Collapse: one output is an array produced from multiple sequential inputs.
                //
                // Tightened rule: only treat an array output as a collapse when the operator
                // requested exactly that many inputs during the same `inner.next()` call.
                // This avoids misclassifying "array-valued" streams (e.g. `map(() => [1,2,3])`)
                // as collapses.
                if (Array.isArray(out.value) && requestBatch.length > 1) {
                  const batchSize = out.value.length;
                  if (batchSize > 0 && requestBatch.length === batchSize) {
                    const batch = requestBatch;
                    const target = batch[batch.length - 1];

                    for (let j = 0; j < batch.length - 1; j += 1) {
                      removeFromQueue(batch[j].meta.valueId);
                      tracer.collapseValue(batch[j].meta.valueId, i, opName, target.meta.valueId, out.value);
                    }

                    removeFromQueue(target.meta.valueId);
                    tracer.exitOperator(target.meta.valueId, i, out.value, false, "collapsed");
                    lastOutputMeta = target.meta;
                    setIteratorMeta(this as any, target.meta, i, opName);
                    return { done: false, value: wrapTracedValue(out.value, target.meta) };
                  }
                }

                // If the runtime provides a valueId for the output, prefer it as the base attribution.
                // This is critical for flattening operators that may interleave input requests while
                // still emitting outputs for a previous base value.
                if (outputMeta?.valueId && metaByValueId.has(outputMeta.valueId)) {
                  const baseValueId = outputMeta.valueId as string;
                  const baseMeta = metaByValueId.get(baseValueId)!;

                  // Filter: multiple requests, pass-through output from one of them.
                  if (requestBatch.length > 1) {
                    const baseRequested = requestBatch.find((w) => w.meta.valueId === baseValueId);
                    const isPassThrough = baseRequested ? Object.is(out.value, baseRequested.value) : false;

                    if (isPassThrough) {
                      for (const requested of requestBatch) {
                        if (requested.meta.valueId === baseValueId) continue;
                        removeFromQueue(requested.meta.valueId);
                        tracer.exitOperator(requested.meta.valueId, i, requested.value, true);
                      }
                    }
                  }

                  const key = `${baseValueId}:${i}`;
                  const count = outputCountByBaseKey.get(key) ?? 0;
                  outputCountByBaseKey.set(key, count + 1);

                  if (count === 0) {
                    removeFromQueue(baseValueId);

                    tracer.exitOperator(
                      baseValueId,
                      i,
                      out.value,
                      false,
                      "expanded" // ← ALWAYS expanded for flattening
                    );

                    // Anchor attribution to the base input
                    lastOutputMeta = baseMeta;
                    setIteratorMeta(this as any, baseMeta, i, opName);

                    return {
                      done: false,
                      value: wrapTracedValue(out.value, baseMeta),
                    };
                  }

                  const expandedId = tracer.createExpandedTrace(baseValueId, i, opName, out.value);
                  // Anchor `lastOutputMeta` to the base input so subsequent outputs don't re-base on a child id.
                  lastOutputMeta = baseMeta;
                  return { done: false, value: wrapTracedValue(out.value, { ...baseMeta, valueId: expandedId }) };
                }

                // Expansion: additional outputs without requesting new input.
                if (requestBatch.length === 0) {
                  const baseValueId: string | undefined =
                    outputMeta?.valueId ?? lastOutputMeta?.valueId ?? lastSeenMeta?.valueId ?? undefined;

                  const baseMeta =
                    (baseValueId ? metaByValueId.get(baseValueId) : undefined) ??
                    lastOutputMeta ??
                    lastSeenMeta ??
                    null;

                  if (baseValueId && baseMeta) {
                    const key = `${baseValueId}:${i}`;
                    const count = outputCountByBaseKey.get(key) ?? 0;
                    outputCountByBaseKey.set(key, count + 1);

                    if (count === 0) {
                      lastOutputMeta = baseMeta;
                      tracer.exitOperator(baseValueId, i, out.value, false, "expanded");
                      return { done: false, value: wrapTracedValue(out.value, baseMeta) };
                    }

                    const expandedId = tracer.createExpandedTrace(baseValueId, i, opName, out.value);
                    // Keep `lastOutputMeta` anchored to the base input so subsequent emissions
                    // for the same expansion series do not accidentally re-base on a child id.
                    lastOutputMeta = baseMeta;
                    return { done: false, value: wrapTracedValue(out.value, { ...baseMeta, valueId: expandedId }) };
                  }
                }

                // Filter vs collapse: multiple inputs requested before emitting one output.
                if (requestBatch.length > 1) {
                  const outputValueId: string = outputMeta?.valueId ?? requestBatch[requestBatch.length - 1].meta.valueId;
                  const outputEntry =
                    requestBatch.find((w) => w.meta.valueId === outputValueId) ?? requestBatch[requestBatch.length - 1];

                  const isPassThrough = Object.is(out.value, outputEntry.value);

                  if (isPassThrough) {
                    for (const requested of requestBatch) {
                      if (requested.meta.valueId === outputEntry.meta.valueId) continue;
                      removeFromQueue(requested.meta.valueId);
                      tracer.exitOperator(requested.meta.valueId, i, requested.value, true);
                    }

                    removeFromQueue(outputEntry.meta.valueId);
                    tracer.exitOperator(outputEntry.meta.valueId, i, out.value);
                    lastOutputMeta = outputEntry.meta;
                    return { done: false, value: wrapTracedValue(out.value, outputEntry.meta) };
                  }

                  for (const requested of requestBatch) {
                    if (requested.meta.valueId === outputEntry.meta.valueId) continue;
                    removeFromQueue(requested.meta.valueId);
                    tracer.collapseValue(requested.meta.valueId, i, opName, outputEntry.meta.valueId, out.value);
                  }

                  removeFromQueue(outputEntry.meta.valueId);
                  tracer.exitOperator(outputEntry.meta.valueId, i, out.value, false, "collapsed");
                  lastOutputMeta = outputEntry.meta;
                  setIteratorMeta(this as any, outputEntry.meta, i, opName);
                  return { done: false, value: wrapTracedValue(out.value, outputEntry.meta) };
                }

                // Regular 1:1 transformation.
                if (requestBatch.length === 1) {
                  const wrapped = requestBatch[0];
                  removeFromQueue(wrapped.meta.valueId);
                  tracer.exitOperator(wrapped.meta.valueId, i, out.value);
                  lastOutputMeta = wrapped.meta;
                  return { done: false, value: wrapTracedValue(out.value, wrapped.meta) };
                }

                if (lastOutputMeta) {
                  return { done: false, value: wrapTracedValue(out.value, lastOutputMeta) };
                }

                return { done: false, value: out.value };
                 
               } catch (e) {
                // Mark error on the first pending value
                if (inputQueue.length > 0) {
                  tracer.errorInOperator(inputQueue[0].meta.valueId, i, e as Error);
                }
                throw e;
              }
            },
            
            return: inner.return?.bind(inner),
            throw: inner.throw?.bind(inner),
            [Symbol.asyncIterator]() { return this; }
          };
        });
      }),
      
      final: (it) => ({
        async next() {
          const r = await it.next();
          if (!r.done && isTracedValue(r.value)) {
            const wrapped = r.value as TracedWrapper<any>;
            tracer.markDelivered(wrapped.meta.valueId);
            return { done: false, value: unwrapTracedValue(r.value) };
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
        }
      })
    };
  }
});
