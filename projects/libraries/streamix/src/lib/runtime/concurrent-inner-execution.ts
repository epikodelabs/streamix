/** Internal admission controller for concurrent higher-order executions.
 * It owns capacity and pending source values, not the iterators themselves.
 * The coordinator owns iterator pulls and cancellation.
 */
export class ConcurrentInnerExecution<T> {
  private activeCount = 0;
  private readonly pending: T[] = [];
  private closed = false;

  constructor(
    readonly concurrency: number,
    readonly bufferSize: number,
    private readonly start: (value: T) => void
  ) {
    if (!(concurrency === Infinity || (Number.isInteger(concurrency) && concurrency > 0))) {
      throw new RangeError('mergeMap concurrent must be a positive integer or Infinity');
    }
    if (!(bufferSize === Infinity || (Number.isInteger(bufferSize) && bufferSize >= 0))) {
      throw new RangeError('mergeMap bufferSize must be a non-negative integer or Infinity');
    }
  }

  get active(): number { return this.activeCount; }
  get queued(): number { return this.pending.length; }
  get idle(): boolean { return this.activeCount === 0 && this.pending.length === 0; }

  accept(value: T): void {
    if (this.closed) return;
    if (this.activeCount < this.concurrency) {
      this.launch(value);
    } else if (this.bufferSize > 0) {
      // Preserve the previous mergeMap drop-oldest overflow policy.
      if (this.pending.length >= this.bufferSize) this.pending.shift();
      this.pending.push(value);
    }
  }

  complete(): void {
    if (this.closed || this.activeCount === 0) return;
    this.activeCount--;
    while (!this.closed && this.pending.length > 0 && this.activeCount < this.concurrency) {
      this.launch(this.pending.shift()!);
    }
  }

  close(): void {
    this.closed = true;
    this.pending.length = 0;
  }

  private launch(value: T): void {
    // Reserve the slot before running user code, which can throw or reenter.
    this.activeCount++;
    try {
      this.start(value);
    } catch (error) {
      this.activeCount--;
      throw error;
    }
  }
}
