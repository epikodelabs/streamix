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
  | "delivered";

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
    reason: "filtered" | "collapsed" | "errored";
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

/* ============================================================================
 * TRACER IMPLEMENTATION
 * ========================================================================== */

/**
 * Creates a full-featured tracer that records operator steps and timings.
 *
 * Note: expanded child traces are still stored, but they do not emit `delivered`
 * events (to avoid over-counting a single logical input producing many outputs).
 */
export function createValueTracer(options: ValueTracerOptions = {}): ValueTracer {
  const traces = new Map<string, ValueTrace>();
  const subscribers: TracerEventHandlers[] = [];
  const subscriptionSubscribers = new Map<string, Set<TracerSubscriptionEventHandlers>>();
  const { maxTraces = 10000, onTraceUpdate } = options;

  const notify = (event: keyof TracerEventHandlers, trace: ValueTrace): void => {
    subscribers.forEach((s) => s[event]?.(trace));
    subscriptionSubscribers.get(trace.subscriptionId)?.forEach((s) => s[event]?.(trace));
  };

  return {
    subscribe: (h) => {
      subscribers.push(h);
      return () => { const i = subscribers.indexOf(h); if (i > -1) subscribers.splice(i, 1); };
    },
    observeSubscription: (id, h) => {
      if (!subscriptionSubscribers.has(id)) subscriptionSubscribers.set(id, new Set());
      subscriptionSubscribers.get(id)!.add(h);
      return () => { subscriptionSubscribers.get(id)?.delete(h); };
    },
    completeSubscription: (id) => {
      subscriptionSubscribers.get(id)?.forEach((s) => s.complete?.());
      subscriptionSubscribers.delete(id);
    },
    startTrace: (valueId, streamId, streamName, subscriptionId, value) => {
      const trace: ValueTrace = {
        valueId, streamId, streamName, subscriptionId,
        emittedAt: Date.now(), state: "emitted", sourceValue: value,
        operatorSteps: [], operatorDurations: new Map(),
      };
      traces.set(valueId, trace);
      if (traces.size > maxTraces) traces.delete(traces.keys().next().value!);
      onTraceUpdate?.(trace);
      return trace;
    },
    createExpandedTrace: (baseValueId, operatorIndex, operatorName, expandedValue) => {
      const base = traces.get(baseValueId);
      const valueId = generateValueId();
      const now = Date.now();

      if (base) {
        const baseStep = [...base.operatorSteps].reverse().find((step) => step.operatorIndex === operatorIndex);
        if (baseStep && baseStep.outcome !== "expanded") {
          baseStep.outcome = "expanded";
          if (base.state === "transformed") {
            base.state = "expanded";
          }
          onTraceUpdate?.(base, baseStep);
        }
      }

      const operatorSteps = base ? base.operatorSteps.map((s) => ({ ...s })) : [];
      const clonedStep = [...operatorSteps].reverse().find((step) => step.operatorIndex === operatorIndex);

      if (clonedStep) {
        clonedStep.exitedAt = clonedStep.exitedAt ?? now;
        clonedStep.outcome = "expanded";
        clonedStep.outputValue = expandedValue;
      } else {
        operatorSteps.push({
          operatorIndex,
          operatorName,
          enteredAt: now,
          exitedAt: now,
          outcome: "expanded",
          inputValue: base?.finalValue,
          outputValue: expandedValue,
        });
      }

      const trace: ValueTrace = {
        valueId,
        parentTraceId: baseValueId,
        streamId: base?.streamId ?? "unknown",
        streamName: base?.streamName,
        subscriptionId: base?.subscriptionId ?? "unknown",
        emittedAt: base?.emittedAt ?? now,
        state: "expanded",
        sourceValue: base ? base.sourceValue : expandedValue,
        finalValue: expandedValue,
        operatorSteps,
        operatorDurations: new Map(),
        expandedFrom: { operatorIndex, operatorName, baseValueId },
      };
      traces.set(valueId, trace);
      onTraceUpdate?.(trace);
      return valueId;
    },
    enterOperator: (vId, idx, name, val) => {
      const t = traces.get(vId);
      if (!t) return;
      const step: OperatorStep = { operatorIndex: idx, operatorName: name, enteredAt: Date.now(), inputValue: val };
      t.operatorSteps.push(step);
      onTraceUpdate?.(t, step);
    },
    exitOperator: (vId, idx, val, filtered = false, outcome = "transformed") => {
      const t = traces.get(vId);
      if (!t) return null;
      const s = t.operatorSteps.find((step) => step.operatorIndex === idx && !step.exitedAt);
      
      // If no step found, return null (for test "exitOperator returns null when no operator step exists")
      if (!s) return null;
      
      s.exitedAt = Date.now();
      s.outcome = filtered ? "filtered" : outcome;
      s.outputValue = val;
      
      t.state = filtered ? "filtered" : (outcome as ValueState);
      t.finalValue = val;
      
      if (t.operatorDurations) {
        t.operatorDurations.set(s.operatorName, s.exitedAt - s.enteredAt);
      }
      
      if (filtered) {
        t.droppedReason = { operatorIndex: idx, operatorName: s.operatorName, reason: "filtered" };
        notify("filtered", t);
      }
      onTraceUpdate?.(t, s);
      return vId;
    },
    collapseValue: (vId, idx, name, targetId, val) => {
      const t = traces.get(vId);
      if (!t) return;
      const s = t.operatorSteps.find((step) => step.operatorIndex === idx && !step.exitedAt);
      if (s) { 
        s.exitedAt = Date.now(); 
        s.outcome = "collapsed"; 
        s.outputValue = val; 
      }
      t.state = "collapsed";
      t.collapsedInto = { operatorIndex: idx, operatorName: name, targetValueId: targetId };
      t.droppedReason = { operatorIndex: idx, operatorName: name, reason: "collapsed" };
      notify("collapsed", t);
      onTraceUpdate?.(t);
    },
    errorInOperator: (vId, idx, err) => {
      const t = traces.get(vId);
      if (!t) return;
      const s = t.operatorSteps.find((step) => step.operatorIndex === idx && !step.exitedAt);
      if (s) { 
        s.exitedAt = Date.now(); 
        s.outcome = "errored"; 
        s.error = err; 
      }
      t.state = "errored";
      t.droppedReason = { 
        operatorIndex: idx, 
        operatorName: s?.operatorName ?? "unknown", 
        reason: "errored", 
        error: err 
      };
      notify("dropped", t);
      onTraceUpdate?.(t);
    },
    markDelivered: (vId) => {
      const t = traces.get(vId);
      if (!t) return;
      t.state = "delivered";
      t.deliveredAt = Date.now();
      t.totalDuration = t.deliveredAt - t.emittedAt;
      if (!t.expandedFrom) {
        notify("delivered", t);
      }
      onTraceUpdate?.(t);
    },
    getAllTraces: () => Array.from(traces.values()),
    getStats: () => ({ total: traces.size }),
    clear: () => { traces.clear(); subscriptionSubscribers.clear(); }
  };
}

/**
 * Creates a lightweight tracer that captures terminal states only.
 *
 * This tracer does not record `operatorSteps` (they remain empty arrays), but it
 * still reports `emitted`, `filtered`, `collapsed`, `errored`, and `delivered`
 * events so UIs can show high-level lifecycle information.
 */
export function createTerminalTracer(options: ValueTracerOptions = {}): ValueTracer {
  const traces = new Map<string, ValueTrace>();
  const subscribers: TracerEventHandlers[] = [];
  const subscriptionSubscribers = new Map<string, Set<TracerSubscriptionEventHandlers>>();

  const { maxTraces = 10000, onTraceUpdate } = options;

  const notify = (event: keyof TracerEventHandlers, trace: ValueTrace): void => {
    subscribers.forEach((s) => s[event]?.(trace));
    subscriptionSubscribers.get(trace.subscriptionId)?.forEach((s) => s[event]?.(trace));
  };

  return {
    subscribe: (h) => {
      subscribers.push(h);
      return () => { const i = subscribers.indexOf(h); if (i > -1) subscribers.splice(i, 1); };
    },
    observeSubscription: (id, h) => {
      if (!subscriptionSubscribers.has(id)) subscriptionSubscribers.set(id, new Set());
      subscriptionSubscribers.get(id)!.add(h);
      return () => { subscriptionSubscribers.get(id)?.delete(h); };
    },
    completeSubscription: (id) => {
      subscriptionSubscribers.get(id)?.forEach((s) => s.complete?.());
      subscriptionSubscribers.delete(id);
    },
    startTrace: (valueId, streamId, streamName, subscriptionId, value) => {
      const trace: ValueTrace = {
        valueId,
        streamId,
        streamName,
        subscriptionId,
        emittedAt: Date.now(),
        state: "emitted",
        sourceValue: value,
        operatorSteps: [],
        operatorDurations: new Map(),
      };
      traces.set(valueId, trace);
      if (traces.size > maxTraces) traces.delete(traces.keys().next().value!);
      onTraceUpdate?.(trace);
      return trace;
    },
    createExpandedTrace: (baseValueId, operatorIndex, operatorName, expandedValue) => {
      const base = traces.get(baseValueId);
      const valueId = generateValueId();
      const now = Date.now();
      const trace: ValueTrace = {
        valueId,
        parentTraceId: baseValueId,
        streamId: base?.streamId ?? "unknown",
        streamName: base?.streamName,
        subscriptionId: base?.subscriptionId ?? "unknown",
        emittedAt: base?.emittedAt ?? now,
        state: "expanded",
        sourceValue: base?.sourceValue ?? expandedValue,
        finalValue: expandedValue,
        operatorSteps: [],
        operatorDurations: new Map(),
        expandedFrom: { operatorIndex, operatorName, baseValueId },
      };
      traces.set(valueId, trace);
      onTraceUpdate?.(trace);
      return valueId;
    },
    enterOperator: () => {},
    exitOperator: (vId, idx, val, filtered = false, outcome = "transformed") => {
      const t = traces.get(vId);
      if (!t) return null;

      t.finalValue = val;

      if (filtered) {
        t.state = "filtered";
        t.droppedReason = { operatorIndex: idx, operatorName: `op${idx}`, reason: "filtered" };
        notify("filtered", t);
        onTraceUpdate?.(t);
        return vId;
      }

      t.state = outcome as ValueState;
      onTraceUpdate?.(t);
      return vId;
    },
    collapseValue: (vId, idx, name, targetId, outputValue) => {
      const t = traces.get(vId);
      if (!t) return;
      t.state = "collapsed";
      t.finalValue = outputValue;
      t.collapsedInto = { operatorIndex: idx, operatorName: name, targetValueId: targetId };
      t.droppedReason = { operatorIndex: idx, operatorName: name, reason: "collapsed" };
      notify("collapsed", t);
      onTraceUpdate?.(t);
    },
    errorInOperator: (vId, idx, err) => {
      const t = traces.get(vId);
      if (!t) return;
      t.state = "errored";
      t.droppedReason = { operatorIndex: idx, operatorName: `op${idx}`, reason: "errored", error: err };
      notify("dropped", t);
      onTraceUpdate?.(t);
    },
    markDelivered: (vId) => {
      const t = traces.get(vId);
      if (!t) return;
      t.state = "delivered";
      t.deliveredAt = Date.now();
      t.totalDuration = t.deliveredAt - t.emittedAt;
      if (!t.expandedFrom) {
        notify("delivered", t);
      }
      onTraceUpdate?.(t);
    },
    getAllTraces: () => Array.from(traces.values()),
    getStats: () => ({ total: traces.size }),
    clear: () => { traces.clear(); subscriptionSubscribers.clear(); }
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
          const expansionCountByKey = new Map<string, number>();

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
                    const count = expansionCountByKey.get(key) ?? 0;
                    expansionCountByKey.set(key, count + 1);

                    if (count === 0) {
                      lastOutputMeta = baseMeta;
                      tracer.exitOperator(baseValueId, i, out.value, false, "expanded");
                      return { done: false, value: wrapTracedValue(out.value, baseMeta) };
                    }

                    const expandedId = tracer.createExpandedTrace(baseValueId, i, opName, out.value);
                    lastOutputMeta = { ...baseMeta, valueId: expandedId };
                    return { done: false, value: wrapTracedValue(out.value, { ...baseMeta, valueId: expandedId }) };
                  }
                }

                // Collapse: one output is an array produced from multiple sequential inputs.
                if (Array.isArray(out.value)) {
                  const batchSize = out.value.length;
                  if (batchSize > 0 && inputQueue.length >= batchSize) {
                    const batch = inputQueue.splice(0, batchSize);
                    const target = batch[batch.length - 1];

                    for (let j = 0; j < batch.length - 1; j += 1) {
                      tracer.collapseValue(batch[j].meta.valueId, i, opName, target.meta.valueId, out.value);
                    }

                    tracer.exitOperator(target.meta.valueId, i, out.value, false, "collapsed");
                    lastOutputMeta = target.meta;
                    setIteratorMeta(this as any, target.meta, i, opName);
                    return { done: false, value: wrapTracedValue(out.value, target.meta) };
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
