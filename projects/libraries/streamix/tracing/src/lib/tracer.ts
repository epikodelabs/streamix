/**
 * Streamix tracing utilities.
 *
 * This module provides a lightweight tracing layer for Streamix pipelines. It records how values
 * move through operators and exposes that information as `ValueTrace` snapshots and event callbacks.
 *
 * Common use cases:
 * - Debugging operator chains and value lifecycles
 * - Collecting diagnostics/metrics in development tools
 * - Inspecting delivered vs terminal (filtered/collapsed/dropped) outcomes
 */
import {
  createOperator,
  getIteratorMeta,
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
 *
 * This is the public view (`ValueTrace.state`) derived from internal status + terminal reason.
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
 *
 * This is used to annotate `OperatorStep`s and to decide whether a trace should become terminal.
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
 *
 * - `filtered`: explicitly removed by some operator
 * - `collapsed`: merged into another value (see `collapsedInto`)
 * - `errored`: operator threw while processing the value
 * - `late`: trace started/continued after the subscription was completed
 */
export type TerminalReason = "filtered" | "collapsed" | "errored" | "late";

/**
 * Public snapshot of a value's trace at a moment in time.
 *
 * Notes:
 * - `state` is a derived view over the internal state machine.
 * - `operatorSteps` may be empty when using `createTerminalTracer()`.
 * - `operatorDurations` aggregates time per operator key `${operatorIndex}:${operatorName}`.
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

export type TracerEventHandlers = {
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

/** Configuration for tracer creation. */
export interface ValueTracerOptions {
  /** Maximum number of traces kept in memory (LRU eviction). */
  maxTraces?: number;
  /** Reserved for future diagnostics; currently unused. */
  devMode?: boolean;
  /**
   * Called on every trace update. When `includeSteps` is enabled, `step` is the last updated operator step.
   * This callback is also invoked for terminal/delivered transitions (in addition to event handlers).
   */
  onTraceUpdate?: (trace: ValueTrace, step?: OperatorStep) => void;
}

/**
 * Tracer interface used by the runtime hooks to record value lifecycles.
 *
 * Most users should:
 * - Create a tracer (`createValueTracer` or `createTerminalTracer`)
 * - Install it globally via `enableTracing()`
 * - Subscribe to updates via `subscribe()` / `observeSubscription()`
 */
export interface ValueTracer {
  /** Subscribes to value-level events across all subscriptions. Returns an unsubscribe function. */
  subscribe: (handlers: TracerEventHandlers) => () => void;
  /** Subscribes to value-level events for a specific subscription id. Returns an unsubscribe function. */
  observeSubscription: (subId: string, handlers: TracerSubscriptionEventHandlers) => () => void;
  /** Marks the subscription as completed and notifies any per-subscription observers. */
  completeSubscription: (subId: string) => void;
  /** Begins a new trace record for a value id. */
  startTrace: (vId: string, sId: string, sName: string | undefined, subId: string, val: any) => ValueTrace;
  /** Creates a new trace id that is treated as expanded from `baseId`. */
  createExpandedTrace: (baseId: string, opIdx: number, opName: string, val: any) => string;
  /** Records entering an operator (only when step recording is enabled). */
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
  /** Returns the current in-memory traces (subject to LRU eviction). */
  getAllTraces: () => ValueTrace[];
  /** Returns basic tracer stats. */
  getStats: () => { total: number };
  /** Clears all in-memory traces and subscription observers. */
  clear: () => void;
}

/* ============================================================================ */
/* RUNTIME WRAPPER HELPERS */
/* ============================================================================ */

const tracedValueBrand = Symbol("__streamix_traced__");
const TRACER_KEY = "__STREAMIX_GLOBAL_TRACER__";

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
/* INTERNAL MODEL & STATE MACHINE */
/* ============================================================================ */

type TraceStatus = "active" | "delivered" | "terminal";
type SubscriptionState = "active" | "completed";

interface TraceRecord {
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
  readonly operatorSteps: ReadonlyArray<{
    operatorIndex: number;
    operatorName: string;
    enteredAt: number;
    exitedAt?: number;
    outcome?: OperatorOutcome;
    inputValue: any;
    outputValue?: any;
    error?: Error;
  }>;
  readonly operatorDurations: ReadonlyMap<string, number>;
  readonly totalDuration?: number;
}

type TraceEvent =
  | { type: "ENTER_OP"; opIndex: number; opName: string; input: any; now: number }
  | { type: "EXIT_OP"; opIndex: number; opName: string; output: any; outcome: OperatorOutcome; now: number; error?: Error }
  | { type: "TERMINALIZE"; reason: TerminalReason; opIndex: number; opName: string; now: number; error?: Error }
  | { type: "DELIVER"; now: number };

type EmitEvent = "delivered" | "filtered" | "collapsed" | "dropped" | "trace";

interface TracerPolicy {
  readonly deliverExpandedChildren: boolean;
}

interface ReduceResult {
  readonly trace: TraceRecord;
  readonly emit: ReadonlyArray<EmitEvent>;
  readonly lastStep?: TraceRecord["operatorSteps"][number];
}

/* ============================================================================ */
/* STATE MACHINE IMPLEMENTATION */
/* ============================================================================ */

const assertInvariants = (t: TraceRecord, policy: TracerPolicy): void => {
  if (t.status === "terminal" && !t.terminalReason) {
    throw new Error(`Invariant violation: terminal trace ${t.valueId} missing terminalReason`);
  }
  if (t.status !== "terminal" && t.terminalReason) {
    throw new Error(`Invariant violation: non-terminal trace ${t.valueId} has terminalReason`);
  }
  if (t.status === "delivered" && !t.deliveredAt) {
    throw new Error(`Invariant violation: delivered trace ${t.valueId} missing deliveredAt`);
  }
  if (!policy.deliverExpandedChildren && t.parentTraceId && t.status === "delivered") {
    throw new Error(`Invariant violation: expanded child ${t.valueId} marked as delivered`);
  }
};

const reduceTrace = (trace: TraceRecord, event: TraceEvent, policy: TracerPolicy): ReduceResult => {
  const isTerminal = trace.status === "terminal" || trace.status === "delivered";
  const emit: EmitEvent[] = [];

  const closeOpenSteps = (
    input: TraceRecord,
    now: number,
    options?: { terminalReason?: TerminalReason; terminalOpIndex?: number; error?: Error }
  ): TraceRecord => {
    if (input.operatorSteps.length === 0) return input;

    let changed = false;
    const operatorSteps: Array<TraceRecord["operatorSteps"][number]> = [...input.operatorSteps];
    const operatorDurations = new Map(input.operatorDurations);

    for (let idx = 0; idx < operatorSteps.length; idx += 1) {
      const step = operatorSteps[idx];
      if (step.exitedAt != null) continue;

      changed = true;

      const isTerminalStep =
        options?.terminalOpIndex != null && step.operatorIndex === options.terminalOpIndex;

      const outcome: OperatorOutcome | undefined = isTerminalStep
        ? options?.terminalReason === "filtered"
          ? "filtered"
          : options?.terminalReason === "collapsed"
            ? "collapsed"
            : options?.terminalReason === "errored"
              ? "errored"
              : step.outcome ?? "transformed"
        : step.outcome ?? "transformed";

      const updatedStep = {
        ...step,
        exitedAt: now,
        outcome,
        error: isTerminalStep ? options?.error ?? step.error : step.error,
      };

      operatorSteps[idx] = updatedStep;

      const duration = now - step.enteredAt;
      const durKey = `${step.operatorIndex}:${step.operatorName}`;
      operatorDurations.set(durKey, (operatorDurations.get(durKey) ?? 0) + duration);
    }

    if (!changed) return input;

    return {
      ...input,
      operatorSteps,
      operatorDurations,
    };
  };

  switch (event.type) {
    case "ENTER_OP": {
      if (isTerminal) return { trace, emit };

      const step = {
        operatorIndex: event.opIndex,
        operatorName: event.opName,
        enteredAt: event.now,
        inputValue: event.input,
      };

      const updated: TraceRecord = {
        ...trace,
        operatorSteps: [...trace.operatorSteps, step],
      };

      emit.push("trace");
      assertInvariants(updated, policy);
      return { trace: updated, emit, lastStep: step };
    }

    case "EXIT_OP": {
      if (isTerminal) return { trace, emit };

      const stepIndex = trace.operatorSteps.findIndex(
        (s) => s.operatorIndex === event.opIndex && s.exitedAt == null
      );

      // When operator step recording is disabled, we may not have an open step to match against.
      // Still record the final value and allow terminalization for filtered/errored outcomes.
      if (stepIndex === -1) {
        const baseUpdate: TraceRecord = {
          ...trace,
          finalValue: event.output,
        };

        let updated: TraceRecord = baseUpdate;
        if (event.outcome === "filtered") {
          updated = {
            ...baseUpdate,
            status: "terminal",
            terminalReason: "filtered",
            droppedReason: {
              operatorIndex: event.opIndex,
              operatorName: event.opName,
              reason: "filtered",
            },
          };
          emit.push("filtered");
        } else if (event.outcome === "errored") {
          updated = {
            ...baseUpdate,
            status: "terminal",
            terminalReason: "errored",
            droppedReason: {
              operatorIndex: event.opIndex,
              operatorName: event.opName,
              reason: "errored",
              error: event.error,
            },
          };
          emit.push("dropped");
        }

        emit.push("trace");
        assertInvariants(updated, policy);
        return { trace: updated, emit };
      }

      const prevStep = trace.operatorSteps[stepIndex];
      const updatedStep = {
        ...prevStep,
        exitedAt: event.now,
        outcome: event.outcome,
        outputValue: event.output,
        error: event.error,
      };

      const operatorSteps = [...trace.operatorSteps];
      operatorSteps[stepIndex] = updatedStep;

      // Calculate duration
      const duration = event.now - prevStep.enteredAt;
      const durKey = `${event.opIndex}:${prevStep.operatorName}`;
      const operatorDurations = new Map(trace.operatorDurations);
      operatorDurations.set(durKey, (operatorDurations.get(durKey) ?? 0) + duration);

      const baseUpdate: TraceRecord = {
        ...trace,
        operatorSteps,
        finalValue: event.output,
        operatorDurations,
      };

      // Auto-terminalize on filtered/errored
      let updated: TraceRecord;
      if (event.outcome === "filtered") {
        updated = { ...baseUpdate, status: "terminal", terminalReason: "filtered" };
        // Ensure we don't leave unrelated open steps dangling when a value becomes terminal.
        updated = closeOpenSteps(updated, event.now, {
          terminalReason: "filtered",
          terminalOpIndex: event.opIndex,
        });
        emit.push("filtered");
      } else if (event.outcome === "errored") {
        updated = { ...baseUpdate, status: "terminal", terminalReason: "errored" };
        // Ensure we don't leave unrelated open steps dangling when a value becomes terminal.
        updated = closeOpenSteps(updated, event.now, {
          terminalReason: "errored",
          terminalOpIndex: event.opIndex,
          error: event.error,
        });
        emit.push("dropped");
      } else {
        updated = baseUpdate;
      }

      emit.push("trace");
      assertInvariants(updated, policy);
      return { trace: updated, emit, lastStep: updatedStep };
    }

    case "TERMINALIZE": {
      if (isTerminal) return { trace, emit };

      const closed = closeOpenSteps(trace, event.now, {
        terminalReason: event.reason,
        terminalOpIndex: event.opIndex,
        error: event.error,
      });

      const updated: TraceRecord = {
        ...closed,
        status: "terminal",
        terminalReason: event.reason,
        droppedReason: {
          operatorIndex: event.opIndex,
          operatorName: event.opName,
          reason: event.reason,
          error: event.error,
        },
      };

      switch (event.reason) {
        case "filtered":
          emit.push("filtered");
          break;
        case "collapsed":
          emit.push("collapsed");
          break;
        default:
          emit.push("dropped");
      }

      emit.push("trace");
      assertInvariants(updated, policy);

      const lastStep = updated.operatorSteps.findLast(
        (s) => s.operatorIndex === event.opIndex && s.exitedAt != null
      );

      return { trace: updated, emit, lastStep };
    }

    case "DELIVER": {
      // Allow delivery to override filtered/terminal status since value actually reached subscriber
      // Only skip if already delivered
      if (trace.status === "delivered") return { trace, emit };

      // Policy: skip delivery for expanded children
      if (trace.parentTraceId && !policy.deliverExpandedChildren) {
        emit.push("trace");
        assertInvariants(trace, policy);
        return { trace, emit };
      }

      const closed = closeOpenSteps(trace, event.now);

      const updated: TraceRecord = {
        ...closed,
        status: "delivered",
        deliveredAt: event.now,
        totalDuration: event.now - closed.emittedAt,
        // Clear terminal status since value actually delivered
        terminalReason: undefined,
        droppedReason: undefined,
      };

      emit.push("delivered", "trace");
      assertInvariants(updated, policy);
      return { trace: updated, emit };
    }

    default: {
      const _exhaustive: never = event;
      throw new Error(`Unhandled event type: ${(_exhaustive as any).type}`);
    }
  }
};

const toValueState = (t: TraceRecord): ValueState => {
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

  // Active state
  if (t.parentTraceId) return "expanded";
  if (t.operatorSteps.length > 0) return "transformed";
  return "emitted";
};

const exportTrace = (t: TraceRecord): ValueTrace => ({
  valueId: t.valueId,
  parentTraceId: t.parentTraceId,
  streamId: t.streamId,
  streamName: t.streamName,
  subscriptionId: t.subscriptionId,
  emittedAt: t.emittedAt,
  deliveredAt: t.deliveredAt,
  state: toValueState(t),
  sourceValue: t.sourceValue,
  finalValue: t.finalValue,
  operatorSteps: t.operatorSteps.map((s) => ({ ...s })),
  droppedReason: t.droppedReason,
  collapsedInto: t.collapsedInto,
  expandedFrom: t.expandedFrom,
  totalDuration: t.totalDuration,
  operatorDurations: new Map(t.operatorDurations),
});

const defaultOpName = (opIdx: number): string => `op${opIdx}`;

/* ============================================================================ */
/* TRACER FACTORY */
/* ============================================================================ */

interface TracerConfig {
  readonly includeSteps: boolean;
  readonly policy: TracerPolicy;
}

const createTracerImpl = (
  config: TracerConfig,
  options: ValueTracerOptions = {}
): ValueTracer => {
  const { maxTraces = 10_000, onTraceUpdate } = options;
  const { includeSteps, policy } = config;

  const traces = new Map<string, TraceRecord>();
  const subscribers: TracerEventHandlers[] = [];
  const subscriptionSubscribers = new Map<string, Set<TracerSubscriptionEventHandlers>>();
  const subscriptionStates = new Map<string, SubscriptionState>();

  // LRU eviction for memory management
  const retainTrace = (valueId: string, trace: TraceRecord): void => {
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

  const processEvents = (
    valueId: string,
    result: ReduceResult
  ): void => {
    retainTrace(valueId, result.trace);

    const exported = includeSteps
      ? exportTrace(result.trace)
      : { ...exportTrace(result.trace), operatorSteps: [] };

    for (const event of result.emit) {
      if (event === "trace") {
        onTraceUpdate?.(exported, result.lastStep);
      } else {
        notify(event, exported);
      }
    }
  };

  return {
    subscribe(handlers) {
      subscribers.push(handlers);
      return () => {
        const idx = subscribers.indexOf(handlers);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },

    observeSubscription(subId, handlers) {
      if (!subscriptionSubscribers.has(subId)) {
        subscriptionSubscribers.set(subId, new Set());
      }
      subscriptionSubscribers.get(subId)!.add(handlers);
      return () => subscriptionSubscribers.get(subId)?.delete(handlers);
    },

    completeSubscription(subId) {
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

    startTrace(valueId, streamId, streamName, subId, value) {
      if (!subscriptionStates.has(subId)) {
        subscriptionStates.set(subId, "active");
      }

      const now = Date.now();
      const record: TraceRecord = {
        valueId,
        streamId,
        streamName,
        subscriptionId: subId,
        emittedAt: now,
        status: "active",
        sourceValue: value,
        operatorSteps: [],
        operatorDurations: new Map(),
      };

      retainTrace(valueId, record);

      if (isCompleted(subId)) {
        const result = reduceTrace(
          record,
          { type: "TERMINALIZE", reason: "late", opIndex: -1, opName: "subscription", now },
          policy
        );
        processEvents(valueId, result);
        return includeSteps ? exportTrace(result.trace) : { ...exportTrace(result.trace), operatorSteps: [] };
      }

      const exported = includeSteps ? exportTrace(record) : { ...exportTrace(record), operatorSteps: [] };
      onTraceUpdate?.(exported);
      return exported;
    },

    createExpandedTrace(baseId, opIdx, opName, value) {
      const now = Date.now();
      const base = traces.get(baseId);
      const valueId = generateValueId();

      const record: TraceRecord = base
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
            operatorSteps: includeSteps ? base.operatorSteps.map((s) => ({ ...s })) : [],
            operatorDurations: new Map(),
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
            operatorSteps: includeSteps
              ? [
                  {
                    operatorIndex: opIdx,
                    operatorName: opName,
                    enteredAt: now,
                    exitedAt: now,
                    outcome: "expanded" as const,
                    inputValue: undefined,
                    outputValue: value,
                  },
                ]
              : [],
            operatorDurations: new Map(),
            expandedFrom: { operatorIndex: opIdx, operatorName: opName, baseValueId: baseId },
          };

      retainTrace(valueId, record);
      const exported = includeSteps ? exportTrace(record) : { ...exportTrace(record), operatorSteps: [] };
      onTraceUpdate?.(exported);
      return valueId;
    },

    enterOperator(vId, opIdx, opName, val) {
      if (!includeSteps) return;

      const trace = traces.get(vId);
      if (!trace || trace.status !== "active" || isCompleted(trace.subscriptionId)) return;

      const result = reduceTrace(
        trace,
        { type: "ENTER_OP", opIndex: opIdx, opName, input: val, now: Date.now() },
        policy
      );

      processEvents(vId, result);
    },

    exitOperator(vId, opIdx, val, filtered = false, outcome = "transformed") {
      const trace = traces.get(vId);
      if (!trace) return null;

      const opName =
        trace.operatorSteps.find((s) => s.operatorIndex === opIdx && s.exitedAt == null)?.operatorName ??
        defaultOpName(opIdx);

      const hasOpenStep = trace.operatorSteps.some(
        (s) => s.operatorIndex === opIdx && s.exitedAt == null
      );

      if (!hasOpenStep && includeSteps) return null;

      if (isCompleted(trace.subscriptionId)) {
        const result = reduceTrace(
          trace,
          { type: "TERMINALIZE", reason: "late", opIndex: opIdx, opName: defaultOpName(opIdx), now: Date.now() },
          policy
        );
        processEvents(vId, result);
        return null;
      }

      const finalOutcome: OperatorOutcome = filtered ? "filtered" : outcome;

      const result = reduceTrace(
        trace,
        { type: "EXIT_OP", opIndex: opIdx, opName, output: val, outcome: finalOutcome, now: Date.now() },
        policy
      );

      // Ensure droppedReason for filtered outcomes
      let finalTrace = result.trace;
      if (finalTrace.status === "terminal" && finalTrace.terminalReason === "filtered" && !finalTrace.droppedReason) {
        finalTrace = {
          ...finalTrace,
          droppedReason: {
            operatorIndex: opIdx,
            operatorName: result.lastStep?.operatorName ?? defaultOpName(opIdx),
            reason: "filtered",
          },
        };
      }

      processEvents(vId, { ...result, trace: finalTrace });
      return vId;
    },

    collapseValue(vId, opIdx, opName, targetId) {
      const trace = traces.get(vId);
      if (!trace || isCompleted(trace.subscriptionId)) {
        if (trace && isCompleted(trace.subscriptionId)) {
          const result = reduceTrace(
            trace,
            { type: "TERMINALIZE", reason: "late", opIndex: opIdx, opName, now: Date.now() },
            policy
          );
          processEvents(vId, result);
        }
        return;
      }

      const updatedTrace: TraceRecord = {
        ...trace,
        collapsedInto: { operatorIndex: opIdx, operatorName: opName, targetValueId: targetId },
      };

      const result = reduceTrace(
        updatedTrace,
        { type: "TERMINALIZE", reason: "collapsed", opIndex: opIdx, opName, now: Date.now() },
        policy
      );

      processEvents(vId, result);
    },

    errorInOperator(vId, opIdx, error) {
      const trace = traces.get(vId);
      if (!trace) return;

      const opName = trace.operatorSteps.find((s) => s.operatorIndex === opIdx)?.operatorName ?? defaultOpName(opIdx);

      const result = reduceTrace(
        trace,
        { type: "TERMINALIZE", reason: "errored", opIndex: opIdx, opName, now: Date.now(), error },
        policy
      );

      processEvents(vId, result);
    },

    markDelivered(vId) {
      const trace = traces.get(vId);
      if (!trace || isCompleted(trace.subscriptionId)) return;

      const result = reduceTrace(trace, { type: "DELIVER", now: Date.now() }, policy);
      processEvents(vId, result);
    },

    getAllTraces() {
      return Array.from(traces.values()).map((t) =>
        includeSteps ? exportTrace(t) : { ...exportTrace(t), operatorSteps: [] }
      );
    },

    getStats() {
      return { total: traces.size };
    },

    clear() {
      traces.clear();
      subscriptionSubscribers.clear();
      subscriptionStates.clear();
    },
  };
};

/* ============================================================================ */
/* PUBLIC FACTORY FUNCTIONS */
/* ============================================================================ */

/**
 * Creates a full-fidelity tracer intended for development/inspection.
 *
 * - Records operator steps (`operatorSteps`) and durations (`operatorDurations`).
 * - Exports step data to `onTraceUpdate` and `getAllTraces`.
 */
export const createValueTracer = (options?: ValueTracerOptions): ValueTracer =>
  createTracerImpl(
    {
      includeSteps: true,
      policy: { deliverExpandedChildren: true },
    },
    options
  );

/**
 * Creates a tracer intended for production/low-overhead usage.
 *
 * Differences vs `createValueTracer()`:
 * - Does not retain `operatorSteps` (they are exported as an empty array).
 */
export const createTerminalTracer = (options?: ValueTracerOptions): ValueTracer =>
  createTracerImpl(
    {
      includeSteps: false,
      policy: { deliverExpandedChildren: true },
    },
    options
  );

/* ============================================================================ */
/* RUNTIME HOOKS */
/* ============================================================================ */

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
                  while (inputQueue.length > 0) {
                    const wrapped = inputQueue.shift()!;
                    tracer.exitOperator(wrapped.meta.valueId, i, wrapped.value, true);
                  }
                  return out;
                }

                // Check for per-value metadata (from operators like debounce/throttle)
                const perValueMeta = getValueMeta(out.value);
                
                const outputMeta = getIteratorMeta(inner as any) as any;
                
                // Use per-value metadata if available, otherwise use iterator metadata
                const metaToPropagate = perValueMeta ?? outputMeta;
                
                if (metaToPropagate?.valueId) {
                  setIteratorMeta(
                    this as any,
                    { valueId: metaToPropagate.valueId, kind: metaToPropagate.kind, inputValueIds: metaToPropagate.inputValueIds },
                    metaToPropagate.operatorIndex,
                    metaToPropagate.operatorName
                  );
                }

                // Array collapse: multiple inputs → array output
                if (
                  Array.isArray(out.value) &&
                  outputMeta?.kind === "collapse" &&
                  Array.isArray(outputMeta.inputValueIds) &&
                  outputMeta.inputValueIds.length > 1
                ) {
                  const targetId =
                    (typeof outputMeta.valueId === "string" && outputMeta.valueId) ||
                    outputMeta.inputValueIds[outputMeta.inputValueIds.length - 1];

                  if (typeof targetId === "string" && metaByValueId.has(targetId)) {
                    const targetMeta = metaByValueId.get(targetId)!;

                    for (const id of outputMeta.inputValueIds) {
                      if (id === targetId) continue;
                      if (!metaByValueId.has(id)) continue;
                      removeFromQueue(id);
                      tracer.collapseValue(id, i, opName, targetId, out.value);
                    }

                    removeFromQueue(targetId);
                    const unwrappedValue = unwrapPrimitive(out.value);
                    tracer.exitOperator(targetId, i, unwrappedValue, false, "collapsed");
                    lastOutputMeta = targetMeta;
                    setIteratorMeta(this as any, targetMeta, i, opName);

                    return { done: false, value: wrapTracedValue(unwrappedValue, targetMeta) };
                  }
                }
                if (Array.isArray(out.value) && requestBatch.length > 1 && out.value.length === requestBatch.length) {
                  const target = requestBatch[requestBatch.length - 1];

                  for (let j = 0; j < requestBatch.length - 1; j++) {
                    removeFromQueue(requestBatch[j].meta.valueId);
                    tracer.collapseValue(requestBatch[j].meta.valueId, i, opName, target.meta.valueId, out.value);
                  }

                  removeFromQueue(target.meta.valueId);
                  tracer.exitOperator(target.meta.valueId, i, out.value, false, "collapsed");
                  lastOutputMeta = target.meta;
                  setIteratorMeta(this as any, target.meta, i, opName);

                  return { done: false, value: wrapTracedValue(out.value, target.meta) };
                }

                // Runtime-provided output with expansion/filtering
                if (outputMeta?.valueId && metaByValueId.has(outputMeta.valueId)) {
                  const baseValueId = outputMeta.valueId as string;
                  const baseMeta = metaByValueId.get(baseValueId)!;

                  // Filter detection: pass-through from one of multiple requests
                  if (requestBatch.length > 1) {
                    const baseRequested = requestBatch.find((w) => w.meta.valueId === baseValueId);
                    const isPassThrough = baseRequested && Object.is(out.value, baseRequested.value);

                    if (isPassThrough) {
                      for (const req of requestBatch) {
                        if (req.meta.valueId !== baseValueId) {
                          removeFromQueue(req.meta.valueId);
                          tracer.exitOperator(req.meta.valueId, i, req.value, true);
                        }
                      }
                    }
                  }

                  const key = `${baseValueId}:${i}`;
                  const count = outputCountByBaseKey.get(key) ?? 0;
                  outputCountByBaseKey.set(key, count + 1);

                  if (count === 0) {
                    removeFromQueue(baseValueId);
                    tracer.exitOperator(baseValueId, i, out.value, false, "expanded");
                    lastOutputMeta = baseMeta;
                    setIteratorMeta(this as any, baseMeta, i, opName);
                    return { done: false, value: wrapTracedValue(out.value, baseMeta) };
                  }

                  const expandedId = tracer.createExpandedTrace(baseValueId, i, opName, out.value);
                  lastOutputMeta = baseMeta;
                  setIteratorMeta(this as any, { ...baseMeta, valueId: expandedId }, i, opName);
                  return { done: false, value: wrapTracedValue(out.value, { ...baseMeta, valueId: expandedId }) };
                }

                // Expansion: outputs without new input
                if (requestBatch.length === 0) {
                  // Timer-based operators (debounce/throttle/audit/sample/etc.) can emit while downstream isn't
                  // actively awaiting `next()`. Those outputs are buffered and later observed with an empty
                  // `requestBatch`. In that case, attribute the output to pending inputs already pulled from `src`.
                  if (inputQueue.length > 0) {
                    // Prefer explicit iterator meta for collapse operators (buffer/bufferCount/toArray/etc.).
                    if (
                      Array.isArray(out.value) &&
                      outputMeta?.kind === "collapse" &&
                      Array.isArray(outputMeta.inputValueIds) &&
                      outputMeta.inputValueIds.length > 0
                    ) {
                      const targetId =
                        (typeof outputMeta.valueId === "string" && outputMeta.valueId) ||
                        outputMeta.inputValueIds[outputMeta.inputValueIds.length - 1];

                      if (typeof targetId === "string" && metaByValueId.has(targetId)) {
                        const targetMeta = metaByValueId.get(targetId)!;

                        for (const id of outputMeta.inputValueIds) {
                          if (id === targetId) continue;
                          if (!metaByValueId.has(id)) continue;
                          removeFromQueue(id);
                          tracer.collapseValue(id, i, opName, targetId, out.value);
                        }

                        removeFromQueue(targetId);
                        tracer.exitOperator(targetId, i, out.value, false, "collapsed");
                        lastOutputMeta = targetMeta;
                        setIteratorMeta(this as any, targetMeta, i, opName);
                        return { done: false, value: wrapTracedValue(out.value, targetMeta) };
                      }
                    }

                    const preferredId = outputMeta?.valueId;
                    const chosen =
                      (preferredId ? inputQueue.find((w) => w.meta.valueId === preferredId) : undefined) ??
                      // For pass-through operators, match by value if possible.
                      [...inputQueue].reverse().find((w) => Object.is(w.value, out.value)) ??
                      inputQueue[inputQueue.length - 1];

                    // For rate-limiting operators, non-emitted values are collapsed, not filtered
                    const isRateLimiter = opName === 'debounce' || opName === 'throttle' || opName === 'audit' || opName === 'sample';
                    
                    for (const pending of [...inputQueue]) {
                      if (pending.meta.valueId === chosen.meta.valueId) continue;
                      removeFromQueue(pending.meta.valueId);
                      if (isRateLimiter) {
                        tracer.collapseValue(pending.meta.valueId, i, opName, chosen.meta.valueId, out.value);
                      } else {
                        tracer.exitOperator(pending.meta.valueId, i, pending.value, true);
                      }
                    }

                    removeFromQueue(chosen.meta.valueId);
                    tracer.exitOperator(chosen.meta.valueId, i, out.value, false, isRateLimiter ? "collapsed" : "transformed");
                    lastOutputMeta = chosen.meta;
                    setIteratorMeta(this as any, chosen.meta, i, opName);
                    return { done: false, value: wrapTracedValue(out.value, chosen.meta) };
                  }

                  const baseValueId = outputMeta?.valueId ?? lastOutputMeta?.valueId ?? lastSeenMeta?.valueId;
                  const baseMeta = baseValueId ? metaByValueId.get(baseValueId) : undefined;
                  const meta = baseMeta ?? lastOutputMeta ?? lastSeenMeta;

                  if (baseValueId && meta) {
                    const key = `${baseValueId}:${i}`;
                    const count = outputCountByBaseKey.get(key) ?? 0;
                    outputCountByBaseKey.set(key, count + 1);

                    if (count === 0) {
                      lastOutputMeta = meta;
                      tracer.exitOperator(baseValueId, i, out.value, false, "expanded");
                      setIteratorMeta(this as any, meta, i, opName);
                      return { done: false, value: wrapTracedValue(out.value, meta) };
                    }

                    const expandedId = tracer.createExpandedTrace(baseValueId, i, opName, out.value);
                    lastOutputMeta = meta;
                    setIteratorMeta(this as any, meta, i, opName);
                    return { done: false, value: wrapTracedValue(out.value, { ...meta, valueId: expandedId }) };
                  }
                }

                // Multiple inputs, one output: filter vs collapse
                if (requestBatch.length > 1) {
                  const outputValueId = outputMeta?.valueId ?? requestBatch[requestBatch.length - 1].meta.valueId;
                  const outputEntry = requestBatch.find((w) => w.meta.valueId === outputValueId) ?? requestBatch[requestBatch.length - 1];
                  const isPassThrough = Object.is(out.value, outputEntry.value);

                  if (isPassThrough) {
                    // Filter others
                    for (const req of requestBatch) {
                      if (req.meta.valueId !== outputEntry.meta.valueId) {
                        removeFromQueue(req.meta.valueId);
                        tracer.exitOperator(req.meta.valueId, i, req.value, true);
                      }
                    }

                    removeFromQueue(outputEntry.meta.valueId);
                    tracer.exitOperator(outputEntry.meta.valueId, i, out.value, false, "transformed");
                    lastOutputMeta = outputEntry.meta;
                    setIteratorMeta(this as any, outputEntry.meta, i, opName);
                    return { done: false, value: wrapTracedValue(out.value, outputEntry.meta) };
                  }

                  // Collapse others
                  for (const req of requestBatch) {
                    if (req.meta.valueId !== outputEntry.meta.valueId) {
                      removeFromQueue(req.meta.valueId);
                      tracer.collapseValue(req.meta.valueId, i, opName, outputEntry.meta.valueId, out.value);
                    }
                  }

                  removeFromQueue(outputEntry.meta.valueId);
                  tracer.exitOperator(outputEntry.meta.valueId, i, out.value, false, "collapsed");
                  lastOutputMeta = outputEntry.meta;
                  setIteratorMeta(this as any, outputEntry.meta, i, opName);
                  return { done: false, value: wrapTracedValue(out.value, outputEntry.meta) };
                }

                // 1:1 transformation
                if (requestBatch.length === 1) {
                  const wrapped = requestBatch[0];
                  removeFromQueue(wrapped.meta.valueId);
                  tracer.exitOperator(wrapped.meta.valueId, i, out.value, false, "transformed");
                  lastOutputMeta = wrapped.meta;
                  setIteratorMeta(this as any, wrapped.meta, i, opName);
                  return { done: false, value: wrapTracedValue(out.value, wrapped.meta) };
                }

                // Fallback: use last output meta or pass-through
                if (lastOutputMeta) {
                  setIteratorMeta(this as any, lastOutputMeta, i, opName);
                  return { done: false, value: wrapTracedValue(out.value, lastOutputMeta) };
                }

                // Last resort: use lastSeenMeta if available
                if (lastSeenMeta) {
                  lastOutputMeta = lastSeenMeta;
                  setIteratorMeta(this as any, lastSeenMeta, i, opName);
                  return { done: false, value: wrapTracedValue(out.value, lastSeenMeta) };
                }

                // Truly last resort: unwrapped value (should rarely happen)
                // This means we lost track of the value's metadata somehow
                return { done: false, value: out.value };
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
            let valueId: string | undefined;
            let valueToCheck = r.value;
            let finalValue = r.value;
            
            // 1. Try wrapped value (tracer's own wrapping)
            if (isTracedValue(r.value)) {
              const wrapped = r.value as TracedWrapper<any>;
              valueId = wrapped.meta.valueId;
              finalValue = unwrapTracedValue(r.value);
              valueToCheck = finalValue;
            }
            
            // Unwrap primitives early so we can check metadata on the wrapper
            const unwrappedValue = unwrapPrimitive(valueToCheck);
            
            // 2. Try per-value metadata (attached by operators like debounce/throttle)
            // Check the wrapped version for metadata
            if (!valueId) {
              const valueMeta = getValueMeta(valueToCheck);
              if (valueMeta?.valueId) {
                valueId = valueMeta.valueId;
              }
            }
            
            // 3. Fall back to iterator metadata
            if (!valueId) {
              const meta = getIteratorMeta(it as any);
              if (meta?.valueId) {
                valueId = meta.valueId;
              }
            }
            
            // Mark as delivered if we found a valueId
            if (valueId) {
              tracer.markDelivered(valueId);
            }
            
            return { done: false, value: unwrappedValue };
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
