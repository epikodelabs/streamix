/** Tracks cleanup started at a synchronous lifecycle boundary. @internal */
export class ɵDisposalQueue {
  private readonly pending = new Set<Promise<unknown>>();

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
    this.pending.add(task);
    const remove = () => { this.pending.delete(task); };
    void task.then(remove, remove);
  }

  async wait(exclude?: Promise<unknown>): Promise<void> {
    const errors: unknown[] = [];
    let tasks: Promise<unknown>[];
    while ((tasks = [...this.pending].filter(task => task !== exclude)).length) {
      for (const result of await Promise.allSettled(tasks)) {
        if (result.status === "rejected") errors.push(result.reason);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Streamix disposal failed.");
  }
}

/** Starts disposal synchronously and shares its completion across callers. @internal */
export function ɵcreateDisposer(
  start: (queue: ɵDisposalQueue) => void,
  queue = new ɵDisposalQueue(),
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

const owners = new WeakMap<object, ɵDisposalQueue>();

/** Records work started by a framework's synchronous cleanup callback. @internal */
export function ɵtrackDisposal(owner: object, completion: Promise<void>): void {
  let queue = owners.get(owner);
  if (!queue) owners.set(owner, queue = new ɵDisposalQueue());
  queue.track(completion);
}

/**
 * Waits for outstanding Streamix cleanup after a framework owner has been
 * stopped or unmounted. For a directly owned resource, await its dispose().
 */
export async function waitForDisposal(owner: object): Promise<void> {
  await owners.get(owner)?.wait();
}
