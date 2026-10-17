import { RuntimeEventBuffer } from './event-buffer';
import { RuntimeSourcePulls } from './source-pulls';
import { RuntimeEventDispatcher } from './events';

/**
 * Internal source execution channel. Combines source pull ownership, ordered
 * runtime event publication, consumer demand and cancellation in one lifetime.
 * The coordinator remains responsible for choosing when to pull each source.
 */
export class RuntimeSourceExecution<S, T> {
  private readonly pulls = new RuntimeSourcePulls<S>();
  private readonly buffer = new RuntimeEventBuffer<T>();
  private readonly identity = {};
  private readonly generation = 1;
  private readonly unsubscribe: () => void;
  private closed = false;
  private batchDepth = 0;
  private done = false;
  private readonly terminal: IteratorResult<T>;

  constructor(private readonly events: RuntimeEventDispatcher, terminal: IteratorResult<T>) {
    this.terminal = terminal;
    this.unsubscribe = events.observe(event => {
      if (this.closed || event.node !== this.identity || event.generation !== this.generation) return;
      // Runtime delivery is FIFO even for reentrant producers.
      this.buffer.enqueue((event.value as { sourceIndex: number }).sourceIndex, {
        done: false,
        value: event.value as T
      });
      this.notify();
    });
  }

  attach(index: number, source: AsyncIterator<S>): void { this.pulls.attach(index, source); }
  detach(index: number): void {
    this.pulls.detach(index);
    this.buffer.removeSource(index);
  }
  dropSourceEvents(index: number): void { this.buffer.removeSource(index); }
  isPulling(index: number): boolean { return this.pulls.isPulling(index); }
  request(index: number, deliver: (result: IteratorResult<S>) => void, fail: (error: unknown) => void): void {
    this.pulls.request(index, deliver, fail);
  }
  publish(sourceIndex: number, value: T, kind: 'next' | 'complete' | 'error', error?: unknown): void {
    if (this.closed) return;
    this.events.publish({ node: this.identity, generation: this.generation, kind, value, error });
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
    this.unsubscribe();
    this.buffer.close(this.terminal);
  }
}
