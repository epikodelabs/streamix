/** Internal source pull ownership. One outstanding pull per source slot. */
export class RuntimeSourcePulls<T> {
  private readonly slots = new Map<number, { source: AsyncIterator<T>; generation: number; pulling: boolean; terminal: boolean }>();
  private nextGeneration = 0;
  private closed = false;

  attach(index: number, source: AsyncIterator<T>): void {
    if (this.closed) throw new Error("Source execution already closed");
    this.slots.set(index, { source, generation: ++this.nextGeneration, pulling: false, terminal: false });
  }

  detach(index: number): void { this.slots.delete(index); }

  /** Request another pull. A busy slot coalesces requests rather than pulling concurrently. */
  request(index: number, deliver: (result: IteratorResult<T>) => void, fail: (error: unknown) => void): void {
    const slot = this.slots.get(index);
    if (!slot || this.closed || slot.terminal) return;
    if (slot.pulling) return;
    slot.pulling = true;
    const generation = slot.generation;
    let pending: Promise<IteratorResult<T>>;
    try { pending = Promise.resolve(slot.source.next()); }
    catch (error) { pending = Promise.reject(error); }
    pending.then(result => {
      if (this.closed || this.slots.get(index) !== slot || slot.generation !== generation) return;
      slot.pulling = false;
      if (result.done) slot.terminal = true;
      deliver(result);
    }, error => {
      if (this.closed || this.slots.get(index) !== slot || slot.generation !== generation) return;
      slot.pulling = false;
      slot.terminal = true;
      fail(error);
    });
  }

  isPulling(index: number): boolean { return this.slots.get(index)?.pulling ?? false; }
  close(): void { this.closed = true; this.slots.clear(); }
}
