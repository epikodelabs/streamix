/** Internal FIFO event buffering and consumer demand for source coordinators. */
export class RuntimeEventBuffer<T> {
  private queued: Array<{ sourceIndex: number; result: IteratorResult<T> }> = [];
  private queueHead = 0;
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private waiterHead = 0;
  private closed = false;
  private terminalResult: IteratorResult<T> | undefined;

  enqueue(sourceIndex: number, result: IteratorResult<T>): void {
    if (this.closed || this.terminalResult) return;
    this.queued.push({ sourceIndex, result });
  }

  private dequeue(): IteratorResult<T> | undefined {
    if (this.queueHead === this.queued.length) return undefined;
    const result = this.queued[this.queueHead++].result;
    if (this.queueHead === this.queued.length) {
      this.queued = [];
      this.queueHead = 0;
    }
    return result;
  }

  private resolveNext(result: IteratorResult<T>): void {
    this.waiters[this.waiterHead++](result);
    if (this.waiterHead === this.waiters.length) {
      this.waiters = [];
      this.waiterHead = 0;
    }
  }

  /** Deliver queued events to pending consumers without overtaking earlier demand. */
  flush(done: boolean, terminal: IteratorResult<T>): void {
    while (this.waiterHead < this.waiters.length && this.hasEvents) {
      this.resolveNext(this.dequeue()!);
    }
    if (done) this.terminalResult = terminal;
    if (done && !this.hasEvents) {
      while (this.waiterHead < this.waiters.length) this.resolveNext(terminal);
    }
  }

  take(): IteratorResult<T> | undefined {
    // Demand registered earlier owns the oldest buffered values. A direct
    // take must never jump ahead of an outstanding asynchronous waiter.
    this.flush(false, this.terminalResult ?? ({ done: true, value: undefined } as IteratorResult<T>));
    return this.dequeue();
  }

  wait(): Promise<IteratorResult<T>> {
    if (this.closed) throw new Error('Cannot wait on a closed event buffer');
    // enqueue() may be used before flush() (e.g. inside a source batch).
    // Satisfy earlier waiters before allowing this newer request to take
    // an already-buffered value.
    if (this.waiterHead < this.waiters.length && this.hasEvents) {
      this.flush(false, this.terminalResult ?? ({ done: true, value: undefined } as IteratorResult<T>));
    }
    if (this.hasEvents) return Promise.resolve(this.dequeue()!);
    if (this.terminalResult) return Promise.resolve(this.terminalResult);
    return new Promise(resolve => this.waiters.push(resolve));
  }

  removeSource(sourceIndex: number): void {
    // Compact only live entries; never revisit entries already consumed.
    if (!this.hasEvents) return;
    this.queued = this.queued.slice(this.queueHead).filter(entry => entry.sourceIndex !== sourceIndex);
    this.queueHead = 0;
  }

  get hasEvents(): boolean { return this.queueHead < this.queued.length; }

  /** Release demand synchronously, even if upstream iterator.return() hangs. */
  close(terminal: IteratorResult<T>): void {
    if (this.closed) return;
    this.closed = true;
    this.terminalResult = terminal;
    this.queued = [];
    this.queueHead = 0;
    while (this.waiterHead < this.waiters.length) this.resolveNext(terminal);
  }
}
