/** Internal, synchronous runtime event dispatch. Never exposed by public-api.ts. */
export type ExecutionEventKind = 'next' | 'complete' | 'cancel' | 'error';
export interface ExecutionEvent {
  readonly sequence: number;
  readonly node: object;
  readonly generation: number;
  readonly kind: ExecutionEventKind;
  readonly value?: unknown;
  readonly error?: unknown;
}

/**
 * FIFO, reentrancy-safe event delivery. A listener may publish another event,
 * but the current event is delivered to every listener before the next begins.
 * Listener exceptions cannot corrupt execution or strand the queue.
 */
export class RuntimeEventDispatcher {
  private readonly listeners = new Set<(event: ExecutionEvent) => void>();
  private readonly queue: ExecutionEvent[] = [];
  private draining = false;
  private sequence = 0;

  observe(listener: (event: ExecutionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  publish(event: Omit<ExecutionEvent, 'sequence'>): void {
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
