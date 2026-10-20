import { RuntimeEventBuffer } from './event-buffer';
import { RuntimeSourcePulls } from './source-pulls';

/**
 * Internal source execution channel. Combines source pull ownership, ordered
 * delivery, consumer demand and cancellation in one lifetime. Delivery is a
 * direct synchronous call into the buffer — no bus, no queue, no per-event
 * allocation — so a live coordinator never marks the diagnostics bus observed.
 * The coordinator remains responsible for choosing when to pull each source.
 */
export class RuntimeSourceExecution<S, T> {
  private readonly pulls = new RuntimeSourcePulls<S>();
  private readonly buffer = new RuntimeEventBuffer<T>();
  private closed = false;
  private batchDepth = 0;
  private done = false;
  private readonly terminal: IteratorResult<T>;

  constructor(terminal: IteratorResult<T>) {
    this.terminal = terminal;
  }

  attach(index: number, source: AsyncIterator<S>): void {
    // Reusing a source slot must invalidate buffered events from the previous
    // iterator, even if the caller did not detach first. Delivery is
    // synchronous, so no event can be in flight past this point.
    this.pulls.attach(index, source);
    this.buffer.reopen();
    this.done = false;
    this.dropSourceEvents(index);
  }
  detach(index: number): void {
    this.pulls.detach(index);
    this.dropSourceEvents(index);
  }
  dropSourceEvents(index: number): void {
    this.buffer.removeSource(index);
  }
  isPulling(index: number): boolean { return this.pulls.isPulling(index); }
  request(index: number, deliver: (result: IteratorResult<S>) => void, fail: (error: unknown) => void): void {
    this.pulls.request(index, deliver, fail);
  }
  /** Deliver one source value into the buffer, waking waiting consumers. */
  publish(sourceIndex: number, value: T): void {
    if (this.closed) return;
    this.buffer.enqueue(sourceIndex, { done: false, value });
    this.notify();
  }
  get hasEvents(): boolean { return this.buffer.hasEvents; }
  take(): IteratorResult<T> | undefined { return this.buffer.take(); }
  wait(): Promise<IteratorResult<T>> { return this.buffer.wait(); }
  notify(done = this.done): void {
    this.done = done;
    if (this.batchDepth === 0) this.buffer.flush(done, this.terminal);
  }
  batch(callback: () => void, done: () => boolean): void {
    this.batchDepth++;
    try { callback(); }
    finally {
      this.batchDepth--;
      if (this.batchDepth === 0) this.notify(done());
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pulls.close();
    this.buffer.close(this.terminal);
  }
}
