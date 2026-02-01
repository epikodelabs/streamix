/**
 * Full-fidelity value tracer implementation.
 *
 * This tracer records complete operator steps, durations, and state transitions.
 * Intended for development, debugging, and inspection tools.
 *
 * Usage:
 * ```ts
 * import { createValueTracer } from './streamix-tracer';
 * import { enableTracing } from './streamix-trace-core';
 *
 * const tracer = createValueTracer({
 *   maxTraces: 10_000,
 *   onTraceUpdate: (trace, step) => {
 *     console.log('Trace updated:', trace.valueId, trace.state);
 *   }
 * });
 *
 * enableTracing(tracer);
 *
 * // Subscribe to events
 * tracer.subscribe({
 *   delivered: (trace) => console.log('Value delivered:', trace.valueId),
 *   filtered: (trace) => console.log('Value filtered:', trace.valueId),
 * });
 * ```
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
  onTraceUpdate?: (trace: ValueTrace, step?: ValueTrace["operatorSteps"][number]) => void;
}

/**
 * Extended tracer interface that includes subscription and utility methods.
 * This extends the base ValueTracer interface with implementation-specific features.
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

const unwrapForExport = (value: any): any => unwrapPrimitive(unwrapTracedValue(value));

const exportTrace = (t: TraceRecord): ValueTrace => ({
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
  operatorSteps: t.operatorSteps.map((s) => ({
    ...s,
    inputValue: unwrapForExport(s.inputValue),
    outputValue: s.outputValue !== undefined ? unwrapForExport(s.outputValue) : undefined,
  })),
  droppedReason: t.droppedReason,
  collapsedInto: t.collapsedInto,
  expandedFrom: t.expandedFrom,
  totalDuration: t.totalDuration,
  operatorDurations: new Map(t.operatorDurations),
});

const defaultOpName = (opIdx: number): string => `op${opIdx}`;

/* ============================================================================ */
/* TRACER IMPLEMENTATION */
/* ============================================================================ */

interface TracerConfig {
  readonly includeSteps: boolean;
  readonly policy: TracerPolicy;
}

const createTracerImpl = (
  config: TracerConfig,
  options: ValueTracerOptions = {}
): ExtendedValueTracer => {
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

    createExpandedTrace(baseId: string, opIdx: number, opName: string, value: any): string {
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

    enterOperator(vId: string, opIdx: number, opName: string, val: any): void {
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

    exitOperator(vId: string, opIdx: number, val: any, filtered: boolean = false, outcome: OperatorOutcome = "transformed"): string | null {
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

    collapseValue(vId: string, opIdx: number, opName: string, targetId: string, _val?: any): void {
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

    errorInOperator(vId: string, opIdx: number, error: Error): void {
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

    markDelivered(vId: string): void {
      const trace = traces.get(vId);
      if (!trace || isCompleted(trace.subscriptionId)) return;

      const result = reduceTrace(trace, { type: "DELIVER", now: Date.now() }, policy);
      processEvents(vId, result);
    },

    getAllTraces(): ValueTrace[] {
      return Array.from(traces.values()).map((t) =>
        includeSteps ? exportTrace(t) : { ...exportTrace(t), operatorSteps: [] }
      );
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

/* ============================================================================ */
/* PUBLIC FACTORY FUNCTIONS */
/* ============================================================================ */

/**
 * Creates a full-fidelity tracer intended for development/inspection.
 *
 * - Records operator steps (`operatorSteps`) and durations (`operatorDurations`).
 * - Exports step data to `onTraceUpdate` and `getAllTraces`.
 */
export const createValueTracer = (options?: ValueTracerOptions): ExtendedValueTracer =>
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
export const createTerminalTracer = (options?: ValueTracerOptions): ExtendedValueTracer =>
  createTracerImpl(
    {
      includeSteps: false,
      policy: { deliverExpandedChildren: true },
    },
    options
  );