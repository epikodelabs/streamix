/**
 * Streamix tracing core primitives.
 *
 */

/* ============================================================================ */
/* PUBLIC TYPES */
/* ============================================================================ */

export type ValueState =
  | "emitted"
  | "transformed"
  | "filtered"
  | "collapsed"
  | "expanded"
  | "errored"
  | "delivered"
  | "dropped";

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

export type TerminalReason = "filtered" | "collapsed" | "errored" | "late";

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

export interface TracedWrapper<T> {
  [tracedValueBrand]: true;
  value: T;
  meta: { valueId: string; streamId: string; subscriptionId: string };
}

export const wrapTracedValue = <T>(value: T, meta: TracedWrapper<T>["meta"]): TracedWrapper<T> =>
  ({ [tracedValueBrand]: true, value, meta });

export const unwrapTracedValue = <T>(v: any): T => (v?.[tracedValueBrand]) ? v.value : v;

export const isTracedValue = (v: any): v is TracedWrapper<any> => Boolean(v?.[tracedValueBrand]);

export const getValueId = (v: any): string | undefined => isTracedValue(v) ? v.meta.valueId : undefined;

/* ============================================================================ */
/* GLOBAL TRACER MANAGEMENT */
/* ============================================================================ */

const TRACER_KEY = "__STREAMIX_GLOBAL_TRACER__";

export const getGlobalTracer = (): ValueTracer | null => (globalThis as any)[TRACER_KEY] ?? null;

export function enableTracing(t: ValueTracer): void { (globalThis as any)[TRACER_KEY] = t; }

export function disableTracing(): void { (globalThis as any)[TRACER_KEY] = null; }

/* ============================================================================ */
/* ID GENERATION */
/* ============================================================================ */

const IDS_KEY = "__STREAMIX_TRACE_IDS__";

const getIds = (): { value: number } => {
  const g = globalThis as any;
  return g[IDS_KEY] ??= { value: 0 };
};

export const generateValueId = (): string => `val_${++getIds().value}`;
