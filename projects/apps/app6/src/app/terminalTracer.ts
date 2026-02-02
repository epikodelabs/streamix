/**
 * Lightweight terminal tracer implementation.
 *
 * This tracer records only terminal states (delivered/filtered/collapsed/errored)
 * without tracking individual operator steps or durations. Optimized for production
 * use with minimal overhead.
 *
 * MODIFIED: Added 'emitted' event support for counter-based tracking.
 */
import { unwrapPrimitive } from "@epikodelabs/streamix";
import {
  OperatorOutcome,
  TerminalReason,
  ValueState,
  ValueTrace,
  ValueTracer,
  generateValueId,
  unwrapTracedValue,
} from "@epikodelabs/streamix/tracing";

/* ============================================================================ */
/* PUBLIC TYPES */
/* ============================================================================ */

export type TracerEventHandlers = {
  /** Invoked when a trace is created/emitted. */
  emitted?: (trace: ValueTrace) => void;
  /** Invoked when a trace is marked as delivered. */
  delivered?: (trace: ValueTrace) => void;
  /** Invoked when a trace becomes terminal due to filtering. */
  filtered?: (trace: ValueTrace) => void;
  /** Invoked when a trace becomes terminal due to collapsing. */
  collapsed?: (trace: ValueTrace) => void;
  /** Invoked when a trace becomes terminal for reasons other than filtering/collapsing. */
  dropped?: (trace: ValueTrace) => void;
};

export type TracerSubscriptionEventHandlers = TracerEventHandlers & {
  /** Invoked when a subscription is completed (via `final` iterator completion/return/throw). */
  complete?: () => void;
};

/** Configuration for terminal tracer creation. */
export interface TerminalTracerOptions {
  /** Maximum number of traces kept in memory (LRU eviction). */
  maxTraces?: number;
  /** Reserved for future diagnostics; currently unused. */
  devMode?: boolean;
  /**
   * Called on every trace update (terminal state changes and delivery).
   */
  onTraceUpdate?: (trace: ValueTrace) => void;
}

/**
 * Extended tracer interface that includes subscription and utility methods.
 */
export interface ExtendedValueTracer extends ValueTracer {
  /** Subscribes to value-level events across all subscriptions. Returns an unsubscribe function. */
  subscribe: (handlers: TracerEventHandlers) => () => void;
  /** Subscribes to value-level events for a specific subscription id. Returns an unsubscribe function. */
  observeSubscription: (subId: string, handlers: TracerSubscriptionEventHandlers) => () => void;
  /** Returns the current in-memory traces (subject to LRU eviction). */
  getAllTraces: () => ValueTrace[];
  /** Returns basic tracer stats. */
  getStats: () => { total: number };
  /** Clears all in-memory traces and subscription observers. */
  clear: () => void;
}

/* ============================================================================ */
/* INTERNAL MODEL */
/* ============================================================================ */

type TraceStatus = "active" | "delivered" | "terminal";
type SubscriptionState = "active" | "completed";

/**
 * Minimal trace record - no operator steps, just terminal states.
 */
interface MinimalTraceRecord {
  readonly valueId: string;
  readonly streamId: string;
  readonly streamName?: string;
  readonly subscriptionId: string;
  readonly emittedAt: number;
  readonly deliveredAt?: number;
  readonly status: TraceStatus;
  readonly terminalReason?: TerminalReason;
  readonly sourceValue: any;
  readonly finalValue?: any;
  readonly parentTraceId?: string;
  readonly expandedFrom?: {
    operatorIndex: number;
    operatorName: string;
    baseValueId: string;
  };
  readonly expandedInto?: string[]; // Track values expanded from this trace
  readonly collapsedInto?: {
    operatorIndex: number;
    operatorName: string;
    targetValueId: string;
  };
  readonly droppedReason?: {
    operatorIndex: number;
    operatorName: string;
    reason: TerminalReason;
    error?: Error;
  };
  readonly totalDuration?: number;
}

/* ============================================================================ */
/* HELPER FUNCTIONS */
/* ============================================================================ */

const toValueState = (t: MinimalTraceRecord): ValueState => {
  if (t.status === "delivered") return "delivered";

  if (t.status === "terminal") {
    switch (t.terminalReason!) {
      case "filtered": return "filtered";
      case "collapsed": return "collapsed";
      case "errored": return "errored";
      case "late": return "dropped";
      default: return "dropped";
    }
  }

  // Active state - check for expanded traces first
  if (t.expandedFrom) return "expanded";
  if (t.expandedInto && t.expandedInto.length > 0) return "expanded";
  
  if (t.finalValue !== undefined) return "transformed";
  return "emitted";
};

const unwrapForExport = (value: any): any => unwrapPrimitive(unwrapTracedValue(value));

const exportTrace = (t: MinimalTraceRecord): ValueTrace => ({
  valueId: t.valueId,
  parentTraceId: t.parentTraceId,
  streamId: t.streamId,
  streamName: t.streamName,
  subscriptionId: t.subscriptionId,
  emittedAt: t.emittedAt,
  deliveredAt: t.deliveredAt,
  state: toValueState(t),
  sourceValue: unwrapForExport(t.sourceValue),
  finalValue: t.finalValue !== undefined ? unwrapForExport(t.finalValue) : undefined,
  operatorSteps: [], // Terminal tracer doesn't track steps
  droppedReason: t.droppedReason,
  collapsedInto: t.collapsedInto,
  expandedFrom: t.expandedFrom,
  totalDuration: t.totalDuration,
  operatorDurations: new Map(), // Terminal tracer doesn't track durations
});

const defaultOpName = (opIdx: number): string => `op${opIdx}`;

/* ============================================================================ */
/* TERMINAL TRACER IMPLEMENTATION */
/* ============================================================================ */

/**
 * Creates a tracer intended for production/low-overhead usage.
 *
 * Differences vs full tracer:
 * - Does not track operator steps (operatorSteps is always empty array)
 * - Does not track operator durations (operatorDurations is always empty Map)
 * - Minimal memory footprint
 * - Fast updates (no step processing)
 */
export const createTerminalTracer = (
  options: TerminalTracerOptions = {}
): ExtendedValueTracer => {
  const { maxTraces = 5_000, onTraceUpdate } = options;

  const traces = new Map<string, MinimalTraceRecord>();
  const subscribers: TracerEventHandlers[] = [];
  const subscriptionSubscribers = new Map<string, Set<TracerSubscriptionEventHandlers>>();
  const subscriptionStates = new Map<string, SubscriptionState>();

  // LRU eviction for memory management
  const retainTrace = (valueId: string, trace: MinimalTraceRecord): void => {
    traces.set(valueId, trace);
    if (traces.size > maxTraces) {
      const firstKey = traces.keys().next().value;
      if (firstKey) traces.delete(firstKey);
    }
  };

  const isCompleted = (subId: string): boolean =>
    subscriptionStates.get(subId) === "completed";

  const notify = (event: keyof TracerEventHandlers, trace: ValueTrace): void => {
    for (const sub of subscribers) {
      sub[event]?.(trace);
    }
    const subHandlers = subscriptionSubscribers.get(trace.subscriptionId);
    if (subHandlers) {
      for (const handler of subHandlers) {
        handler[event]?.(trace);
      }
    }
  };

  return {
    subscribe(handlers: TracerEventHandlers): () => void {
      subscribers.push(handlers);
      return () => {
        const idx = subscribers.indexOf(handlers);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },

    observeSubscription(subId: string, handlers: TracerSubscriptionEventHandlers): () => void {
      if (!subscriptionSubscribers.has(subId)) {
        subscriptionSubscribers.set(subId, new Set());
      }
      subscriptionSubscribers.get(subId)!.add(handlers);
      return () => subscriptionSubscribers.get(subId)?.delete(handlers);
    },

    completeSubscription(subId: string): void {
      if (subscriptionStates.get(subId) === "completed") return;
      subscriptionStates.set(subId, "completed");
      const handlers = subscriptionSubscribers.get(subId);
      if (handlers) {
        for (const h of handlers) {
          h.complete?.();
        }
        subscriptionSubscribers.delete(subId);
      }
    },

    startTrace(valueId: string, streamId: string, streamName: string | undefined, subId: string, value: any): ValueTrace {
      if (!subscriptionStates.has(subId)) {
        subscriptionStates.set(subId, "active");
      }

      const now = Date.now();
      const record: MinimalTraceRecord = {
        valueId,
        streamId,
        streamName,
        subscriptionId: subId,
        emittedAt: now,
        status: "active",
        sourceValue: value,
      };

      retainTrace(valueId, record);

      // Check if subscription already completed
      if (isCompleted(subId)) {
        const terminated: MinimalTraceRecord = {
          ...record,
          status: "terminal",
          terminalReason: "late",
          droppedReason: {
            operatorIndex: -1,
            operatorName: "subscription",
            reason: "late",
          },
        };
        retainTrace(valueId, terminated);
        const exported = exportTrace(terminated);
        notify("dropped", exported);
        onTraceUpdate?.(exported);
        return exported;
      }

      const exported = exportTrace(record);
      notify("emitted", exported);
      onTraceUpdate?.(exported);
      return exported;
    },

    createExpandedTrace(baseId: string, opIdx: number, opName: string, value: any): string {
      const now = Date.now();
      const base = traces.get(baseId);
      const valueId = generateValueId();

      const record: MinimalTraceRecord = base
        ? {
            valueId,
            parentTraceId: baseId,
            streamId: base.streamId,
            streamName: base.streamName,
            subscriptionId: base.subscriptionId,
            emittedAt: base.emittedAt,
            status: "active",
            sourceValue: base.sourceValue,
            finalValue: value,
            expandedFrom: { operatorIndex: opIdx, operatorName: opName, baseValueId: baseId },
          }
        : {
            valueId,
            parentTraceId: baseId,
            streamId: "unknown",
            subscriptionId: "unknown",
            emittedAt: now,
            status: "active",
            sourceValue: value,
            finalValue: value,
            expandedFrom: { operatorIndex: opIdx, operatorName: opName, baseValueId: baseId },
          };

      retainTrace(valueId, record);
      
      // Update the base trace to mark it as expanded
      if (base && base.status === "active") {
        const updatedBase: MinimalTraceRecord = {
          ...base,
          expandedInto: [...(base.expandedInto || []), valueId],
        };
        retainTrace(baseId, updatedBase);
      }
      
      const exported = exportTrace(record);
      notify("emitted", exported);
      onTraceUpdate?.(exported);
      return valueId;
    },

    enterOperator(_vId: string, _opIdx: number, _opName: string, _val: any): void {
      // Terminal tracer doesn't track operator entry
    },

    exitOperator(vId: string, opIdx: number, val: any, filtered: boolean = false, outcome: OperatorOutcome = "transformed"): string | null {
      const trace = traces.get(vId);
      if (!trace) return null;

      // Skip if already terminal or delivered
      if (trace.status !== "active") return null;

      // Check if subscription completed
      if (isCompleted(trace.subscriptionId)) {
        const terminated: MinimalTraceRecord = {
          ...trace,
          finalValue: val,
          status: "terminal",
          terminalReason: "late",
          droppedReason: {
            operatorIndex: opIdx,
            operatorName: defaultOpName(opIdx),
            reason: "late",
          },
        };
        retainTrace(vId, terminated);
        const exported = exportTrace(terminated);
        notify("dropped", exported);
        onTraceUpdate?.(exported);
        return null;
      }

      // Handle filtered outcome
      if (filtered || outcome === "filtered") {
        const terminated: MinimalTraceRecord = {
          ...trace,
          finalValue: val,
          status: "terminal",
          terminalReason: "filtered",
          droppedReason: {
            operatorIndex: opIdx,
            operatorName: defaultOpName(opIdx),
            reason: "filtered",
          },
        };
        retainTrace(vId, terminated);
        const exported = exportTrace(terminated);
        notify("filtered", exported);
        onTraceUpdate?.(exported);
        return vId;
      }

      // Handle errored outcome
      if (outcome === "errored") {
        const terminated: MinimalTraceRecord = {
          ...trace,
          finalValue: val,
          status: "terminal",
          terminalReason: "errored",
          droppedReason: {
            operatorIndex: opIdx,
            operatorName: defaultOpName(opIdx),
            reason: "errored",
          },
        };
        retainTrace(vId, terminated);
        const exported = exportTrace(terminated);
        notify("dropped", exported);
        onTraceUpdate?.(exported);
        return vId;
      }

      // Handle expanded outcome
      if (outcome === "expanded") {
        // Don't update the trace - expansion will be handled by createExpandedTrace
        return vId;
      }

      // Normal transformation - just update final value
      const updated: MinimalTraceRecord = {
        ...trace,
        finalValue: val,
      };
      retainTrace(vId, updated);
      onTraceUpdate?.(exportTrace(updated));
      return vId;
    },

    collapseValue(vId: string, opIdx: number, opName: string, targetId: string, _val?: any): void {
      const trace = traces.get(vId);
      if (!trace) return;

      // Check if subscription completed
      if (isCompleted(trace.subscriptionId)) {
        const terminated: MinimalTraceRecord = {
          ...trace,
          status: "terminal",
          terminalReason: "late",
          droppedReason: {
            operatorIndex: opIdx,
            operatorName: opName,
            reason: "late",
          },
        };
        retainTrace(vId, terminated);
        const exported = exportTrace(terminated);
        notify("dropped", exported);
        onTraceUpdate?.(exported);
        return;
      }

      const terminated: MinimalTraceRecord = {
        ...trace,
        status: "terminal",
        terminalReason: "collapsed",
        collapsedInto: { operatorIndex: opIdx, operatorName: opName, targetValueId: targetId },
        droppedReason: {
          operatorIndex: opIdx,
          operatorName: opName,
          reason: "collapsed",
        },
      };

      retainTrace(vId, terminated);
      const exported = exportTrace(terminated);
      notify("collapsed", exported);
      onTraceUpdate?.(exported);
    },

    errorInOperator(vId: string, opIdx: number, error: Error): void {
      const trace = traces.get(vId);
      if (!trace) return;

      const terminated: MinimalTraceRecord = {
        ...trace,
        status: "terminal",
        terminalReason: "errored",
        droppedReason: {
          operatorIndex: opIdx,
          operatorName: defaultOpName(opIdx),
          reason: "errored",
          error,
        },
      };

      retainTrace(vId, terminated);
      const exported = exportTrace(terminated);
      notify("dropped", exported);
      onTraceUpdate?.(exported);
    },

    markDelivered(vId: string): void {
      const trace = traces.get(vId);
      if (!trace) return;

      // Skip if subscription completed or already delivered
      if (isCompleted(trace.subscriptionId) || trace.status === "delivered") return;

      const now = Date.now();
      const delivered: MinimalTraceRecord = {
        ...trace,
        status: "delivered",
        deliveredAt: now,
        totalDuration: now - trace.emittedAt,
        // Clear terminal status since value actually delivered
        terminalReason: undefined,
        droppedReason: undefined,
      };

      retainTrace(vId, delivered);
      const exported = exportTrace(delivered);
      notify("delivered", exported);
      onTraceUpdate?.(exported);
    },

    getAllTraces(): ValueTrace[] {
      return Array.from(traces.values()).map(exportTrace);
    },

    getStats(): { total: number } {
      return { total: traces.size };
    },

    clear(): void {
      traces.clear();
      subscriptionSubscribers.clear();
      subscriptionStates.clear();
    },
  };
};