/**
 * STREAMIX TRACING SYSTEM – COMPLETE IMPLEMENTATION
 *
 * A comprehensive tracing system for Streamix reactive streams.
 *
 * Features:
 * - Tracks value lifecycle from emission → delivery
 * - Supports filter / collapse / expand / error semantics
 * - Preserves type safety by wrapping primitives
 * - Provides public subscription API for observers (tests, trackers)
 * - Integrates via Streamix runtime hooks
 */

import { createOperator, registerRuntimeHooks } from "@actioncrew/streamix";

/* ============================================================================
 * TYPES
 * ========================================================================== */

export type ValueState =
  | "emitted"
  | "processing"
  | "transformed"
  | "filtered"
  | "collapsed"
  | "errored"
  | "delivered";

export type OperatorOutcome =
  | "transformed"
  | "filtered"
  | "expanded"
  | "collapsed"
  | "errored";

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

type TraceIds = { value: number };

function getIds(): TraceIds {
  const g = globalThis as any;
  if (!g[IDS_KEY]) g[IDS_KEY] = { value: 0 };
  return g[IDS_KEY];
}

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

export class ValueTracer {
  private traces = new Map<string, ValueTrace>();
  private active = new Set<string>();
  private maxTraces: number;

  // internal callbacks
  private onValueEmitted?: (trace: ValueTrace) => void;
  private onValueProcessing?: (trace: ValueTrace, step: OperatorStep) => void;
  private onValueTransformed?: (trace: ValueTrace, step: OperatorStep) => void;
  private onValueFiltered?: (trace: ValueTrace, step: OperatorStep) => void;
  private onValueCollapsed?: (trace: ValueTrace, step: OperatorStep) => void;
  private onValueDelivered?: (trace: ValueTrace) => void;
  private onValueDropped?: (trace: ValueTrace) => void;

  constructor(options: {
    maxTraces?: number;
    onValueEmitted?: (trace: ValueTrace) => void;
    onValueProcessing?: (trace: ValueTrace, step: OperatorStep) => void;
    onValueTransformed?: (trace: ValueTrace, step: OperatorStep) => void;
    onValueFiltered?: (trace: ValueTrace, step: OperatorStep) => void;
    onValueCollapsed?: (trace: ValueTrace, step: OperatorStep) => void;
    onValueDelivered?: (trace: ValueTrace) => void;
    onValueDropped?: (trace: ValueTrace) => void;
  } = {}) {
    this.maxTraces = options.maxTraces ?? 10_000;
    Object.assign(this, options);
  }

  /* ------------------------------------------------------------------------
   * PUBLIC EVENT SUBSCRIPTION API
   * ---------------------------------------------------------------------- */

  subscribe(handlers: TracerEventHandlers): () => void {
    const prev = {
      delivered: this.onValueDelivered,
      filtered: this.onValueFiltered,
      collapsed: this.onValueCollapsed,
      dropped: this.onValueDropped,
    };

    if (handlers.delivered) {
      this.onValueDelivered = t => {
        prev.delivered?.(t);
        handlers.delivered!(t);
      };
    }

    if (handlers.filtered) {
      this.onValueFiltered = (t, s) => {
        prev.filtered?.(t, s);
        handlers.filtered!(t);
      };
    }

    if (handlers.collapsed) {
      this.onValueCollapsed = (t, s) => {
        prev.collapsed?.(t, s);
        handlers.collapsed!(t);
      };
    }

    if (handlers.dropped) {
      this.onValueDropped = t => {
        prev.dropped?.(t);
        handlers.dropped!(t);
      };
    }

    return () => {
      this.onValueDelivered = prev.delivered;
      this.onValueFiltered = prev.filtered;
      this.onValueCollapsed = prev.collapsed;
      this.onValueDropped = prev.dropped;
    };
  }

  /* ------------------------------------------------------------------------
   * TRACE LIFECYCLE
   * ---------------------------------------------------------------------- */

  startTrace(
    valueId: string,
    streamId: string,
    streamName: string | undefined,
    subscriptionId: string,
    value: any
  ): ValueTrace {
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

    this.traces.set(valueId, trace);
    this.active.add(valueId);

    if (this.traces.size > this.maxTraces) {
      const oldest = this.traces.keys().next().value;
      if (oldest) {
        this.traces.delete(oldest);
        this.active.delete(oldest);
      }
    }

    this.onValueEmitted?.(trace);
    return trace;
  }

  enterOperator(
    valueId: string,
    operatorIndex: number,
    operatorName: string,
    inputValue: any
  ) {
    const trace = this.traces.get(valueId);
    if (!trace) return;

    trace.state = "processing";

    const step: OperatorStep = {
      operatorIndex,
      operatorName,
      enteredAt: Date.now(),
      inputValue,
    };

    trace.operatorSteps.push(step);
    this.onValueProcessing?.(trace, step);
  }

  exitOperator(
    valueId: string,
    operatorIndex: number,
    outputValue: any,
    filtered = false,
    outcome: OperatorOutcome = "transformed"
  ): string | null {
    const trace = this.traces.get(valueId);
    if (!trace) return null;

    const step = trace.operatorSteps.find(
      s => s.operatorIndex === operatorIndex && !s.exitedAt
    );
    if (!step) return null;

    step.exitedAt = Date.now();
    step.outcome = filtered ? "filtered" : outcome;
    step.outputValue = outputValue;

    trace.operatorDurations.set(
      step.operatorName,
      step.exitedAt - step.enteredAt
    );

    if (filtered) {
      trace.state = "filtered";
      trace.droppedReason = {
        operatorIndex,
        operatorName: step.operatorName,
        reason: "filtered",
      };
      this.active.delete(valueId);
      this.onValueFiltered?.(trace, step);
      return null;
    }

    trace.state = "processing";
    trace.finalValue = outputValue;
    this.onValueTransformed?.(trace, step);
    return valueId;
  }

  collapseValue(
    valueId: string,
    operatorIndex: number,
    operatorName: string,
    targetValueId: string
  ) {
    const trace = this.traces.get(valueId);
    if (!trace) return;

    trace.state = "collapsed";
    trace.collapsedInto = { operatorIndex, operatorName, targetValueId };
    this.active.delete(valueId);
    this.onValueCollapsed?.(trace, trace.operatorSteps.at(-1)!);
  }

  errorInOperator(valueId: string, operatorIndex: number, error: Error) {
    const trace = this.traces.get(valueId);
    if (!trace) return;

    trace.state = "errored";
    trace.droppedReason = {
      operatorIndex,
      operatorName: trace.operatorSteps.at(-1)?.operatorName ?? "unknown",
      reason: "errored",
      error,
    };

    this.active.delete(valueId);
    this.onValueDropped?.(trace);
  }

  markDelivered(valueId: string) {
    const trace = this.traces.get(valueId);
    if (!trace) return;

    trace.state = "delivered";
    trace.deliveredAt = Date.now();
    trace.totalDuration = trace.deliveredAt - trace.emittedAt;

    this.active.delete(valueId);
    this.onValueDelivered?.(trace);
  }

  /* ------------------------------------------------------------------------
   * QUERY API
   * ---------------------------------------------------------------------- */

  getAllTraces(): ValueTrace[] {
    return [...this.traces.values()];
  }

  /**
   * Retrieves all values that were filtered out
   * @returns Array of filtered value traces
   */
  getFilteredValues(): ValueTrace[] {
    return this.getAllTraces().filter(t => t.state === "filtered");
  }

  /**
   * Retrieves all values that were collapsed
   * @returns Array of collapsed value traces
   */
  getCollapsedValues(): ValueTrace[] {
    return this.getAllTraces().filter(t => t.state === "collapsed");
  }

  /**
   * Retrieves all values that were successfully delivered
   * @returns Array of delivered value traces
   */
  getDeliveredValues(): ValueTrace[] {
    return this.getAllTraces().filter(t => t.state === "delivered");
  }

  /**
   * Retrieves all values that were dropped (filtered or errored)
   * @returns Array of dropped value traces
   */
  getDroppedValues(): ValueTrace[] {
    return this.getAllTraces().filter(t => t.droppedReason !== undefined);
  }

  /**
   * Calculates statistics about traced values
   * @returns Object containing counts and rates
   */
  getStats() {
    const all = this.getAllTraces();
    return {
      total: all.length,
      emitted: all.filter(t => t.state === "emitted").length,
      processing: all.filter(t => t.state === "processing").length,
      delivered: all.filter(t => t.state === "delivered").length,
      filtered: all.filter(t => t.state === "filtered").length,
      collapsed: all.filter(t => t.state === "collapsed").length,
      errored: all.filter(t => t.state === "errored").length,
      dropRate:
        all.length > 0 ? (this.getDroppedValues().length / all.length) * 100 : 0,
    };
  }

  clear() {
    this.traces.clear();
    this.active.clear();
  }
}

/* ============================================================================
 * VALUE WRAPPING
 * ========================================================================== */

const tracedValueBrand: unique symbol = Symbol.for("__streamix_traced__");

export interface TracedWrapper<T> {
  [tracedValueBrand]: true;
  value: T;
  meta: {
    valueId: string;
    streamId: string;
    subscriptionId: string;
  };
}

function wrap<T>(value: T, meta: TracedWrapper<T>["meta"]): TracedWrapper<T> {
  return { [tracedValueBrand]: true, value, meta };
}

function unwrap<T>(v: unknown): T {
  return (v as any)?.[tracedValueBrand] ? (v as any).value : v as T;
}

/* ============================================================================
 * RUNTIME HOOK REGISTRATION
 * ========================================================================== */

const TRACER_KEY = "__STREAMIX_GLOBAL_TRACER__";

export function enableTracing(tracer: ValueTracer) {
  (globalThis as any)[TRACER_KEY] = tracer;
}

export function disableTracing() {
  (globalThis as any)[TRACER_KEY] = null;
}

export function getGlobalTracer(): ValueTracer | null {
  return (globalThis as any)[TRACER_KEY] ?? null;
}

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
          return { done: false, value: wrap(r.value, { valueId: id, streamId, subscriptionId }) };
        },
      },

      operators: operators.map((op, i) =>
        createOperator(`traced_${op.name ?? i}`, src => ({
          async next() {
            const r = await src.next();
            if (r.done) return r;
            const meta = r.value.meta;
            const value = unwrap(r.value);
            tracer.enterOperator(meta.valueId, i, op.name ?? `op${i}`, value);
            const out = await op.apply({ next: async () => ({ done: false, value }) }).next();
            if (out.done) return out;
            tracer.exitOperator(meta.valueId, i, out.value);
            return { done: false, value: wrap(out.value, meta) };
          },
        }))
      ),

      final: it => ({
        async next() {
          const r = await it.next();
          if (!r.done) tracer.markDelivered(r.value.meta.valueId);
          return r.done ? r : { done: false, value: unwrap(r.value) };
        },
      }),
    };
  },
});
