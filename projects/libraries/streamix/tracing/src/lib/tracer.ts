/**
 * STREAMIX TRACING SYSTEM
 * * A comprehensive tracing system for Streamix reactive streams.
 * * Features:
 * - Tracks value lifecycle from emission to delivery.
 * - Supports filter / collapse / expand / error semantics.
 * - Preserves type safety by wrapping primitives.
 * - Provides public subscription API for observers.
 */

import { createOperator, registerRuntimeHooks } from "@epikodelabs/streamix";

/* ============================================================================
 * TYPES
 * ========================================================================== */

/** * Lifecycle state for a traced value. 
 */
export type ValueState =
  | "emitted"
  | "transformed"
  | "filtered"
  | "collapsed"
  | "expanded"
  | "errored"
  | "delivered";

/** * Outcome for an operator step. 
 */
export type OperatorOutcome =
  | "transformed"
  | "filtered"
  | "expanded"
  | "collapsed"
  | "errored";

/** * Operator execution metadata within a trace. 
 */
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

/** * Full trace record for a single value. 
 */
export interface ValueTrace {
  valueId: string;
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
    reason: "filtered" | "collapsed" | "errored";
    error?: Error;
  };

  collapsedInto?: {
    operatorIndex: number;
    operatorName: string;
    targetValueId: string;
  };

  totalDuration?: number;
  operatorDurations: Map<string, number>;
}

/* ============================================================================
 * ID GENERATION
 * ========================================================================== */

const IDS_KEY = "__STREAMIX_TRACE_IDS__";

/**
 * Retrieves the global counter for IDs.
 */
function getIds(): { value: number } {
  const g = globalThis as any;
  if (!g[IDS_KEY]) g[IDS_KEY] = { value: 0 };
  return g[IDS_KEY];
}

/** * Generates a unique trace value identifier. 
 */
export function generateValueId(): string {
  return `val_${++getIds().value}`;
}

/* ============================================================================
 * VALUE TRACER
 * ========================================================================== */

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
  maxTraces?: number;
  devMode?: boolean;
  onTraceUpdate?: (trace: ValueTrace, step?: OperatorStep) => void;
}

/** * Functional tracer API with state stored in a closure. 
 */
export interface ValueTracer {
  subscribe: (handlers: TracerEventHandlers) => () => void;
  observeSubscription: (
    subscriptionId: string,
    handlers: TracerSubscriptionEventHandlers
  ) => () => void;
  completeSubscription: (subscriptionId: string) => void;
  startTrace: (
    valueId: string,
    streamId: string,
    streamName: string | undefined,
    subscriptionId: string,
    value: any
  ) => ValueTrace;
  createExpandedTrace: (
    baseValueId: string,
    operatorIndex: number,
    operatorName: string,
    expandedValue: any
  ) => string;
  enterOperator: (
    valueId: string,
    operatorIndex: number,
    operatorName: string,
    inputValue: any
  ) => void;
  exitOperator: (
    valueId: string,
    operatorIndex: number,
    outputValue: any,
    filtered?: boolean,
    outcome?: OperatorOutcome
  ) => string | null;
  collapseValue: (
    valueId: string,
    operatorIndex: number,
    operatorName: string,
    targetValueId: string,
    outputValue?: any
  ) => void;
  errorInOperator: (valueId: string, operatorIndex: number, error: Error) => void;
  markDelivered: (valueId: string) => void;
  getAllTraces: () => ValueTrace[];
  getStats: () => { total: number };
  clear: () => void;
}

/**
 * Creates a new tracer instance with isolated internal state.
 */
export function createValueTracer(options: ValueTracerOptions = {}): ValueTracer {
  const traces = new Map<string, ValueTrace>();
  const subscribers: TracerEventHandlers[] = [];
  const subscriptionSubscribers = new Map<string, Set<TracerSubscriptionEventHandlers>>();

  const { maxTraces = 10000, onTraceUpdate } = options;

  const notifySubscribers = (event: keyof TracerEventHandlers, trace: ValueTrace) => {
    subscribers.forEach(s => s[event]?.(trace));
    subscriptionSubscribers.get(trace.subscriptionId)?.forEach(s => s[event]?.(trace));
  };

  return {
    subscribe: (handlers) => {
      subscribers.push(handlers);
      return () => {
        const idx = subscribers.indexOf(handlers);
        if (idx > -1) subscribers.splice(idx, 1);
      };
    },

    observeSubscription: (subscriptionId, handlers) => {
      if (!subscriptionSubscribers.has(subscriptionId)) {
        subscriptionSubscribers.set(subscriptionId, new Set());
      }
      subscriptionSubscribers.get(subscriptionId)!.add(handlers);
      return () => {
        subscriptionSubscribers.get(subscriptionId)?.delete(handlers);
      };
    },

    completeSubscription: (subscriptionId) => {
      const set = subscriptionSubscribers.get(subscriptionId);
      if (set) {
        set.forEach(s => s.complete?.());
        subscriptionSubscribers.delete(subscriptionId);
      }
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
        streamId: base?.streamId ?? "unknown",
        streamName: base?.streamName,
        subscriptionId: base?.subscriptionId ?? "unknown",
        emittedAt: base?.emittedAt ?? now,
        state: "expanded",
        sourceValue: base?.sourceValue ?? expandedValue,
        finalValue: expandedValue,
        operatorSteps: base ? [...base.operatorSteps.map(s => ({ ...s }))] : [],
        operatorDurations: new Map(base?.operatorDurations || []),
      };

      const step: OperatorStep = {
        operatorIndex,
        operatorName,
        enteredAt: now,
        exitedAt: now,
        outcome: "expanded",
        inputValue: base?.finalValue ?? base?.sourceValue,
        outputValue: expandedValue
      };

      trace.operatorSteps.push(step);
      traces.set(valueId, trace);
      onTraceUpdate?.(trace, step);
      return valueId;
    },

    enterOperator: (valueId, operatorIndex, operatorName, inputValue) => {
      const trace = traces.get(valueId);
      if (!trace) return;
      const step: OperatorStep = { operatorIndex, operatorName, enteredAt: Date.now(), inputValue };
      trace.operatorSteps.push(step);
      onTraceUpdate?.(trace, step);
    },

    exitOperator: (valueId, operatorIndex, outputValue, filtered = false, outcome = "transformed") => {
      const trace = traces.get(valueId);
      const step = trace?.operatorSteps.find(s => s.operatorIndex === operatorIndex && !s.exitedAt);
      if (!trace || !step) return null;

      step.exitedAt = Date.now();
      step.outcome = filtered ? "filtered" : outcome;
      step.outputValue = outputValue;
      
      trace.state = filtered ? "filtered" : "transformed";
      trace.finalValue = outputValue;
      trace.operatorDurations.set(step.operatorName, step.exitedAt - step.enteredAt);

      if (filtered) {
        trace.droppedReason = { operatorIndex, operatorName: step.operatorName, reason: "filtered" };
        notifySubscribers("filtered", trace);
      }
      onTraceUpdate?.(trace, step);
      return valueId;
    },

    collapseValue: (valueId, operatorIndex, operatorName, targetValueId, outputValue) => {
      const trace = traces.get(valueId);
      const step = trace?.operatorSteps.find(s => s.operatorIndex === operatorIndex && !s.exitedAt);
      if (!trace) return;

      if (step) {
        step.exitedAt = Date.now();
        step.outcome = "collapsed";
        step.outputValue = outputValue;
      }
      trace.state = "collapsed";
      trace.collapsedInto = { operatorIndex, operatorName, targetValueId };
      trace.droppedReason = { operatorIndex, operatorName, reason: "collapsed" };
      notifySubscribers("collapsed", trace);
    },

    errorInOperator: (valueId, operatorIndex, error) => {
      const trace = traces.get(valueId);
      const step = trace?.operatorSteps.find(s => s.operatorIndex === operatorIndex && !s.exitedAt);
      if (!trace) return;

      if (step) {
        step.exitedAt = Date.now();
        step.outcome = "errored";
        step.error = error;
      }
      trace.state = "errored";
      trace.droppedReason = { 
        operatorIndex, 
        operatorName: step?.operatorName ?? "unknown", 
        reason: "errored", 
        error 
      };
      notifySubscribers("dropped", trace);
    },

    markDelivered: (valueId) => {
      const trace = traces.get(valueId);
      if (!trace) return;
      trace.state = "delivered";
      trace.deliveredAt = Date.now();
      trace.totalDuration = trace.deliveredAt - trace.emittedAt;
      notifySubscribers("delivered", trace);
    },

    getAllTraces: () => Array.from(traces.values()),
    getStats: () => ({ total: traces.size }),
    clear: () => {
      traces.clear();
      subscriptionSubscribers.clear();
    }
  };
}

/* ============================================================================
 * RUNTIME INTERNALS & GLOBALS
 * ========================================================================== */

const tracedValueBrand = Symbol("__streamix_traced__");
const TRACER_KEY = "__STREAMIX_GLOBAL_TRACER__";

export interface TracedWrapper<T> {
  [tracedValueBrand]: true;
  value: T;
  meta: { valueId: string; streamId: string; subscriptionId: string; };
}

const wrap = <T>(value: T, meta: TracedWrapper<T>["meta"]): TracedWrapper<T> => 
  ({ [tracedValueBrand]: true, value, meta });

const unwrap = <T>(v: any): T => (v && v[tracedValueBrand]) ? v.value : v;

/** * Returns the current global tracer, if one is registered. 
 */
export const getGlobalTracer = (): ValueTracer | null => (globalThis as any)[TRACER_KEY] ?? null;

/** * Enables tracing by registering a global tracer instance. 
 */
export function enableTracing(tracer: ValueTracer): void {
  (globalThis as any)[TRACER_KEY] = tracer;
}

/** * Disables tracing by clearing the global tracer instance. 
 */
export function disableTracing(): void {
  (globalThis as any)[TRACER_KEY] = null;
}

/* ============================================================================
 * RUNTIME HOOK REGISTRATION
 * ========================================================================== */

registerRuntimeHooks({
  onPipeStream({ streamId, streamName, subscriptionId, source, operators }) {
    const tracer = getGlobalTracer();
    if (!tracer) return;

    return {
      source: {
        async next() {
          const r = await source.next();
          if (r.done) return r;
          const id = generateValueId();
          tracer.startTrace(id, streamId, streamName, subscriptionId, r.value);
          return { 
            done: false, 
            value: wrap(r.value, { valueId: id, streamId, subscriptionId }) 
          };
        },
        return: source.return?.bind(source),
        throw: source.throw?.bind(source),
      },

      operators: operators.map((op, i) => {
        const opName = op.name ?? `op${i}`;
        return createOperator(`traced_${opName}`, (src) => {
          const inputQueue: TracedWrapper<any>[] = [];
          let lastSeenMeta: TracedWrapper<any>["meta"] | null = null;

          const rawSource: AsyncIterator<any> = {
            async next() {
              const r = await src.next();
              if (r.done) return r;
              const wrapped = r.value as TracedWrapper<any>;
              inputQueue.push(wrapped);
              lastSeenMeta = wrapped.meta;
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
                const out = await inner.next();
                if (out.done) {
                  if (opName === "filter" && inputQueue.length > 0) {
                    while (inputQueue.length > 0) {
                      const filteredEntry = inputQueue.shift()!;
                      tracer.exitOperator(filteredEntry.meta.valueId, i, filteredEntry.value, true);
                    }
                  }
                  return out;
                }

                if (opName === "filter" && inputQueue.length > 1) {
                  while (inputQueue.length > 1) {
                    const filteredEntry = inputQueue.shift()!;
                    tracer.exitOperator(filteredEntry.meta.valueId, i, filteredEntry.value, true);
                  }
                }

                const entry = inputQueue.shift();
                
                // If the operator produces more outputs than inputs (expanded state)
                if (!entry && lastSeenMeta) {
                  const expandedId = tracer.createExpandedTrace(
                    lastSeenMeta.valueId, 
                    i, 
                    opName, 
                    out.value
                  );
                  return { 
                    done: false, 
                    value: wrap(out.value, { ...lastSeenMeta, valueId: expandedId }) 
                  };
                }

                // Default transformation
                if (entry) {
                  tracer.exitOperator(entry.meta.valueId, i, out.value);
                  return { done: false, value: wrap(out.value, entry.meta) };
                }

                return { done: false, value: out.value };
              } catch (e) {
                if (inputQueue.length > 0) {
                  tracer.errorInOperator(inputQueue[0].meta.valueId, i, e as Error);
                }
                throw e;
              }
            },
            return: inner.return?.bind(inner),
            throw: inner.throw?.bind(inner),
          };
        });
      }),

      final: it => ({
        async next() {
          const r = await it.next();
          if (!r.done) {
            tracer.markDelivered((r.value as TracedWrapper<any>).meta.valueId);
          } else {
            tracer.completeSubscription(subscriptionId);
          }
          return r.done ? r : { done: false, value: unwrap(r.value) };
        },
        async return(v) {
          tracer.completeSubscription(subscriptionId);
          return it.return ? await it.return(v) : { done: true, value: v };
        },
        async throw(e) {
          tracer.completeSubscription(subscriptionId);
          if (it.throw) return await it.throw(e);
          throw e;
        }
      })
    };
  }
});
