/** Internal process-local execution registry. Not exported from the package API. */
export type RuntimeNode = object;
export type RuntimeEvent = Readonly<{
  sequence: number;
  kind: "register" | "dependencies" | "dispose";
  node: RuntimeNode;
}>;

export class RuntimeGraph {
  private readonly upstream = new Map<RuntimeNode, Set<RuntimeNode>>();
  private readonly downstream = new Map<RuntimeNode, Set<RuntimeNode>>();

  register(node: RuntimeNode): void {
    if (!this.upstream.has(node)) this.upstream.set(node, new Set());
  }

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

export class StreamixRuntime {
  readonly scheduling: RuntimeScheduling = runtimeScheduling;
  readonly graph = new RuntimeGraph();
  readonly root = Object.freeze({ type: "root" as const });
  private sequence = 0;
  private readonly observers = new Set<(event: RuntimeEvent) => void>();

  register(node: RuntimeNode): void {
    this.graph.register(node);
    this.emit("register", node);
  }
  dependencies(node: RuntimeNode, sources: Iterable<RuntimeNode>): void {
    this.graph.replace(node, sources);
    this.emit("dependencies", node);
  }
  dispose(node: RuntimeNode): void {
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
