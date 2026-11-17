/** Internal marker used by sequence-backed atoms whose iteration keeps only the latest pending value. */
export const ANALOG_DELIVERY = Symbol("streamix.delivery.analog");

/** Internal producer completion channel, independent of atom disposal. */
export interface ProducerCompletion {
  readonly completed: boolean;
  onComplete(listener: () => void): () => void;
  onDispose?(listener: () => void): () => void;
}

class CompletionSlot implements ProducerCompletion {
  constructor(private readonly atom: object) {}
  private source?: ProducerCompletion;
  private unsubscribe?: () => void;
  private readonly listeners = new Set<() => void>();

  get completed(): boolean { return this.source?.completed ?? false; }

  onDispose(listener: () => void): () => void {
    const handlers = (this.atom as { _onDispose?: Set<() => void> })._onDispose;
    handlers?.add(listener);
    return () => { handlers?.delete(listener); };
  }

  onComplete(listener: () => void): () => void {
    if (this.completed) { try { listener(); } catch {} }
    else this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  bind(source: ProducerCompletion): void {
    this.unsubscribe?.();
    this.source = source;
    this.unsubscribe = source.onComplete(() => {
      for (const listener of [...this.listeners]) {
        try { listener(); } catch { /* Completion observers cannot strand cleanup. */ }
      }
      this.listeners.clear();
    });
  }
}

// Scope registration can observe completion before a source adapter is bound.
// Weak ownership keeps that registration independent of construction order.
const completionSlots = new WeakMap<object, CompletionSlot>();

export function getProducerCompletion(source: unknown): ProducerCompletion | undefined {
  if (source === null || (typeof source !== "object" && typeof source !== "function")) return undefined;
  let slot = completionSlots.get(source);
  if (!slot) {
    slot = new CompletionSlot(source);
    completionSlots.set(source, slot);
  }
  return slot;
}

export function bindProducerCompletion(atom: object, source: ProducerCompletion): void {
  getProducerCompletion(atom);
  completionSlots.get(atom)!.bind(source);
}

export function forwardProducerCompletion(view: object, source: object): void {
  getProducerCompletion(source);
  completionSlots.set(view, completionSlots.get(source)!);
}
