/** Internal process-local execution registry. Not exported from the package API. */
export type RuntimeNode = object;
export type RuntimeEvent = Readonly<{
  sequence: number;
  kind: "register" | "dependencies" | "dispose" | "change";
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
  get size(): number { return this.upstream.size; }
}

import { runtimeScheduling, type RuntimeScheduling } from "./scheduling";
import { RuntimeEventDispatcher } from "./events";

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

export class RuntimeExecutions {
  private readonly active = new Map<RuntimeNode, number>();
  private generation = 0;
  private started = 0;
  private completed = 0;
  private cancelled = 0;
  private failed = 0;
  private emitted = 0;

  /** A token prevents a late previous execution from closing a newer one. */
  start(node: RuntimeNode): number {
    const token = ++this.generation;
    this.active.set(node, token);
    this.started++;
    return token;
  }

  next(node: RuntimeNode, token: number): void {
    if (this.active.get(node) === token) this.emitted++;
  }

  finish(node: RuntimeNode, token: number, exit: FlowExit): void {
    if (this.active.get(node) !== token) return;
    this.active.delete(node);
    if (exit === "complete") this.completed++;
    else if (exit === "cancel") this.cancelled++;
    else this.failed++;
  }

  snapshot(): FlowExecutionSnapshot {
    return Object.freeze({
      active: this.active.size, started: this.started,
      completed: this.completed, cancelled: this.cancelled,
      failed: this.failed, emitted: this.emitted,
    });
  }
}

export class StreamixRuntime {
  readonly scheduling: RuntimeScheduling = runtimeScheduling;
  readonly graph = new RuntimeGraph();
  readonly events = new RuntimeEventDispatcher();
  readonly executions = new RuntimeExecutions();
  readonly root = Object.freeze({ type: "root" as const });
  private sequence = 0;
  private readonly invalidators = new Map<RuntimeNode, () => void>();
  private readonly observers = new Set<(event: RuntimeEvent) => void>();

  register(node: RuntimeNode): void {
    this.graph.register(node);
    this.emit("register", node);
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
    this.invalidators.delete(node);
    this.graph.remove(node);
    this.emit("dispose", node);
  }
  observe(callback: (event: RuntimeEvent) => void): () => void {
    this.observers.add(callback);
    return () => { this.observers.delete(callback); };
  }
  private emit(kind: RuntimeEvent["kind"], node: RuntimeNode): void {
    if (!this.observers.size) return;
    const event = { kind, node, sequence: ++this.sequence };
    for (const observer of [...this.observers]) observer(event);
  }
}

/** Shared internally; intentionally absent from public-api.ts. */
export const internalRuntime = new StreamixRuntime();
