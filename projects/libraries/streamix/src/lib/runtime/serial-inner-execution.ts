/** Internal lifetime boundary shared by sequential higher-order operators. */
export class SerialInnerExecution<T> {
  private iterator: AsyncIterator<T> | null = null;
  private closed = false;
  private epoch = 0;

  get active(): boolean { return this.iterator !== null; }
  get stopped(): boolean { return this.closed; }
  get generation(): number { return this.epoch; }

  attach(iterator: AsyncIterator<T>): boolean {
    if (this.closed) {
      void this.cancel(iterator);
      return false;
    }
    if (this.iterator) throw new Error('An inner execution is already active');
    this.iterator = iterator;
    ++this.epoch;
    return true;
  }

  async next(): Promise<IteratorResult<T>> {
    const iterator = this.iterator;
    if (!iterator || this.closed) return { done: true, value: undefined as T };
    const epoch = this.epoch;
    const result = await iterator.next();
    if (this.closed || this.iterator !== iterator || epoch !== this.epoch) {
      return { done: true, value: undefined as T };
    }
    if (result.done) this.release(iterator);
    return result;
  }

  release(iterator?: AsyncIterator<T>): void {
    if (iterator && this.iterator !== iterator) return;
    this.iterator = null;
    ++this.epoch;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const iterator = this.iterator;
    this.release();
    if (iterator) await this.cancel(iterator);
  }

  private async cancel(iterator: AsyncIterator<T>): Promise<void> {
    try { await iterator.return?.(); } catch { /* Best-effort cleanup. */ }
  }
}
