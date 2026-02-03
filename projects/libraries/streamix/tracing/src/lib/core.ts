/**
 * Streamix tracing core abstractions.
 *
 * This module defines the tracer contract, trace model, and helper utilities.
 * It is framework/runtime-agnostic and does not wire into Streamix execution.
 */

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
 * Normalized events emitted by the tracing runtime for tracer implementations.
 */
export type TraceEvent =
  | {
      type: "emitted";
      valueId: string;
      streamId: string;
      streamName?: string;
      subscriptionId: string;
      timestamp: number;
      sourceValue: any;
      parentTraceId?: string;
    }
  | {
      type: "transformed";
      valueId: string;
      operatorIndex: number;
      operatorName: string;
      inputValue: any;
      outputValue: any;
      timestamp: number;
      duration?: number;
    }
  | {
      type: "expanded";
      valueId: string;
      baseValueId: string;
      operatorIndex: number;
      operatorName: string;
      streamId: string;
      streamName?: string;
      subscriptionId: string;
      timestamp: number;
      sourceValue: any;
      expandedValue: any;
    }
  | {
      type: "collapsed";
      valueId: string;
      operatorIndex: number;
      operatorName: string;
      targetValueId: string;
      timestamp: number;
    }
  | {
      type: "filtered";
      valueId: string;
      operatorIndex: number;
      operatorName: string;
      timestamp: number;
      sourceValue: any;
      filteredValue: any;
    }
  | {
      type: "errored";
      valueId: string;
      operatorIndex: number;
      operatorName: string;
      timestamp: number;
      error: Error;
    }
  | {
      type: "delivered";
      valueId: string;
      timestamp: number;
      deliveredValue: any;
    }
  | {
      type: "dropped";
      valueId: string;
      timestamp: number;
      reason: TerminalReason;
    };

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
