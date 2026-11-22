import { ɵDisposalQueue } from '../utils/disposal';

/**
 * Runtime-owned generation and cancellation boundary for switch-style inner executions.
 * The controller is deliberately private: public operators still expose AsyncIterator.
 */
export class SwitchingInnerExecution<T> {
  private generation = 0;
  private current: AsyncIterator<T> | null = null;
  private closed = false;
  readonly disposal = new ɵDisposalQueue();
  private closing: Promise<void> | undefined;

  /** Invalidates the old projection immediately, even if its promise is pending. */
  advance(): number {
    const generation = ++this.generation;
    const previous = this.current;
    this.current = null;
    if (previous) this.retire(previous);
    return generation;
  }

  isCurrent(generation: number): boolean {
    return !this.closed && generation === this.generation;
  }

  attach(generation: number, iterator: AsyncIterator<T>): boolean {
    if (!this.isCurrent(generation)) {
      this.retire(iterator);
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

  close(source: AsyncIterator<unknown>): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    ++this.generation;
    const previous = this.current;
    this.current = null;
    const completion = Promise.withResolvers<void>();
    this.closing = completion.promise;
    if (previous) this.retire(previous);
    this.retire(source);
    completion.resolve(this.disposal.wait());
    return this.closing;
  }

  private retire(iterator: AsyncIterator<unknown>): void {
    const completion = Promise.withResolvers<unknown>();
    this.disposal.track(completion.promise.catch(() => {}));
    try { completion.resolve(iterator.return?.()); }
    catch (error) { completion.reject(error); }
  }
}
