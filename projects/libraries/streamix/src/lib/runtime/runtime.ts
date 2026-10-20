/** Internal process-local reactive core: graph, scheduling, invalidation, and the event bus. */
import { runtimeScheduling, RuntimeScheduling, type SchedulableNode } from "./scheduling";
import { RuntimeEventBus } from "./events";
import { RuntimeDiagnostics, isRuntimeInstrumentationEnabled, type FlowExit } from "./diagnostics";
import type { RuntimeOrigin } from "./origin";

export type RuntimeNode = object;
export type { RuntimeEvent, RuntimeEventKind, RuntimeEventBus } from "./events";

/** One live execution observed by diagnostics: accounting plus bus events. */
export interface ExecutionSpan {
  /** True when execution events are published on the bus; callers may skip timing work otherwise. */
  readonly reports: boolean;
  /** Records one emitted value. `requestedAt` is the pull-start `performance.now()` timestamp. */
  next(value: unknown, requestedAt?: number): void;
  /** Closes the execution: the token is retired and the exit event published. */
  finish(exit: FlowExit, error?: unknown): void;
}

const INACTIVE_EXECUTION: ExecutionSpan = { reports: false, next() {}, finish() {} };

export class StreamixRuntime {
  readonly graph = new RuntimeGraph();
  readonly events = new RuntimeEventBus();
  /** Diagnostics-only state; the reactive core never reads it. */
  readonly diagnostics = new RuntimeDiagnostics(this.events);
  readonly root = Object.freeze({ type: "root" as const });
  private readonly invalidators = new Map<RuntimeNode, () => void>();
  private readonly schedulables = new WeakMap<RuntimeNode, SchedulableNode>();

  constructor(readonly scheduling: RuntimeScheduling = new RuntimeScheduling()) {}

  /** Register a node, optionally linking its scheduler state and creation site for diagnostics. */
  register(node: RuntimeNode, schedulable?: SchedulableNode, origin?: RuntimeOrigin): void {
    this.graph.register(node);
    if (schedulable) this.schedulables.set(node, schedulable);
    if (origin) this.diagnostics.captureOrigin(node, origin);
    this.events.publish({ kind: "register", node });
  }

  /** The scheduler-owned state of a node, when it has one. */
  schedulableOf(node: RuntimeNode): SchedulableNode | undefined {
    return this.schedulables.get(node);
  }

  dependencies(node: RuntimeNode, sources: Iterable<RuntimeNode>): void {
    this.graph.replace(node, sources);
    this.events.publish({ kind: "dependencies", node });
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
    // Flows report emissions as execution 'next' events; the valueless graph
    // 'change' would double-count each emission in diagnostics consumers.
    if (this.events.observed && !this.diagnostics.hasFlow(source)) {
      this.events.publish({ kind: "change", node: source });
    }
    // Iterate the live downstream set: every dependent runs an idempotent
    // invalidation, so visiting an entry added mid-broadcast is harmless, and
    // Set iteration skips entries an earlier invalidation removed. This saves
    // the snapshot allocation `dependents()` would make on every write.
    this.graph.forEachDependent(source, dependent => {
      // Edges may be replaced during an earlier invalidation.
      if (!this.graph.hasDependency(dependent, source)) return;
      this.invalidators.get(dependent)?.();
    });
  }

  dispose(node: RuntimeNode): void {
    this.diagnostics.dispose(node);
    this.invalidators.delete(node);
    this.graph.remove(node);
    this.events.publish({ kind: "dispose", node });
  }

  /**
   * Opens one execution of a node: accounting token, bus events, or neither.
   * Returns a shared no-op span when instrumentation is off and the bus is
   * unobserved, so an unobserved production emission allocates nothing.
   */
  beginExecution(node: RuntimeNode, name?: string, origin?: RuntimeOrigin): ExecutionSpan {
    const accounting = isRuntimeInstrumentationEnabled();
    if (!accounting && !this.events.observed) return INACTIVE_EXECUTION;
    const observed = this.events.observed;
    // Accounting auto-finishes a displaced execution as 'cancel'; publish the
    // matching terminal event so the trace never disagrees with the record.
    const displaced = accounting ? this.diagnostics.executions.activeTokenOf(node) : undefined;
    const token = accounting ? this.diagnostics.executions.start(node, name, origin) : 0;
    if (displaced !== undefined && observed) {
      this.events.publish({ node, generation: displaced, kind: "cancel" });
    }
    const executions = this.diagnostics.executions;
    const events = this.events;
    return {
      reports: observed,
      next(value: unknown, requestedAt?: number): void {
        if (accounting) executions.next(node, token);
        if (observed) events.publish({ node, generation: token, kind: "next", value,
          ...(requestedAt !== undefined ? { pullMs: Math.max(0, performance.now() - requestedAt) } : {}) });
      },
      finish(exit: FlowExit, error?: unknown): void {
        if (accounting) executions.finish(node, token, exit, exit === "error" ? error : undefined);
        if (observed) events.publish({ node, generation: token, kind: exit, ...(exit === "error" ? { error } : {}) });
      },
    };
  }
}

/**
 * Upstream/downstream edges between runtime nodes, with cycle rejection.
 * Kept local to the core: diagnostics reads it, nothing else writes it.
 */
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

  hasDependency(node: RuntimeNode, source: RuntimeNode): boolean { return this.upstream.get(node)?.has(source) ?? false; }
  dependencyCount(node: RuntimeNode): number { return this.upstream.get(node)?.size ?? 0; }
  dependentCount(node: RuntimeNode): number { return this.downstream.get(node)?.size ?? 0; }

  dependencies(node: RuntimeNode): ReadonlySet<RuntimeNode> { return new Set(this.upstream.get(node) ?? []); }
  /** Snapshot copy; read-only consumers iterate safely outside invalidation. */
  dependents(node: RuntimeNode): ReadonlySet<RuntimeNode> { return new Set(this.downstream.get(node) ?? []); }

  /** Visit downstream nodes without allocating a snapshot; safe under mid-iteration edge replacement. */
  forEachDependent(node: RuntimeNode, visit: (dependent: RuntimeNode) => void): void {
    const users = this.downstream.get(node);
    if (!users) return;
    for (const dependent of users) visit(dependent);
  }
  nodes(): IterableIterator<RuntimeNode> { return this.upstream.keys(); }
  get size(): number { return this.upstream.size; }
}

/** Shared internally; intentionally absent from public-api.ts. */
export const internalRuntime = new StreamixRuntime(runtimeScheduling);
