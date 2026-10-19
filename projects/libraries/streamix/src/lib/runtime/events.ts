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
 * Publishing while unobserved costs one set-size check: no event is built or
 * queued, so production flows pay nothing per emission.
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

  get observed(): boolean { return this.listeners.size > 0; }

  publish(event: Omit<ExecutionEvent, 'sequence'>): void {
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
