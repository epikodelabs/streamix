/** Internal process-local execution registry. Not exported from the package API. */
export type RuntimeNode = object;
export type RuntimeEvent = Readonly<{
  sequence: number;
  kind: "register" | "dependencies" | "dispose" | "change" | "flow";
  node: RuntimeNode;
}>;

export class RuntimeGraph {
  private readonly upstream = new Map<RuntimeNode, Set<RuntimeNode>>();
  private readonly downstream = new Map<RuntimeNode, Set<RuntimeNode>>();

  register(node: RuntimeNode): void {
    if (!this.upstream.has(node)) this.upstream.set(node, new Set());
  }

  has(node: RuntimeNode): boolean { return this.upstream.has(node); }

  /** Replace dependency edges, including removal of stale dynamic dependencies. */
  replace(node: RuntimeNode, sources: Iterable<RuntimeNode>): void {
    this.register(node);
    const next = new Set(sources);
    if (next.has(node)) throw new Error("Streamix: self-dependency detected");
    for (const source of next) {
      if (this.reaches(node, source)) throw new Error("Streamix: cyclic reactive dependency");
    }
    const previous = this.upstream.get(node)!;
    for (const source of previous) {
      if (!next.has(source)) {
        const users = this.downstream.get(source);
        users?.delete(node);
        if (users?.size === 0) this.downstream.delete(source);
      }
    }
    for (const source of next) {
      if (!previous.has(source)) {
        let users = this.downstream.get(source);
        if (!users) this.downstream.set(source, users = new Set());
        users.add(node);
      }
    }
    this.upstream.set(node, next);
  }

  private reaches(start: RuntimeNode, target: RuntimeNode): boolean {
    const seen = new Set<RuntimeNode>();
    const pending = [start];
    while (pending.length) {
      const node = pending.pop()!;
      if (node === target) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const dependent of this.downstream.get(node) ?? []) pending.push(dependent);
    }
    return false;
  }

  remove(node: RuntimeNode): void {
    for (const source of this.upstream.get(node) ?? []) {
      const users = this.downstream.get(source);
      users?.delete(node);
      if (users?.size === 0) this.downstream.delete(source);
    }
    for (const dependent of this.downstream.get(node) ?? []) this.upstream.get(dependent)?.delete(node);
    this.upstream.delete(node);
    this.downstream.delete(node);
  }

  dependencies(node: RuntimeNode): ReadonlySet<RuntimeNode> { return new Set(this.upstream.get(node) ?? []); }
  dependents(node: RuntimeNode): ReadonlySet<RuntimeNode> { return new Set(this.downstream.get(node) ?? []); }
  nodes(): IterableIterator<RuntimeNode> { return this.upstream.keys(); }
  get size(): number { return this.upstream.size; }
}

import { runtimeScheduling, type RuntimeScheduling, type SchedulableNode } from "./scheduling";
import { RuntimeEventDispatcher } from "./events";
import { collectInspection, type RuntimeInspection } from "./diagnostics";
import type { RuntimeOrigin } from "./origin";

/** Execution accounting is internal: a flow has one producer shared by its subscribers. */
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
  readonly lastExit?: FlowExit;
  readonly lastError?: unknown;
}

interface ExecutionRecord {
  name?: string;
  origin?: RuntimeOrigin;
  runs: number;
  emitted: number;
  lastExit?: FlowExit;
  lastError?: unknown;
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
    const token = ++this.generation;
    this.active.set(node, token);
    let record = this.records.get(node);
    if (!record) {
      record = { runs: 0, emitted: 0 };
      this.records.set(node, record);
    }
    if (name !== undefined) record.name = name;
    if (origin !== undefined) record.origin = origin;
    record.runs++;
    this.started++;
    return token;
  }

  next(node: RuntimeNode, token: number): void {
    if (this.active.get(node) !== token) return;
    this.emitted++;
    const record = this.records.get(node);
    if (record) record.emitted++;
  }

  finish(node: RuntimeNode, token: number, exit: FlowExit, error?: unknown): void {
    if (this.active.get(node) !== token) return;
    this.active.delete(node);
    if (exit === "complete") this.completed++;
    else if (exit === "cancel") this.cancelled++;
    else this.failed++;
    const record = this.records.get(node);
    if (record) {
      record.lastExit = exit;
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
      lastExit: record.lastExit,
      lastError: record.lastError,
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

export class StreamixRuntime {
  private readonly atomStates = new WeakMap<RuntimeNode, () => { hasValue: boolean; value: unknown; subscribers: number; error: unknown }>();
  registerAtomState(node: RuntimeNode, read: () => { hasValue: boolean; value: unknown; subscribers: number; error: unknown }): void {
    this.atomStates.set(node, read);
  }
  atomState(node: RuntimeNode) { return this.atomStates.get(node)?.(); }
  readonly scheduling: RuntimeScheduling = runtimeScheduling;
  readonly graph = new RuntimeGraph();
  readonly events = new RuntimeEventDispatcher();
  readonly executions = new RuntimeExecutions();
  readonly root = Object.freeze({ type: "root" as const });
  private readonly flowStates = new Map<RuntimeNode, () => FlowDiagnosticsState>();
  private sequence = 0;
  private readonly invalidators = new Map<RuntimeNode, () => void>();
  private readonly schedulables = new WeakMap<RuntimeNode, SchedulableNode>();
  private readonly origins = new WeakMap<RuntimeNode, RuntimeOrigin>();
  private readonly observers = new Set<(event: RuntimeEvent) => void>();

  /** Register a node, optionally linking its scheduler state and creation site for diagnostics. */
  register(node: RuntimeNode, schedulable?: SchedulableNode, origin?: RuntimeOrigin): void {
    this.graph.register(node);
    if (schedulable) this.schedulables.set(node, schedulable);
    if (origin) this.origins.set(node, origin);
    this.emit("register", node);
  }

  /** The creation-site position of a node, when captured in a dev build. */
  originOf(node: RuntimeNode): RuntimeOrigin | undefined {
    return this.origins.get(node);
  }

  /** Register a flow-backed atom independently of its execution starting. */
  registerFlow(node: RuntimeNode, state: () => FlowDiagnosticsState): void {
    this.flowStates.set(node, state);
    this.emit("flow", node);
  }

  flowState(node: RuntimeNode): FlowDiagnosticsState | undefined {
    const state = this.flowStates.get(node)?.();
    return state ? Object.freeze({ ...state }) : undefined;
  }

  /** Live flows, including idle and recoverably failed producers; disposed flows are removed. */
  flows() {
    return Object.freeze(Array.from(this.flowStates, ([node, read]) => Object.freeze({
      node, ...read(), origin: this.origins.get(node), execution: this.executions.describe(node),
      dependencies: Object.freeze([...this.graph.dependencies(node)]),
      dependents: Object.freeze([...this.graph.dependents(node)]),
    })));
  }

  /** The scheduler-owned state of a node, when it has one. */
  schedulableOf(node: RuntimeNode): SchedulableNode | undefined {
    return this.schedulables.get(node);
  }
  dependencies(node: RuntimeNode, sources: Iterable<RuntimeNode>): void {
    this.graph.replace(node, sources);
    this.emit("dependencies", node);
  }
  /** Register a graph-managed derived invalidator, not a public subscription. */
  onInvalidate(node: RuntimeNode, invalidate: () => void): () => void {
    this.invalidators.set(node, invalidate);
    return () => {
      if (this.invalidators.get(node) === invalidate) this.invalidators.delete(node);
    };
  }

  /** Publish a committed value change to current graph dependents. */
  changed(source: RuntimeNode): void {
    this.emit("change", source);
    for (const dependent of [...this.graph.dependents(source)]) {
      // Edges may be replaced during an earlier invalidation.
      if (!this.graph.dependencies(dependent).has(source)) continue;
      this.invalidators.get(dependent)?.();
    }
  }

  dispose(node: RuntimeNode): void {
    this.flowStates.delete(node);
    this.invalidators.delete(node);
    this.executions.forget(node);
    this.graph.remove(node);
    this.emit("dispose", node);
  }

  /** One frozen snapshot of graph, scheduler, transaction, and execution state. */
  inspect(): RuntimeInspection {
    return collectInspection(this);
  }

  observe(callback: (event: RuntimeEvent) => void): () => void {
    this.observers.add(callback);
    return () => { this.observers.delete(callback); };
  }
  private emit(kind: RuntimeEvent["kind"], node: RuntimeNode): void {
    if (!this.observers.size) return;
    const event = { kind, node, sequence: ++this.sequence };
    for (const observer of [...this.observers]) {
      if (!this.observers.has(observer)) continue;
      try { observer(event); } catch { /* diagnostics must not break propagation */ }
    }
  }
}

/** Shared internally; intentionally absent from public-api.ts. */
export const internalRuntime = new StreamixRuntime();
