/** Internal runtime inspection types and the snapshot builder. Not exported from the package API. */
import type { FlowExecutionSnapshot, FlowExit, RuntimeNode, StreamixRuntime } from "./runtime";

/** Per-node diagnostics merged from the graph, the scheduler, and execution records. */
export interface NodeDiagnostics {
  /** The node these diagnostics describe. */
  readonly node: RuntimeNode;
  /** Label captured at execution start (operator name) or read from the node's `name` property. */
  readonly name?: string;
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
export function collectInspection(runtime: StreamixRuntime): RuntimeInspection {
  const identities = new Set<RuntimeNode>(runtime.graph.nodes());
  const records = new Map(runtime.executions.snapshotEntries().map(entry => [entry.node, entry]));
  for (const node of records.keys()) identities.add(node);

  const nodes: NodeDiagnostics[] = [];
  for (const node of identities) {
    const record = records.get(node);
    const schedulable = runtime.schedulableOf(node);
    nodes.push(Object.freeze({
      node,
      name: record?.name ?? nodeName(node),
      depth: schedulable?.depth,
      queued: schedulable?.queued === true,
      active: record?.active ?? false,
      runs: record?.runs ?? 0,
      emitted: record?.emitted ?? 0,
      lastExit: record?.lastExit,
      lastError: record?.lastError,
      dependencies: runtime.graph.dependencies(node).size,
      dependents: runtime.graph.dependents(node).size,
    }));
  }

  return Object.freeze({
    graph: Object.freeze({ nodes: runtime.graph.size }),
    scheduler: Object.freeze({
      pending: runtime.scheduling.scheduler.pending ?? 0,
      paused: runtime.scheduling.scheduler.isPaused === true,
      transactionDepth: runtime.scheduling.transactionDepth,
    }),
    executions: runtime.executions.snapshot(),
    nodes: Object.freeze(nodes),
  });
}
