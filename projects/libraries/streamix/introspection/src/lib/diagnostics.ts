/**
 * Runtime diagnostics: execution accounting, per-node self-description, and
 * the frozen snapshot builder. All state here is diagnostics-only — the
 * reactive core never reads it. This module ships in the introspection entry:
 * until that entry is imported, the core runs with a no-op port and none of
 * this code is downloaded. The shared flag and snapshot types live in the
 * core (`runtime.ts`) so both sides compile against one shape.
 */
import {
  isRuntimeInstrumentationEnabled,
  setRuntimeInstrumentationEnabled,
  installRuntimeDiagnostics,
  __streamixRuntime,
  type RuntimeGraph,
  type RuntimeNode,
  type StreamixRuntime,
  type RuntimeEventBus,
  type RuntimeOrigin,
  type SchedulableNode,
  type FlowExit,
  type FlowExecutionSnapshot,
  type ExecutionRecordSnapshot,
  type FlowDiagnosticsState,
  type AtomStateReader,
  type NodeDiagnostics,
  type RuntimeInspection,
  type RuntimeDiagnosticsPort,
} from "@epikodelabs/streamix";

export { setRuntimeInstrumentationEnabled, isRuntimeInstrumentationEnabled };

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
    if (!isRuntimeInstrumentationEnabled()) return 0;
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
    if (!isRuntimeInstrumentationEnabled()) return;
    if (this.active.get(node) !== token) return;
    this.emitted++;
    const record = this.records.get(node);
    if (record) record.emitted++;
  }

  finish(node: RuntimeNode, token: number, exit: FlowExit, error?: unknown): void {
    // Still release an execution that was active when capture was disabled,
    // so the active map never strands a node after a mid-flight toggle.
    if (!isRuntimeInstrumentationEnabled()) {
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

/**
 * All diagnostics-only runtime state: origins, per-node state readers, and
 * execution records. Owns no reactive behavior — disposing the runtime must
 * stay correct with this whole class removed. Installed as the runtime's
 * diagnostics port by this entry's index module.
 */
export class RuntimeDiagnostics implements RuntimeDiagnosticsPort {
  private readonly origins = new WeakMap<RuntimeNode, RuntimeOrigin>();
  private readonly atomStates = new WeakMap<RuntimeNode, () => AtomStateReader>();
  private readonly flowStates = new Map<RuntimeNode, () => FlowDiagnosticsState>();
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
    if (!isRuntimeInstrumentationEnabled()) return;
    this.atomStates.set(node, read);
  }

  atomState(node: RuntimeNode) { return this.atomStates.get(node)?.(); }

  /** Register a flow-backed atom independently of its execution starting. */
  registerFlow(node: RuntimeNode, state: () => FlowDiagnosticsState): void {
    if (!isRuntimeInstrumentationEnabled()) return;
    this.flowStates.set(node, state);
    this.events.publish({ kind: "flow", node });
  }

  flowState(node: RuntimeNode): FlowDiagnosticsState | undefined {
    const state = this.flowStates.get(node)?.();
    return state ? Object.freeze({ ...state }) : undefined;
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
  inspect(runtime: StreamixRuntime): RuntimeInspection {
    return collectInspection(runtime, this);
  }
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

// Self-install: evaluating this module swaps the core's no-op diagnostics
// port for the real ledger. Lives at module scope (not in the entry facade)
// because bundlers may flatten re-export facades and skip their side effects.
installRuntimeDiagnostics(new RuntimeDiagnostics(__streamixRuntime.events));
