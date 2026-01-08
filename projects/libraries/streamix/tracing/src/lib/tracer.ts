/**
 * Streamix tracing system (formal state machine, normalized outcomes).
 *
 * Key points:
 * - OperatorOutcome is the ONLY per-step outcome concept (no StepOutcome).
 * - Lifecycle is modeled by TraceStatus + TerminalReason (orthogonal to outcomes).
 * - A pure reducer enforces transitions and prevents invalid states.
 * - Backward-compatible public API: ValueTracer, ValueTrace, ValueState.
 * - Preserves test expectations:
 *   - createExpandedTrace works when base is missing (state === "expanded", operatorSteps[0] exists)
 *   - expanded children do NOT emit delivered events in createValueTracer
 *   - terminal tracer has operatorSteps empty but still emits filtered/collapsed/dropped
 */

import {
  createOperator,
  getIteratorMeta,
  registerRuntimeHooks,
  setIteratorMeta,
} from "@epikodelabs/streamix";

/* ============================================================================ */
/* PUBLIC TYPES (backward compatible) */
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

/** Single per-step outcome concept (as requested). */
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

export interface ValueTracer {
  subscribe: (handlers: TracerEventHandlers) => () => void;
  observeSubscription: (subId: string, handlers: TracerSubscriptionEventHandlers) => () => void;
  completeSubscription: (subId: string) => void;

  startTrace: (vId: string, sId: string, sName: string | undefined, subId: string, val: any) => ValueTrace;
  createExpandedTrace: (baseId: string, opIdx: number, opName: string, val: any) => string;

  enterOperator: (vId: string, opIdx: number, opName: string, val: any) => void;

  exitOperator: (
    vId: string,
    opIdx: number,
    val: any,
    filtered?: boolean,
    outcome?: OperatorOutcome
  ) => string | null;

  collapseValue: (vId: string, opIdx: number, opName: string, targetId: string, val?: any) => void;
  errorInOperator: (vId: string, opIdx: number, error: Error) => void;

  markDelivered: (vId: string) => void;

  getAllTraces: () => ValueTrace[];
  getStats: () => { total: number };
  clear: () => void;
}

/* ============================================================================ */
/* RUNTIME WRAPPER HELPERS (public) */
/* ============================================================================ */

const tracedValueBrand = Symbol("__streamix_traced__");
const TRACER_KEY = "__STREAMIX_GLOBAL_TRACER__";

export interface TracedWrapper<T> {
  [tracedValueBrand]: true;
  value: T;
  meta: { valueId: string; streamId: string; subscriptionId: string };
}

export const wrapTracedValue = <T>(value: T, meta: TracedWrapper<T>["meta"]): TracedWrapper<T> =>
  ({ [tracedValueBrand]: true, value, meta });

export const unwrapTracedValue = <T>(v: any): T => (v && v[tracedValueBrand]) ? v.value : v;

export const isTracedValue = (v: any): v is TracedWrapper<any> => !!(v && v[tracedValueBrand]);

export const getValueId = (v: any): string | undefined => isTracedValue(v) ? v.meta.valueId : undefined;

export const getGlobalTracer = (): ValueTracer | null => (globalThis as any)[TRACER_KEY] ?? null;

export function enableTracing(t: ValueTracer): void { (globalThis as any)[TRACER_KEY] = t; }

export function disableTracing(): void { (globalThis as any)[TRACER_KEY] = null; }

/* ============================================================================ */
/* IDS */
/* ============================================================================ */

const IDS_KEY = "__STREAMIX_TRACE_IDS__";
function getIds(): { value: number } {
  const g = globalThis as any;
  if (!g[IDS_KEY]) g[IDS_KEY] = { value: 0 };
  return g[IDS_KEY];
}

export function generateValueId(): string {
  return `val_${++getIds().value}`;
}

/* ============================================================================ */
/* NORMALIZED INTERNAL MODEL + STATE MACHINE */
/* ============================================================================ */

type TraceStatus = "active" | "delivered" | "terminal";
type SubscriptionState = "active" | "completed";

interface TraceRecord {
  valueId: string;

  streamId: string;
  streamName?: string;
  subscriptionId: string;

  emittedAt: number;
  deliveredAt?: number;

  status: TraceStatus;
  terminalReason?: TerminalReason;

  sourceValue: any;
  finalValue?: any;

  parentTraceId?: string;

  expandedFrom?: {
    operatorIndex: number;
    operatorName: string;
    baseValueId: string;
  };

  collapsedInto?: {
    operatorIndex: number;
    operatorName: string;
    targetValueId: string;
  };

  droppedReason?: {
    operatorIndex: number;
    operatorName: string;
    reason: TerminalReason;
    error?: Error;
  };

  operatorSteps: Array<{
    operatorIndex: number;
    operatorName: string;
    enteredAt: number;
    exitedAt?: number;
    outcome?: OperatorOutcome;
    inputValue: any;
    outputValue?: any;
    error?: Error;
  }>;

  operatorDurations: Map<string, number>;
  totalDuration?: number;
}

type TraceEvent =
  | { type: "ENTER_OP"; opIndex: number; opName: string; input: any; now: number }
  | { type: "EXIT_OP"; opIndex: number; output: any; outcome: OperatorOutcome; now: number; error?: Error }
  | { type: "TERMINALIZE"; reason: TerminalReason; opIndex: number; opName: string; now: number; error?: Error }
  | { type: "DELIVER"; now: number };

type EmitEvent = "delivered" | "filtered" | "collapsed" | "dropped" | "trace";

function assertInvariants(t: TraceRecord, policy: { deliverExpandedChildren: boolean }) {
  if (t.status === "terminal" && !t.terminalReason) {
    throw new Error("Invariant: terminal trace must have terminalReason");
  }
  if (t.status !== "terminal" && t.terminalReason) {
    throw new Error("Invariant: non-terminal trace must not have terminalReason");
  }
  if (t.status === "delivered" && !t.deliveredAt) {
    throw new Error("Invariant: delivered trace must have deliveredAt");
  }
  if (!policy.deliverExpandedChildren && t.parentTraceId && t.status === "delivered") {
    throw new Error("Invariant: expanded children must not be delivered (policy)");
  }
}

function reduceTrace(
  trace: TraceRecord,
  event: TraceEvent,
  policy: { deliverExpandedChildren: boolean }
): { trace: TraceRecord; emit: EmitEvent[]; lastStep?: TraceRecord["operatorSteps"][number] } {
  let t = trace;
  const emit: EmitEvent[] = [];

  const isTerminal = t.status === "terminal" || t.status === "delivered";

  switch (event.type) {
    case "ENTER_OP": {
      if (isTerminal) return { trace: t, emit };

      const step = {
        operatorIndex: event.opIndex,
        operatorName: event.opName,
        enteredAt: event.now,
        inputValue: event.input,
      };

      t = { ...t, operatorSteps: [...t.operatorSteps, step] };
      emit.push("trace");

      assertInvariants(t, policy);
      return { trace: t, emit, lastStep: step };
    }

    case "EXIT_OP": {
      if (isTerminal) return { trace: t, emit };

      const stepIndex = t.operatorSteps.findIndex(
        (s) => s.operatorIndex === event.opIndex && s.exitedAt == null
      );
      if (stepIndex === -1) return { trace: t, emit };

      const prev = t.operatorSteps[stepIndex];
      const updated = {
        ...prev,
        exitedAt: event.now,
        outcome: event.outcome,
        outputValue: event.output,
        error: event.error,
      };

      const operatorSteps = t.operatorSteps.slice();
      operatorSteps[stepIndex] = updated;

      t = { ...t, operatorSteps, finalValue: event.output };

      // Terminalize this trace on filtered/errored when it applies to THIS trace.
      if (event.outcome === "filtered") {
        t = { ...t, status: "terminal", terminalReason: "filtered" };
        emit.push("filtered");
      } else if (event.outcome === "errored") {
        t = { ...t, status: "terminal", terminalReason: "errored" };
        emit.push("dropped");
      }

      emit.push("trace");
      assertInvariants(t, policy);
      return { trace: t, emit, lastStep: updated };
    }

    case "TERMINALIZE": {
      if (isTerminal) return { trace: t, emit };

      t = {
        ...t,
        status: "terminal",
        terminalReason: event.reason,
        droppedReason: {
          operatorIndex: event.opIndex,
          operatorName: event.opName,
          reason: event.reason,
          error: event.error,
        },
      };

      if (event.reason === "filtered") emit.push("filtered");
      else if (event.reason === "collapsed") emit.push("collapsed");
      else emit.push("dropped");

      emit.push("trace");
      assertInvariants(t, policy);
      return { trace: t, emit };
    }

    case "DELIVER": {
      if (isTerminal) return { trace: t, emit };

      // policy: do not deliver expanded children (still trace them)
      if (t.parentTraceId && !policy.deliverExpandedChildren) {
        emit.push("trace");
        assertInvariants(t, policy);
        return { trace: t, emit };
      }

      t = {
        ...t,
        status: "delivered",
        deliveredAt: event.now,
        totalDuration: event.now - t.emittedAt,
      };

      emit.push("delivered", "trace");
      assertInvariants(t, policy);
      return { trace: t, emit };
    }
  }
}

function toValueState(t: TraceRecord): ValueState {
  if (t.status === "delivered") return "delivered";

  if (t.status === "terminal") {
    switch (t.terminalReason) {
      case "filtered":
        return "filtered";
      case "collapsed":
        return "collapsed";
      case "errored":
        return "errored";
      case "late":
        return "dropped";
    }
  }

  // active
  if (t.parentTraceId) return "expanded";
  if (t.operatorSteps.length > 0) return "transformed";
  return "emitted";
}

function exportTrace(t: TraceRecord): ValueTrace {
  return {
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

    operatorSteps: t.operatorSteps.map((s) => ({
      operatorIndex: s.operatorIndex,
      operatorName: s.operatorName,
      enteredAt: s.enteredAt,
      exitedAt: s.exitedAt,
      outcome: s.outcome,
      inputValue: s.inputValue,
      outputValue: s.outputValue,
      error: s.error,
    })),

    droppedReason: t.droppedReason,
    collapsedInto: t.collapsedInto,
    expandedFrom: t.expandedFrom,

    totalDuration: t.totalDuration,
    operatorDurations: t.operatorDurations,
  };
}

function defaultOpName(opIdx: number) {
  return `op${opIdx}`;
}

/* ============================================================================ */
/* VALUE TRACER (full steps) */
/* ============================================================================ */

export function createValueTracer(options: ValueTracerOptions = {}): ValueTracer {
  const { maxTraces = 10_000, onTraceUpdate } = options;

  const traces = new Map<string, TraceRecord>();

  const subscribers: TracerEventHandlers[] = [];
  const subscriptionSubscribers = new Map<string, Set<TracerSubscriptionEventHandlers>>();
  const subscriptionStates = new Map<string, SubscriptionState>();

  // Policy required by your tests: do not count delivered for expanded children
  const policy = { deliverExpandedChildren: false };

  const isCompleted = (subId: string) => subscriptionStates.get(subId) === "completed";

  const notify = (event: keyof TracerEventHandlers, trace: ValueTrace) => {
    for (const s of subscribers) s[event]?.(trace);
    subscriptionSubscribers.get(trace.subscriptionId)?.forEach((s) => s[event]?.(trace));
  };

  const retain = (valueId: string, trace: TraceRecord) => {
    traces.set(valueId, trace);
    if (traces.size > maxTraces) {
      const oldestKey = traces.keys().next().value;
      if (oldestKey !== undefined) traces.delete(oldestKey);
    }
  };

  return {
    subscribe(h) {
      subscribers.push(h);
      return () => {
        const i = subscribers.indexOf(h);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },

    observeSubscription(id, h) {
      if (!subscriptionSubscribers.has(id)) subscriptionSubscribers.set(id, new Set());
      subscriptionSubscribers.get(id)!.add(h);
      return () => subscriptionSubscribers.get(id)?.delete(h);
    },

    completeSubscription(subId) {
      if (subscriptionStates.get(subId) === "completed") return;
      subscriptionStates.set(subId, "completed");
      subscriptionSubscribers.get(subId)?.forEach((s) => s.complete?.());
      subscriptionSubscribers.delete(subId);
    },

    startTrace(valueId, streamId, streamName, subId, value) {
      if (!subscriptionStates.has(subId)) subscriptionStates.set(subId, "active");

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

      retain(valueId, record);

      // If subscription already completed, mark as late drop
      if (isCompleted(subId)) {
        const { trace: next, emit } = reduceTrace(
          record,
          { type: "TERMINALIZE", reason: "late", opIndex: -1, opName: "subscription", now },
          policy
        );
        retain(valueId, next);
        const ex = exportTrace(next);
        if (emit.includes("dropped")) notify("dropped", ex);
        onTraceUpdate?.(ex);
        return ex;
      }

      const exported = exportTrace(record);
      onTraceUpdate?.(exported);
      return exported;
    },

    /**
     * Must work even if base trace is missing:
     * - creates an expanded trace with operatorSteps length 1
     * - streamId/subId = "unknown" when base missing
     * - state === "expanded" via parentTraceId
     */
    createExpandedTrace(baseId, opIdx, opName, value) {
      const now = Date.now();
      const base = traces.get(baseId);
      const valueId = generateValueId();

      if (!base) {
        const synthetic: TraceRecord = {
          valueId,
          parentTraceId: baseId,
          streamId: "unknown",
          streamName: undefined,
          subscriptionId: "unknown",
          emittedAt: now,
          status: "active",
          sourceValue: value,
          finalValue: value,
          operatorSteps: [
            {
              operatorIndex: opIdx,
              operatorName: opName,
              enteredAt: now,
              exitedAt: now,
              outcome: "expanded",
              inputValue: undefined,
              outputValue: value,
            },
          ],
          operatorDurations: new Map(),
          expandedFrom: { operatorIndex: opIdx, operatorName: opName, baseValueId: baseId },
        };

        retain(valueId, synthetic);
        onTraceUpdate?.(exportTrace(synthetic));
        return valueId;
      }

      // For real child: copy steps (for UI continuity), attach lineage.
      const child: TraceRecord = {
        valueId,
        parentTraceId: baseId,
        streamId: base.streamId,
        streamName: base.streamName,
        subscriptionId: base.subscriptionId,
        emittedAt: base.emittedAt,
        status: "active",
        sourceValue: base.sourceValue,
        finalValue: value,
        operatorSteps: base.operatorSteps.map((s) => ({ ...s })),
        operatorDurations: new Map(),
        expandedFrom: { operatorIndex: opIdx, operatorName: opName, baseValueId: baseId },
      };

      retain(valueId, child);
      onTraceUpdate?.(exportTrace(child));
      return valueId;
    },

    enterOperator(vId, opIdx, opName, val) {
      const t = traces.get(vId);
      if (!t) return;
      if (isCompleted(t.subscriptionId)) return;
      if (t.status !== "active") return;

      const { trace: next, emit, lastStep } = reduceTrace(
        t,
        { type: "ENTER_OP", opIndex: opIdx, opName, input: val, now: Date.now() },
        policy
      );

      retain(vId, next);

      if (emit.includes("trace")) {
        const ex = exportTrace(next);
        onTraceUpdate?.(ex, lastStep
          ? {
              operatorIndex: lastStep.operatorIndex,
              operatorName: lastStep.operatorName,
              enteredAt: lastStep.enteredAt,
              exitedAt: lastStep.exitedAt,
              outcome: lastStep.outcome,
              inputValue: lastStep.inputValue,
              outputValue: lastStep.outputValue,
              error: lastStep.error,
            }
          : undefined);
      }
    },

    exitOperator(vId, opIdx, val, filtered = false, outcome = "transformed") {
      const t = traces.get(vId);
      if (!t) return null;

      const hasOpenStep = t.operatorSteps.some(
        (s) => s.operatorIndex === opIdx && s.exitedAt == null
      );
      if (!hasOpenStep) {
        return null;
      }

      if (isCompleted(t.subscriptionId)) {
        // late drop
        const now = Date.now();
        const { trace: next, emit } = reduceTrace(
          t,
          { type: "TERMINALIZE", reason: "late", opIndex: opIdx, opName: defaultOpName(opIdx), now },
          policy
        );
        retain(vId, next);
        const ex = exportTrace(next);
        if (emit.includes("dropped")) notify("dropped", ex);
        onTraceUpdate?.(ex);
        return null;
      }

      const out: OperatorOutcome = filtered ? "filtered" : outcome;

      const { trace: next, emit, lastStep } = reduceTrace(
        t,
        { type: "EXIT_OP", opIndex: opIdx, output: val, outcome: out, now: Date.now() },
        policy
      );

      // For filtered, ensure droppedReason is populated in legacy shape (tests inspect reason)
      if (next.status === "terminal" && next.terminalReason === "filtered") {
        next.droppedReason = {
          operatorIndex: opIdx,
          operatorName: lastStep?.operatorName ?? defaultOpName(opIdx),
          reason: "filtered",
        };
      }

      // For collapsed/expanded/transformed we don't terminalize here (except filtered/errored),
      // because collapse of non-anchors is handled via collapseValue(), expansion via createExpandedTrace().

      retain(vId, next);

      const ex = exportTrace(next);

      if (emit.includes("filtered")) notify("filtered", ex);
      if (emit.includes("collapsed")) notify("collapsed", ex);
      if (emit.includes("dropped")) notify("dropped", ex);

      onTraceUpdate?.(ex, lastStep
        ? {
            operatorIndex: lastStep.operatorIndex,
            operatorName: lastStep.operatorName,
            enteredAt: lastStep.enteredAt,
            exitedAt: lastStep.exitedAt,
            outcome: lastStep.outcome,
            inputValue: lastStep.inputValue,
            outputValue: lastStep.outputValue,
            error: lastStep.error,
          }
        : undefined);

      return vId;
    },

    collapseValue(vId, opIdx, opName, targetId, _val) {
      const t = traces.get(vId);
      if (!t) return;

      if (isCompleted(t.subscriptionId)) {
        // late drop
        const now = Date.now();
        const { trace: next, emit } = reduceTrace(
          t,
          { type: "TERMINALIZE", reason: "late", opIndex: opIdx, opName, now },
          policy
        );
        retain(vId, next);
        const ex = exportTrace(next);
        if (emit.includes("dropped")) notify("dropped", ex);
        onTraceUpdate?.(ex);
        return;
      }

      // Terminalize as collapsed
      t.collapsedInto = {
        operatorIndex: opIdx,
        operatorName: opName,
        targetValueId: targetId,
      };

      const { trace: next, emit } = reduceTrace(
        t,
        { type: "TERMINALIZE", reason: "collapsed", opIndex: opIdx, opName, now: Date.now() },
        policy
      );

      retain(vId, next);
      const ex = exportTrace(next);

      if (emit.includes("collapsed")) notify("collapsed", ex);
      onTraceUpdate?.(ex);
    },

    errorInOperator(vId, opIdx, error) {
      const t = traces.get(vId);
      if (!t) return;

      // try to stamp operatorName from step if available
      const opName =
        t.operatorSteps.find((s) => s.operatorIndex === opIdx)?.operatorName ?? defaultOpName(opIdx);

      const { trace: next, emit } = reduceTrace(
        t,
        { type: "TERMINALIZE", reason: "errored", opIndex: opIdx, opName, now: Date.now(), error },
        policy
      );

      // keep legacy state "errored" but notifications treat it as dropped
      retain(vId, next);

      const ex = exportTrace(next);
      if (emit.includes("dropped")) notify("dropped", ex);
      onTraceUpdate?.(ex);
    },

    markDelivered(vId) {
      const t = traces.get(vId);
      if (!t) return;
      if (isCompleted(t.subscriptionId)) return;

      const { trace: next, emit } = reduceTrace(t, { type: "DELIVER", now: Date.now() }, policy);
      retain(vId, next);

      const ex = exportTrace(next);
      if (emit.includes("delivered")) notify("delivered", ex);
      onTraceUpdate?.(ex);
    },

    getAllTraces() {
      return Array.from(traces.values()).map(exportTrace);
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
}

/* ============================================================================ */
/* TERMINAL TRACER (no operatorSteps, but terminal state/events must be emitted) */
/* ============================================================================ */

export function createTerminalTracer(options: ValueTracerOptions = {}): ValueTracer {
  const { maxTraces = 10_000, onTraceUpdate } = options;

  const traces = new Map<string, TraceRecord>();

  const subscribers: TracerEventHandlers[] = [];
  const subscriptionSubscribers = new Map<string, Set<TracerSubscriptionEventHandlers>>();
  const subscriptionStates = new Map<string, SubscriptionState>();

  // Terminal tracer: still do not deliver expanded children (safe default)
  const policy = { deliverExpandedChildren: false };

  const isCompleted = (subId: string) => subscriptionStates.get(subId) === "completed";

  const notify = (event: keyof TracerEventHandlers, trace: ValueTrace) => {
    for (const s of subscribers) s[event]?.(trace);
    subscriptionSubscribers.get(trace.subscriptionId)?.forEach((s) => s[event]?.(trace));
  };

  const retain = (valueId: string, trace: TraceRecord) => {
    traces.set(valueId, trace);
    if (traces.size > maxTraces) {
      const oldestKey = traces.keys().next().value;
      if (oldestKey !== undefined) traces.delete(oldestKey);
    }
  };

  const exportTerminalTrace = (t: TraceRecord): ValueTrace => {
    // Ensure empty operatorSteps (this is what your tests assert)
    const ex = exportTrace(t);
    ex.operatorSteps = [];
    return ex;
  };

  return {
    subscribe(h) {
      subscribers.push(h);
      return () => {
        const i = subscribers.indexOf(h);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },

    observeSubscription(id, h) {
      if (!subscriptionSubscribers.has(id)) subscriptionSubscribers.set(id, new Set());
      subscriptionSubscribers.get(id)!.add(h);
      return () => subscriptionSubscribers.get(id)?.delete(h);
    },

    completeSubscription(subId) {
      subscriptionStates.set(subId, "completed");
      subscriptionSubscribers.get(subId)?.forEach((s) => s.complete?.());
      subscriptionSubscribers.delete(subId);
    },

    startTrace(valueId, streamId, streamName, subId, value) {
      if (!subscriptionStates.has(subId)) subscriptionStates.set(subId, "active");

      const now = Date.now();

      const record: TraceRecord = {
        valueId,
        streamId,
        streamName,
        subscriptionId: subId,
        emittedAt: now,
        status: "active",
        sourceValue: value,
        operatorSteps: [], // always empty
        operatorDurations: new Map(),
      };

      retain(valueId, record);

      if (isCompleted(subId)) {
        const { trace: next, emit } = reduceTrace(
          record,
          { type: "TERMINALIZE", reason: "late", opIndex: -1, opName: "subscription", now },
          policy
        );
        retain(valueId, next);
        const ex = exportTerminalTrace(next);
        if (emit.includes("dropped")) notify("dropped", ex);
        onTraceUpdate?.(ex);
        return ex;
      }

      const exported = exportTerminalTrace(record);
      onTraceUpdate?.(exported);
      return exported;
    },

    createExpandedTrace(baseId, opIdx, opName, value) {
      const now = Date.now();
      const base = traces.get(baseId);
      const valueId = generateValueId();

      // Always create trace even if base missing
      const record: TraceRecord = {
        valueId,
        parentTraceId: baseId,
        streamId: base?.streamId ?? "unknown",
        streamName: base?.streamName,
        subscriptionId: base?.subscriptionId ?? "unknown",
        emittedAt: base?.emittedAt ?? now,
        status: "active",
        sourceValue: base?.sourceValue ?? value,
        finalValue: value,
        operatorSteps: [], // terminal tracer => empty
        operatorDurations: new Map(),
        expandedFrom: { operatorIndex: opIdx, operatorName: opName, baseValueId: baseId },
      };

      retain(valueId, record);
      onTraceUpdate?.(exportTerminalTrace(record));
      return valueId;
    },

    // terminal tracer does not record operator steps
    enterOperator() {},

    exitOperator(vId, opIdx, _val, filtered = false) {
      const t = traces.get(vId);
      if (!t) return null;
      if (isCompleted(t.subscriptionId)) return null;
      if (t.status !== "active") return vId;

      if (filtered) {
        const { trace: next, emit } = reduceTrace(
          t,
          { type: "TERMINALIZE", reason: "filtered", opIndex: opIdx, opName: defaultOpName(opIdx), now: Date.now() },
          policy
        );
        retain(vId, next);
        const ex = exportTerminalTrace(next);
        if (emit.includes("filtered")) notify("filtered", ex);
        onTraceUpdate?.(ex);
        return vId;
      }

      // transformed/expanded/collapsed are handled elsewhere; terminal tracer cares about terminal states
      return vId;
    },

    collapseValue(vId, opIdx, opName, targetId) {
      const t = traces.get(vId);
      if (!t) return;
      if (isCompleted(t.subscriptionId)) return;

      t.collapsedInto = { operatorIndex: opIdx, operatorName: opName, targetValueId: targetId };

      const { trace: next, emit } = reduceTrace(
        t,
        { type: "TERMINALIZE", reason: "collapsed", opIndex: opIdx, opName, now: Date.now() },
        policy
      );

      retain(vId, next);
      const ex = exportTerminalTrace(next);
      if (emit.includes("collapsed")) notify("collapsed", ex);
      onTraceUpdate?.(ex);
    },

    errorInOperator(vId, opIdx, error) {
      const t = traces.get(vId);
      if (!t) return;

      const { trace: next, emit } = reduceTrace(
        t,
        { type: "TERMINALIZE", reason: "errored", opIndex: opIdx, opName: defaultOpName(opIdx), now: Date.now(), error },
        policy
      );

      retain(vId, next);
      const ex = exportTerminalTrace(next);
      if (emit.includes("dropped")) notify("dropped", ex);
      onTraceUpdate?.(ex);
    },

    markDelivered(vId) {
      const t = traces.get(vId);
      if (!t) return;
      if (isCompleted(t.subscriptionId)) return;

      const { trace: next, emit } = reduceTrace(t, { type: "DELIVER", now: Date.now() }, policy);
      retain(vId, next);

      const ex = exportTerminalTrace(next);
      if (emit.includes("delivered")) notify("delivered", ex);
      onTraceUpdate?.(ex);
    },

    getAllTraces() {
      return Array.from(traces.values()).map(exportTerminalTrace);
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
}

/* ============================================================================ */
/* RUNTIME HOOKS */
/* ============================================================================ */

registerRuntimeHooks({
  onPipeStream({ streamId, streamName, subscriptionId, parentValueId, source, operators }) {
    const tracer = getGlobalTracer();
    if (!tracer) return;

    return {
      source: {
        /**
         * Wrap source emissions into TracedWrapper values and start traces.
         * If inside inner stream, reuse parentValueId as base.
         */
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
                  while (inputQueue.length > 0) {
                    const wrapped = inputQueue.shift()!;
                    tracer.exitOperator(wrapped.meta.valueId, i, wrapped.value, true);
                  }
                  return out;
                }

                const outputMeta = getIteratorMeta(inner as any) as any;
                if (outputMeta?.valueId) {
                  setIteratorMeta(this as any, { valueId: outputMeta.valueId }, outputMeta.operatorIndex, outputMeta.operatorName);
                }

                // Collapse: array output from multiple sequential inputs (strict batch-size rule)
                if (Array.isArray(out.value) && requestBatch.length > 1) {
                  const batchSize = out.value.length;
                  if (batchSize > 0 && requestBatch.length === batchSize) {
                    const batch = requestBatch;
                    const target = batch[batch.length - 1];

                    for (let j = 0; j < batch.length - 1; j += 1) {
                      removeFromQueue(batch[j].meta.valueId);
                      tracer.collapseValue(batch[j].meta.valueId, i, opName, target.meta.valueId, out.value);
                    }

                    removeFromQueue(target.meta.valueId);
                    tracer.exitOperator(target.meta.valueId, i, out.value, false, "collapsed");
                    lastOutputMeta = target.meta;
                    setIteratorMeta(this as any, target.meta, i, opName);

                    return { done: false, value: wrapTracedValue(out.value, target.meta) };
                  }
                }

                // Prefer runtime-provided output valueId when available
                if (outputMeta?.valueId && metaByValueId.has(outputMeta.valueId)) {
                  const baseValueId = outputMeta.valueId as string;
                  const baseMeta = metaByValueId.get(baseValueId)!;

                  // Filter: multiple requests, pass-through output from one of them
                  if (requestBatch.length > 1) {
                    const baseRequested = requestBatch.find((w) => w.meta.valueId === baseValueId);
                    const isPassThrough = baseRequested ? Object.is(out.value, baseRequested.value) : false;

                    if (isPassThrough) {
                      for (const requested of requestBatch) {
                        if (requested.meta.valueId === baseValueId) continue;
                        removeFromQueue(requested.meta.valueId);
                        tracer.exitOperator(requested.meta.valueId, i, requested.value, true);
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
                  return { done: false, value: wrapTracedValue(out.value, { ...baseMeta, valueId: expandedId }) };
                }

                // Expansion: additional outputs without requesting new input
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
                    const count = outputCountByBaseKey.get(key) ?? 0;
                    outputCountByBaseKey.set(key, count + 1);

                    if (count === 0) {
                      lastOutputMeta = baseMeta;
                      tracer.exitOperator(baseValueId, i, out.value, false, "expanded");
                      return { done: false, value: wrapTracedValue(out.value, baseMeta) };
                    }

                    const expandedId = tracer.createExpandedTrace(baseValueId, i, opName, out.value);
                    lastOutputMeta = baseMeta;
                    return { done: false, value: wrapTracedValue(out.value, { ...baseMeta, valueId: expandedId }) };
                  }
                }

                // Filter vs collapse: multiple inputs requested before one output
                if (requestBatch.length > 1) {
                  const outputValueId: string =
                    outputMeta?.valueId ?? requestBatch[requestBatch.length - 1].meta.valueId;

                  const outputEntry =
                    requestBatch.find((w) => w.meta.valueId === outputValueId) ??
                    requestBatch[requestBatch.length - 1];

                  const isPassThrough = Object.is(out.value, outputEntry.value);

                  if (isPassThrough) {
                    for (const requested of requestBatch) {
                      if (requested.meta.valueId === outputEntry.meta.valueId) continue;
                      removeFromQueue(requested.meta.valueId);
                      tracer.exitOperator(requested.meta.valueId, i, requested.value, true);
                    }

                    removeFromQueue(outputEntry.meta.valueId);
                    tracer.exitOperator(outputEntry.meta.valueId, i, out.value, false, "transformed");
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

                // Regular 1:1 transformation
                if (requestBatch.length === 1) {
                  const wrapped = requestBatch[0];
                  removeFromQueue(wrapped.meta.valueId);
                  tracer.exitOperator(wrapped.meta.valueId, i, out.value, false, "transformed");
                  lastOutputMeta = wrapped.meta;
                  return { done: false, value: wrapTracedValue(out.value, wrapped.meta) };
                }

                if (lastOutputMeta) {
                  return { done: false, value: wrapTracedValue(out.value, lastOutputMeta) };
                }

                return { done: false, value: out.value };
              } catch (e) {
                // Mark error on first pending value
                if (inputQueue.length > 0) {
                  tracer.errorInOperator(inputQueue[0].meta.valueId, i, e as Error);
                }
                throw e;
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
        },
      }),
    };
  },
});
