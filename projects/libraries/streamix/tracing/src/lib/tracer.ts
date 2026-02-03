import type { ValueTrace, ValueTracer } from "./core";

export type TracerEventHandlers = {
  /** Invoked when a new value is emitted from a stream (before any operators). */
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

type SubscriptionState = "active" | "completed";

export const createTraceStore = <T>(maxTraces: number) => {
  const traces = new Map<string, T>();

  const retainTrace = (valueId: string, trace: T): void => {
    traces.set(valueId, trace);
    if (traces.size > maxTraces) {
      const firstKey = traces.keys().next().value;
      if (firstKey) traces.delete(firstKey);
    }
  };

  const clearTraces = (): void => {
    traces.clear();
  };

  return { traces, retainTrace, clearTraces };
};

export const createTracerSubscriptions = () => {
  const subscribers: TracerEventHandlers[] = [];
  const subscriptionSubscribers = new Map<string, Set<TracerSubscriptionEventHandlers>>();
  const subscriptionStates = new Map<string, SubscriptionState>();

  const ensureActive = (subId: string): void => {
    if (!subscriptionStates.has(subId)) {
      subscriptionStates.set(subId, "active");
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

  const subscribe = (handlers: TracerEventHandlers): () => void => {
    subscribers.push(handlers);
    return () => {
      const idx = subscribers.indexOf(handlers);
      if (idx >= 0) subscribers.splice(idx, 1);
    };
  };

  const observeSubscription = (subId: string, handlers: TracerSubscriptionEventHandlers): () => void => {
    if (!subscriptionSubscribers.has(subId)) {
      subscriptionSubscribers.set(subId, new Set());
    }
    subscriptionSubscribers.get(subId)!.add(handlers);
    return () => subscriptionSubscribers.get(subId)?.delete(handlers);
  };

  const completeSubscription = (subId: string): void => {
    if (subscriptionStates.get(subId) === "completed") return;
    subscriptionStates.set(subId, "completed");
    const handlers = subscriptionSubscribers.get(subId);
    if (handlers) {
      for (const h of handlers) {
        h.complete?.();
      }
      subscriptionSubscribers.delete(subId);
    }
  };

  const clearSubscriptions = (): void => {
    subscriptionSubscribers.clear();
    subscriptionStates.clear();
  };

  return {
    subscribe,
    observeSubscription,
    completeSubscription,
    ensureActive,
    isCompleted,
    notify,
    clearSubscriptions,
  };
};

/* ============================================================================ */
/* COMMON TRACER UTILITIES */
/* ============================================================================ */

import { unwrapPrimitive } from "@epikodelabs/streamix";
import type { TerminalReason, ValueState } from "./core";
import { unwrapTracedValue } from "./core";

/**
 * Generates a default operator name from its index.
 */
export const defaultOpName = (opIdx: number): string => `op${opIdx}`;

/**
 * Unwraps traced values and primitives for export.
 */
export const unwrapForExport = (value: any): any => unwrapPrimitive(unwrapTracedValue(value));

/**
 * Converts trace status and terminal reason into a ValueState.
 */
export const toValueState = (params: {
  status: "active" | "delivered" | "terminal";
  terminalReason?: TerminalReason;
  parentTraceId?: string;
  hasOperatorSteps?: boolean;
  hasFinalValue?: boolean;
  expandedFrom?: any;
  expandedInto?: any;
}): ValueState => {
  if (params.status === "delivered") return "delivered";

  if (params.status === "terminal") {
    switch (params.terminalReason!) {
      case "filtered": return "filtered";
      case "collapsed": return "collapsed";
      case "errored": return "errored";
      case "late": return "dropped";
      default: return "dropped";
    }
  }

  // Active state - check for expanded traces
  if (params.expandedFrom) return "expanded";
  if (params.expandedInto && (Array.isArray(params.expandedInto) ? params.expandedInto.length > 0 : true)) return "expanded";
  if (params.parentTraceId) return "expanded";
  if (params.hasOperatorSteps) return "transformed";
  if (params.hasFinalValue) return "transformed";
  return "emitted";
};