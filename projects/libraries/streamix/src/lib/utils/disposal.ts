/** Tracks cleanup started at a synchronous lifecycle boundary. @internal */
export class DisposalQueue {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly tracked = new WeakSet<Promise<unknown>>();
  private readonly errors: unknown[] = [];

  run(cleanup: () => unknown): void {
    try {
      const result = cleanup();
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        this.track(Promise.resolve(result));
      }
    } catch (error) {
      this.track(Promise.reject(error));
    }
  }

  track(task: Promise<unknown>): void {
    if (this.tracked.has(task)) return;
    this.tracked.add(task);
    this.pending.add(task);
    const remove = () => { this.pending.delete(task); };
    void task.then(remove, error => {
      this.errors.push(error);
      remove();
    });
  }

  async wait(exclude?: Promise<unknown>): Promise<void> {
    let tasks: Promise<unknown>[];
    while ((tasks = [...this.pending].filter(task => task !== exclude)).length) {
      await Promise.allSettled(tasks);
    }
    if (this.errors.length === 1) throw this.errors[0];
    if (this.errors.length > 1) throw new AggregateError(this.errors, "Streamix disposal failed.");
  }
}

/** Starts disposal synchronously and shares its completion across callers. @internal */
export function createDisposer(
  start: (queue: DisposalQueue) => void,
  queue = new DisposalQueue(),
): () => Promise<void> {
  let disposal: Promise<void> | undefined;
  return () => {
    if (disposal) return disposal;
    let complete!: (cleanup: Promise<void>) => void;
    disposal = new Promise<void>(resolve => { complete = resolve; });
    void disposal.catch(() => {});
    queue.run(() => start(queue));
    complete(queue.wait(disposal));
    return disposal;
  };
}
