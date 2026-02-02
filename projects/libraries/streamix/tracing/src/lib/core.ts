/**
 * Streamix tracing core primitives.
 *
 * These types and helpers support capturing detailed per-value execution traces
 * as values flow through a pipe (operators) and are delivered to subscribers.
 *
 * Tracing is opt-in: enable it by calling {@link enableTracing} with a
 * {@link ValueTracer} implementation.
 */

/* ============================================================================ */
/* PUBLIC TYPES */
/* ============================================================================ */

/**
 * High-level lifecycle states for a value in a trace.
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
 * Outcome classification for a single operator step.
 */
export type OperatorOutcome =
  | "transformed"
  | "filtered"
  | "expanded"
  | "collapsed"
  | "errored";

/**
 * Trace entry for a single operator execution.
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

/**
 * Reason why a value became terminal without being delivered to a subscriber.
 */
export type TerminalReason = "filtered" | "collapsed" | "errored" | "late";

/**
 * Full trace for a single emitted value.
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
 * Contract implemented by tracing backends.
 *
 * A tracer receives events during pipe execution and may store them in memory,
 * log them, visualize them, or forward them to external tooling.
 */
export interface ValueTracer {
  startTrace: (vId: string, sId: string, sName: string | undefined, subId: string, val: any) => ValueTrace;
  createExpandedTrace: (baseId: string, opIdx: number, opName: string, val: any) => string;
  enterOperator: (vId: string, opIdx: number, opName: string, val: any) => void;
  exitOperator: (vId: string, opIdx: number, val: any, filtered?: boolean, outcome?: OperatorOutcome) => string | null;
  collapseValue: (vId: string, opIdx: number, opName: string, targetId: string, val?: any) => void;
  errorInOperator: (vId: string, opIdx: number, error: Error) => void;
  markDelivered: (vId: string) => void;
  completeSubscription: (subId: string) => void;
}

/* ============================================================================ */
/* TRACED VALUE WRAPPER */
/* ============================================================================ */

const tracedValueBrand = Symbol("__streamix_traced__");

/**
 * Wrapper object used to carry tracing metadata alongside a value.
 *
 * The wrapper is intentionally lightweight and uses a symbol brand to avoid
 * collisions with user objects.
 */
export interface TracedWrapper<T> {
  [tracedValueBrand]: true;
  value: T;
  meta: { valueId: string; streamId: string; subscriptionId: string };
}

/**
 * Wraps a value with tracing metadata.
 */
export const wrapTracedValue = <T>(value: T, meta: TracedWrapper<T>["meta"]): TracedWrapper<T> =>
  ({ [tracedValueBrand]: true, value, meta });

/**
 * Unwraps a traced value (if wrapped) and returns the underlying user value.
 */
export const unwrapTracedValue = <T>(v: any): T => (v?.[tracedValueBrand]) ? v.value : v;

/**
 * Type guard for {@link TracedWrapper}.
 */
export const isTracedValue = (v: any): v is TracedWrapper<any> => Boolean(v?.[tracedValueBrand]);

/**
 * Extracts a trace id from a traced value.
 */
export const getValueId = (v: any): string | undefined => isTracedValue(v) ? v.meta.valueId : undefined;

/* ============================================================================ */
/* GLOBAL TRACER MANAGEMENT */
/* ============================================================================ */

const TRACER_KEY = "__STREAMIX_GLOBAL_TRACER__";

/**
 * Returns the currently enabled global tracer, if any.
 */
export const getGlobalTracer = (): ValueTracer | null => (globalThis as any)[TRACER_KEY] ?? null;

/**
 * Enables tracing by installing a global tracer.
 *
 * Tracing hooks are typically installed separately (see `installTracingHooks()`)
 * and consult this global tracer at runtime.
 */
export function enableTracing(t: ValueTracer): void { (globalThis as any)[TRACER_KEY] = t; }

/**
 * Disables tracing by clearing the global tracer.
 */
export function disableTracing(): void { (globalThis as any)[TRACER_KEY] = null; }

/* ============================================================================ */
/* ID GENERATION */
/* ============================================================================ */

const IDS_KEY = "__STREAMIX_TRACE_IDS__";

const getIds = (): { value: number } => {
  const g = globalThis as any;
  return g[IDS_KEY] ??= { value: 0 };
};

/**
 * Generates a new unique trace id for a value.
 *
 * The id is process-local and monotonically increasing.
 */
export const generateValueId = (): string => `val_${++getIds().value}`;
