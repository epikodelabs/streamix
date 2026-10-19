/** Internal, synchronous runtime event bus. Never exposed by public-api.ts. */
import type { RuntimeNode } from "./runtime";

/**
 * Every event the runtime puts on the bus, in one stream:
 * - graph lifecycle: register, dependencies, change, flow, dispose
 * - execution lifecycle: next, complete, cancel, error
 * - coordinator source transport and devtools traces reuse the same
 *   delivery guarantees; `label` marks events that have no runtime node.
 */
export type RuntimeEventKind =
  | "register" | "dependencies" | "change" | "flow" | "dispose"
  | "next" | "complete" | "cancel" | "error"
  | "read" | "write" | "render" | "subscription" | "unsubscribe";

export interface RuntimeEvent {
  readonly sequence: number;
  readonly kind: RuntimeEventKind;
  readonly node: RuntimeNode;
  /** Execution token; events without one come from the graph or a trace. */
  readonly generation?: number;
  readonly pullMs?: number;
  readonly value?: unknown;
  readonly error?: unknown;
  /** Human-readable source for events that describe no runtime node. */
  readonly label?: string;
}

/**
 * FIFO, reentrancy-safe event delivery. A listener may publish another event,
 * but the current event is delivered to every listener before the next begins.
 * Listener exceptions cannot corrupt execution or strand the queue.
 * Publishing while unobserved costs one set-size check: no event is built or
 * queued, so production flows pay nothing per emission.
 */
export class RuntimeEventBus {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly queue: RuntimeEvent[] = [];
  private draining = false;
  private sequence = 0;

  observe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  get observed(): boolean { return this.listeners.size > 0; }

  publish(event: Omit<RuntimeEvent, "sequence">): void {
    if (this.listeners.size === 0) return;
    this.queue.push({ ...event, sequence: ++this.sequence });
    if (this.draining) return;
    this.draining = true;
    try {
      for (let index = 0; index < this.queue.length; index++) {
        const next = this.queue[index];
        for (const listener of [...this.listeners]) {
          if (!this.listeners.has(listener)) continue;
          try { listener(next); } catch { /* diagnostics must not break producers */ }
        }
      }
    } finally {
      this.queue.length = 0;
      this.draining = false;
    }
  }
}
