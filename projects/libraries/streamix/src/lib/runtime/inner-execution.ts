/**
 * Runtime-owned generation and cancellation boundary for switch-style inner executions.
 * The controller is deliberately private: public operators still expose AsyncIterator.
 */
export class SwitchingInnerExecution<T> {
  private generation = 0;
  private current: AsyncIterator<T> | null = null;
  private closed = false;

  /** Invalidates the old projection immediately, even if its promise is pending. */
  advance(): number {
    const generation = ++this.generation;
    const previous = this.current;
    this.current = null;
    if (previous) void this.closeIterator(previous);
    return generation;
  }

  isCurrent(generation: number): boolean {
    return !this.closed && generation === this.generation;
  }

  attach(generation: number, iterator: AsyncIterator<T>): boolean {
    if (!this.isCurrent(generation)) {
      void this.closeIterator(iterator);
      return false;
    }
    this.current = iterator;
    return true;
  }

  release(generation: number, iterator: AsyncIterator<T>): void {
    if (this.isCurrent(generation) && this.current === iterator) this.current = null;
  }

  get active(): boolean { return this.current !== null; }
  get stopped(): boolean { return this.closed; }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    ++this.generation;
    const previous = this.current;
    this.current = null;
    if (previous) await this.closeIterator(previous);
  }

  private async closeIterator(iterator: AsyncIterator<T>): Promise<void> {
    try { await iterator.return?.(); } catch { /* Cancellation is best effort. */ }
  }
}
