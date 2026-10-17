/** Runtime-owned scheduler and synchronous transaction coordinator. */
export interface SchedulableNode {
  depth: number;
  queued: boolean;
  flushing?: boolean;
  flush(): void;
}

export interface Scheduler {
  queueFlush(node: SchedulableNode): void;
  flush(): void;
  remove(node: SchedulableNode): void;
  flushImmediately(node: SchedulableNode): void;
  get isDirty(): boolean;
}

export class DefaultScheduler implements Scheduler {
  private isBatchScheduled = false;
  private isFlushing = false;
  private queuedCount = 0;

  // Min-heap of queued nodes ordered by depth (shallow first).
  // A node may appear multiple times if it was re-queued; stale entries are
  // skipped via queuedNodes membership and node.queued checks.
  private heap: SchedulableNode[] = [];
  private heapSeq = 0;
  private heapSeqMap = new WeakMap<SchedulableNode, number>();

  private heapCompare(a: SchedulableNode, b: SchedulableNode): number {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return (this.heapSeqMap.get(a) ?? 0) - (this.heapSeqMap.get(b) ?? 0);
  }

  private siftUp(i: number): void {
    const node = this.heap[i];
    while (i > 0) {
      const parentIdx = (i - 1) >>> 1;
      const parent = this.heap[parentIdx];
      if (this.heapCompare(node, parent) >= 0) break;
      this.heap[i] = parent;
      i = parentIdx;
    }
    this.heap[i] = node;
  }

  private siftDown(i: number): void {
    const node = this.heap[i];
    const len = this.heap.length;
    while (true) {
      const left = (i << 1) + 1;
      if (left >= len) break;
      const right = left + 1;
      let smallest = i;
      if (this.heapCompare(this.heap[left], node) < 0) smallest = left;
      if (right < len && this.heapCompare(this.heap[right], this.heap[smallest]) < 0) smallest = right;
      if (smallest === i) break;
      this.heap[i] = this.heap[smallest];
      i = smallest;
    }
    this.heap[i] = node;
  }

  private heapPush(node: SchedulableNode): void {
    this.heapSeqMap.set(node, this.heapSeq++);
    this.heap.push(node);
    this.siftUp(this.heap.length - 1);
  }

  private heapPop(): SchedulableNode | undefined {
    const last = this.heap.pop();
    if (last === undefined) return undefined;
    if (this.heap.length === 0) return last;
    const result = this.heap[0];
    this.heap[0] = last;
    this.siftDown(0);
    return result;
  }

  flush(): void {
    if (this.isFlushing || isTransactionActive()) return;
    this.isFlushing = true;

    try {
      let node = this.heapPop();
      while (node !== undefined) {
        if (node.queued && !node.flushing) {
          node.queued = false;
          this.queuedCount--;
          try {
            node.flush();
          } catch (error) {
            // A user formula must not strand later queued atoms with their
            // `queued` flag set. Report the failure and continue draining.
            console.error("streamix scheduler flush failed.", error);
          }
        }
        node = this.heapPop();
      }
    } finally {
      this.isFlushing = false;
      this.isBatchScheduled = false;
      this.heap.length = 0;
    }
  }

  flushImmediately(node: SchedulableNode): void {
    if (this.isFlushing) {
      this.queueFlush(node);
      return;
    }

    if (!node.queued || node.flushing) return;
    node.queued = false;
    this.queuedCount--;
    node.flush();
  }

  queueFlush(node: SchedulableNode): void {
    if (node.queued) return;
    node.queued = true;
    this.queuedCount++;
    this.heapPush(node);
    if (this.isBatchScheduled) return;

    this.isBatchScheduled = true;
    queueMicrotask(() => {
      if (!this.isFlushing) this.flush();
    });
  }

  remove(node: SchedulableNode): void {
    if (!node.queued) return;
    node.queued = false;
    this.queuedCount = Math.max(0, this.queuedCount - 1);
  }

  get isDirty(): boolean { return this.queuedCount > 0; }
}

export class RuntimeScheduling {
  scheduler: Scheduler = new DefaultScheduler();
  transactionDepth = 0;
  readonly transactionFinalizers = new Set<() => void>();

  isTransactionActive(): boolean { return this.transactionDepth > 0; }
  finalizeAfterTransaction(callback: () => void): void { this.transactionFinalizers.add(callback); }

  transaction<T>(fn: () => T extends PromiseLike<any> ? never : T): T {
    this.transactionDepth++;
    try {
      const result = fn() as T;
      if (result !== null && (typeof result === "object" || typeof result === "function") && typeof (result as any).then === "function") {
        throw new TypeError("transaction() callback must be synchronous");
      }
      return result;
    } finally {
      this.transactionDepth--;
      if (this.transactionDepth === 0) {
        const finalizers = Array.from(this.transactionFinalizers);
        this.transactionFinalizers.clear();
        // A failing finalizer must not prevent other atoms from releasing
        // transaction-local state, or strand dirty nodes in the scheduler.
        let firstError: unknown;
        let failed = false;
        for (const finalize of finalizers) {
          try {
            finalize();
          } catch (error) {
            if (!failed) { firstError = error; failed = true; }
          }
        }
        try {
          this.scheduler.flush();
        } catch (error) {
          if (!failed) { firstError = error; failed = true; }
        }
        if (failed) throw firstError;
      }
    }
  }
}

/** Single runtime-owned scheduling state. */
export const runtimeScheduling = new RuntimeScheduling();
export function setScheduler(scheduler: Scheduler): void { runtimeScheduling.scheduler = scheduler; }
export function getScheduler(): Scheduler { return runtimeScheduling.scheduler; }

export function isTransactionActive(): boolean { return runtimeScheduling.isTransactionActive(); }
export function finalizeAfterTransaction(callback: () => void): void { runtimeScheduling.finalizeAfterTransaction(callback); }
export function transaction<T>(fn: () => T extends PromiseLike<any> ? never : T): T { return runtimeScheduling.transaction(fn); }

