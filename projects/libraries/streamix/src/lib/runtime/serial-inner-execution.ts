/** Internal lifetime boundary shared by sequential higher-order operators. */
export class SerialInnerExecution<T> {
  private iterator: AsyncIterator<T> | null = null;
  private closed = false;
  private closing: Promise<void> | undefined;
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

  close(source?: AsyncIterator<unknown>): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const iterator = this.iterator;
    this.release();
    const completion = Promise.withResolvers<void>();
    this.closing = completion.promise;
    completion.resolve(Promise.all([
      iterator && this.cancel(iterator),
      source && this.cancel(source),
    ]).then(() => {}));
    return this.closing;
  }

  private async cancel(iterator: AsyncIterator<unknown>): Promise<void> {
    try { await iterator.return?.(); } catch { /* Best-effort cleanup. */ }
  }
}
