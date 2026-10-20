/**
 * Runtime diagnostics: execution accounting, per-node self-description, and
 * the frozen snapshot builder. All state here is diagnostics-only — the
 * reactive core never reads it. Not exported from the package API.
 */
import type { RuntimeGraph, RuntimeNode, StreamixRuntime } from "./runtime";
import type { RuntimeEventBus } from "./events";
import type { RuntimeOrigin } from "./origin";
import type { SchedulableNode } from "./scheduling";

/**
 * Execution accounting and per-node state readers are diagnostics-only. Dev
 * builds default to on; production bundles start with capture off and never
 * pay for a record, a counter, or a state-reader closure. Tests and tooling
 * may toggle the flag explicitly, mirroring {@link setOriginCapture}.
 */
let instrumentationEnabled = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

/** Enable or disable execution accounting and node state capture. */
export function setRuntimeInstrumentationEnabled(next: boolean): void {
  instrumentationEnabled = next;
}

/** True while execution accounting and node state capture are recorded. */
export function isRuntimeInstrumentationEnabled(): boolean {
  return instrumentationEnabled;
}

/** Exit kind of a finished execution. */
export type FlowExit = "complete" | "cancel" | "error";

export interface FlowExecutionSnapshot {
  readonly active: number;
  readonly started: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly failed: number;
  readonly emitted: number;
}

/** Frozen per-node view of execution accounting, for diagnostics consumers. */
export interface ExecutionRecordSnapshot {
  readonly node: RuntimeNode;
  readonly name?: string;
  readonly origin?: RuntimeOrigin;
  readonly active: boolean;
  readonly runs: number;
  readonly emitted: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly errors: number;
  readonly lastExit?: FlowExit;
  readonly lastError?: unknown;
  /** Error of the current or most recently finished run; cleared on restart. */
  readonly error?: unknown;
}

interface ExecutionRecord {
  name?: string;
  origin?: RuntimeOrigin;
  runs: number;
  emitted: number;
  completed: number;
  cancelled: number;
  errors: number;
  lastExit?: FlowExit;
  lastError?: unknown;
  error?: unknown;
}

export class RuntimeExecutions {
  private readonly active = new Map<RuntimeNode, number>();
  private readonly records = new Map<RuntimeNode, ExecutionRecord>();
  private generation = 0;
  private started = 0;
  private completed = 0;
  private cancelled = 0;
  private failed = 0;
  private emitted = 0;

  /** A token prevents a late previous execution from closing a newer one. */
  start(node: RuntimeNode, name?: string, origin?: RuntimeOrigin): number {
    if (!instrumentationEnabled) return 0;
    const previous = this.active.get(node);
    if (previous !== undefined) this.finish(node, previous, "cancel");
    const token = ++this.generation;
    this.active.set(node, token);
    let record = this.records.get(node);
    if (!record) {
      record = { runs: 0, emitted: 0, completed: 0, cancelled: 0, errors: 0 };
      this.records.set(node, record);
    }
    if (name !== undefined) record.name = name;
    if (origin !== undefined) record.origin = origin;
    record.error = undefined;
    record.runs++;
    this.started++;
    return token;
  }

  /** Token of the execution currently active for a node, when accounting tracks one. */
  activeTokenOf(node: RuntimeNode): number | undefined {
    return this.active.get(node);
  }

  next(node: RuntimeNode, token: number): void {
    if (!instrumentationEnabled) return;
    if (this.active.get(node) !== token) return;
    this.emitted++;
    const record = this.records.get(node);
    if (record) record.emitted++;
  }

  finish(node: RuntimeNode, token: number, exit: FlowExit, error?: unknown): void {
    // Still release an execution that was active when capture was disabled,
    // so the active map never strands a node after a mid-flight toggle.
    if (!instrumentationEnabled) {
      if (this.active.get(node) === token) this.active.delete(node);
      return;
    }
    if (this.active.get(node) !== token) return;
    this.active.delete(node);
    if (exit === "complete") this.completed++;
    else if (exit === "cancel") this.cancelled++;
    else this.failed++;
    const record = this.records.get(node);
    if (record) {
      if (exit === "complete") record.completed++;
      else if (exit === "cancel") record.cancelled++;
      else record.errors++;
      record.lastExit = exit;
      record.error = exit === "error" ? error : undefined;
      if (exit === "error" && error !== undefined) record.lastError = error;
    }
  }

  describe(node: RuntimeNode): ExecutionRecordSnapshot | undefined {
    const record = this.records.get(node);
    if (!record) return undefined;
    return this.freezeRecord(node, record);
  }

  /** All execution records; the union with graph nodes forms the diagnostics node set. */
  snapshotEntries(): ExecutionRecordSnapshot[] {
    return Array.from(this.records.entries(), ([node, record]) => this.freezeRecord(node, record));
  }

  /** Drop the diagnostics record. Active executions keep their own lifecycle. */
  forget(node: RuntimeNode): void {
    this.records.delete(node);
  }

  private freezeRecord(node: RuntimeNode, record: ExecutionRecord): ExecutionRecordSnapshot {
    return Object.freeze({
      node,
      name: record.name,
      ...(record.origin ? { origin: record.origin } : {}),
      active: this.active.has(node),
      runs: record.runs,
      emitted: record.emitted,
      completed: record.completed,
      cancelled: record.cancelled,
      errors: record.errors,
      lastExit: record.lastExit,
      lastError: record.lastError,
      ...(record.error !== undefined ? { error: record.error } : {}),
    });
  }

  snapshot(): FlowExecutionSnapshot {
    return Object.freeze({
      active: this.active.size, started: this.started,
      completed: this.completed, cancelled: this.cancelled,
      failed: this.failed, emitted: this.emitted,
    });
  }
}

/** Producer state read without subscribing, pulling, or evaluating a formula. */
export interface FlowDiagnosticsState {
  readonly started: boolean;
  readonly awaitingNext: boolean;
  readonly subscribers: number;
  readonly hasValue: boolean;
  readonly value: unknown;
}

interface AtomStateReader {
  hasValue: boolean;
  value: unknown;
  subscribers: number;
  error: unknown;
}

/**
 * All diagnostics-only runtime state: origins, per-node state readers, and
 * execution records. Owns no reactive behavior — disposing the runtime must
 * stay correct with this whole class removed.
 */
export class RuntimeDiagnostics {
  private readonly origins = new WeakMap<RuntimeNode, RuntimeOrigin>();
  private readonly atomStates = new WeakMap<RuntimeNode, () => AtomStateReader>();
  private readonly flowStates = new Map<RuntimeNode, () => FlowDiagnosticsState>();
  private readonly flowNodes = new WeakSet<RuntimeNode>();
  readonly executions = new RuntimeExecutions();

  constructor(private readonly events: RuntimeEventBus) {}

  /** Record the creation site of a node, captured in dev builds. */
  captureOrigin(node: RuntimeNode, origin: RuntimeOrigin): void {
    this.origins.set(node, origin);
  }

  /** The creation-site position of a node, when captured in a dev build. */
  originOf(node: RuntimeNode): RuntimeOrigin | undefined {
    return this.origins.get(node);
  }

  registerAtomState(node: RuntimeNode, read: () => AtomStateReader): void {
    if (!instrumentationEnabled) return;
    this.atomStates.set(node, read);
  }

  atomState(node: RuntimeNode) { return this.atomStates.get(node)?.(); }

  /** Record a flow-backed atom's identity. Unconditional: the graph 'change'
   * dedupe in `changed()` must not depend on instrumentation being enabled. */
  markFlowNode(node: RuntimeNode): void {
    this.flowNodes.add(node);
  }

  /** Register a flow-backed atom independently of its execution starting. */
  registerFlow(node: RuntimeNode, state: () => FlowDiagnosticsState): void {
    if (!instrumentationEnabled) return;
    this.flowStates.set(node, state);
    this.events.publish({ kind: "flow", node });
  }

  flowState(node: RuntimeNode): FlowDiagnosticsState | undefined {
    const state = this.flowStates.get(node)?.();
    return state ? Object.freeze({ ...state }) : undefined;
  }

  /** True when the node is a flow-backed atom (used to dedupe emissions). */
  hasFlow(node: RuntimeNode): boolean {
    return this.flowNodes.has(node);
  }

  /** Live flows, including idle and recoverably failed producers; disposed flows are removed. */
  flows(graph: RuntimeGraph) {
    return Object.freeze(Array.from(this.flowStates, ([node, read]) => Object.freeze({
      node, ...read(), origin: this.origins.get(node), execution: this.executions.describe(node),
      dependencies: Object.freeze([...graph.dependencies(node)]),
      dependents: Object.freeze([...graph.dependents(node)]),
    })));
  }

  /** Drop per-node diagnostics state; called by the runtime's dispose. */
  dispose(node: RuntimeNode): void {
    this.flowStates.delete(node);
    this.executions.forget(node);
  }

  /** One frozen snapshot of graph, scheduler, transaction, and execution state. */
  inspect(runtime: StreamixRuntime) {
    return collectInspection(runtime, this);
  }
}

/** Per-node diagnostics merged from the graph, the scheduler, and execution records. */
export interface NodeDiagnostics {
  /** The node these diagnostics describe. */
  readonly node: RuntimeNode;
  /** Label captured at execution start (operator name) or read from the node's `name` property. */
  readonly name?: string;
  /** Creation site of the node, captured automatically in dev builds. */
  readonly origin?: RuntimeOrigin;
  /** Scheduler depth (shallow dependencies first). Present only for schedulable nodes. */
  readonly depth?: number;
  /** True when invalidation work is queued but not flushed yet. */
  readonly queued: boolean;
  /** True while an execution started by this node is still running. */
  readonly active: boolean;
  /** Number of executions started by this node since registration. */
  readonly runs: number;
  /** Values emitted across all executions of this node. */
  readonly emitted: number;
  /** Executions of this node that completed since registration. */
  readonly completed: number;
  /** Executions of this node cancelled since registration. */
  readonly cancelled: number;
  /** Executions of this node that failed since registration. */
  readonly errors: number;
  /** Exit kind of the most recently finished execution. */
  readonly lastExit?: FlowExit;
  /** Error captured by the most recently failed execution, if any. */
  readonly lastError?: unknown;
  /** Current upstream dependency count from the graph. */
  readonly dependencies: number;
  /** Current downstream dependent count from the graph. */
  readonly dependents: number;
}

/** One frozen introspection snapshot of the whole runtime. */
export interface RuntimeInspection {
  readonly graph: { readonly nodes: number };
  readonly scheduler: {
    readonly pending: number;
    readonly paused: boolean;
    readonly transactionDepth: number;
  };
  readonly executions: FlowExecutionSnapshot;
  readonly nodes: readonly NodeDiagnostics[];
}

function nodeName(node: RuntimeNode): string | undefined {
  const name = (node as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/** Build one frozen diagnostics snapshot from the runtime's current state. */
export function collectInspection(runtime: StreamixRuntime, diagnostics: RuntimeDiagnostics): RuntimeInspection {
  const identities = new Set<RuntimeNode>(runtime.graph.nodes());
  const records = new Map(diagnostics.executions.snapshotEntries().map(entry => [entry.node, entry]));
  for (const node of records.keys()) identities.add(node);

  const nodes: NodeDiagnostics[] = [];
  for (const node of identities) {
    const record = records.get(node);
    const schedulable = runtime.schedulableOf(node) as SchedulableNode | undefined;
    nodes.push(Object.freeze({
      node,
      name: record?.name ?? nodeName(node),
      origin: record?.origin ?? diagnostics.originOf(node),
      depth: schedulable?.depth,
      queued: schedulable?.queued === true,
      active: record?.active ?? false,
      runs: record?.runs ?? 0,
      emitted: record?.emitted ?? 0,
      completed: record?.completed ?? 0,
      cancelled: record?.cancelled ?? 0,
      errors: record?.errors ?? 0,
      lastExit: record?.lastExit,
      lastError: record?.lastError,
      dependencies: runtime.graph.dependencyCount(node),
      dependents: runtime.graph.dependentCount(node),
    }));
  }

  return Object.freeze({
    graph: Object.freeze({ nodes: runtime.graph.size }),
    scheduler: Object.freeze({
      pending: runtime.scheduling.scheduler.pending ?? 0,
      paused: runtime.scheduling.scheduler.isPaused === true,
      transactionDepth: runtime.scheduling.transactionDepth,
    }),
    executions: diagnostics.executions.snapshot(),
    nodes: Object.freeze(nodes),
  });
}
