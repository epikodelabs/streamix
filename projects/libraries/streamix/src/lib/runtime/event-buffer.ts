/** Internal FIFO event buffering and consumer demand for source coordinators. */
export class RuntimeEventBuffer<T> {
  private readonly queued: Array<{ sourceIndex: number; result: IteratorResult<T> }> = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;
  private terminalResult: IteratorResult<T> | undefined;

  enqueue(sourceIndex: number, result: IteratorResult<T>): void {
    if (this.closed || this.terminalResult) return;
    this.queued.push({ sourceIndex, result });
  }

  /** Deliver queued events to pending consumers without overtaking earlier demand. */
  flush(done: boolean, terminal: IteratorResult<T>): void {
    while (this.waiters.length && this.queued.length) {
      this.waiters.shift()!(this.queued.shift()!.result);
    }
    if (done) this.terminalResult = terminal;
    if (done && this.queued.length === 0) {
      while (this.waiters.length) this.waiters.shift()!(terminal);
    }
  }

  take(): IteratorResult<T> | undefined {
    return this.queued.shift()?.result;
  }

  wait(): Promise<IteratorResult<T>> {
    if (this.closed) throw new Error('Cannot wait on a closed event buffer');
    // Demand registered after an event was buffered must consume that event,
    // including when upstream has already completed. Never strand late demand.
    if (this.queued.length > 0) return Promise.resolve(this.queued.shift()!.result);
    if (this.terminalResult) return Promise.resolve(this.terminalResult);
    return new Promise(resolve => this.waiters.push(resolve));
  }

  removeSource(sourceIndex: number): void {
    for (let i = this.queued.length - 1; i >= 0; i--) {
      if (this.queued[i].sourceIndex === sourceIndex) this.queued.splice(i, 1);
    }
  }

  get hasEvents(): boolean { return this.queued.length > 0; }

  /** Release demand synchronously, even if upstream iterator.return() hangs. */
  close(terminal: IteratorResult<T>): void {
    if (this.closed) return;
    this.closed = true;
    this.terminalResult = terminal;
    this.queued.length = 0;
    while (this.waiters.length) this.waiters.shift()!(terminal);
  }
}
