
/**
 * Coordinator utilities for merging and managing multiple async iterators.
 *
 * Provides the {@link createAsyncCoordinator} function, which enables dynamic addition and removal of sources,
 * push notification support and correct emission ordering for both sync and async sources.
 *
 * @module coordinator
 */
import { DONE } from "../abstractions";


/**
 * Event emitted by the coordinator for each source.
 *
 * - `value`: A value was emitted from a source.
 * - `complete`: The source completed.
 * - `error`: The source errored.
 *
 * @typeParam T - The type of value emitted by the sources.
 */
export type RunnerEvent<T> =
  | { type: "value"; value: T; sourceIndex: number; dropped?: true }
  | { type: "complete"; sourceIndex: number }
  | { type: "error"; error: any; sourceIndex: number };


/**
 * An async iterator that coordinates multiple sources.
 *
 * Supports dynamic source management and both sync and async draining.
 *
 * @typeParam T - The type of value emitted by the sources.
 */
export interface AsyncCoordinator<T> extends AsyncIterator<RunnerEvent<T>> {
  /**
   * Synchronously drain all available values from all sources (if supported).
   * Returns DONE if all sources are complete, otherwise null if no values are available.
   */
  __tryNext?: () => IteratorResult<RunnerEvent<T>> | null;

  /**
   * Returns true if there are buffered values or all sources are done.
   */
  __hasBufferedValues?: () => boolean;

  /**
   * Dynamically add a new source to the coordinator.
   * @param source - The async iterator to add.
   * @returns The index assigned to the new source.
   */
  addSource(source: AsyncIterator<T>): number;

  /**
   * Remove a source from the coordinator and clean it up.
   * @param index - The index of the source to remove.
   */
  removeSource(index: number): Promise<void>;

  /**
   * Get the number of currently active (non-completed, non-removed) sources.
   * @returns The count of active sources.
   */
  getActiveSourceCount(): number;

  /**
   * Check if a specific source is completed or removed.
   * @param index - The source index to check.
   * @returns True if the source is completed or removed, false otherwise.
   */
  isSourceComplete(index: number): boolean;
}

/**
 * Creates an async coordinator that merges multiple async iterators.
 *
 * The coordinator supports:
 * - Synchronous draining for sources that support it (via `__tryNext`)
 * - Concurrent async pulling for async sources
 * - Push notification support for sources with `__onPush`
 * - Dynamic addition and removal of sources during iteration
 * - Automatic cleanup and error propagation
 *
 * The returned coordinator is itself an async iterator that yields {@link RunnerEvent} objects, indicating
 * value, completion, or error from each source. The coordinator can be used in `for await` loops or manually
 * via `.next()`. It also exposes methods for dynamic source management.
 *
 * @typeParam T - The type of value emitted by the sources.
 * @param sources - Initial array of async iterators (can be empty).
 * @returns An {@link AsyncCoordinator} with dynamic source management capabilities.
 *
 * @example
 * ```ts
 * const coordinator = createAsyncCoordinator([stream1, stream2]);
 * for await (const event of coordinator) {
 *   if (event.type === 'value') {
 *     // event.value from event.sourceIndex
 *   }
 * }
 * ```
 */
export function createAsyncCoordinator(
  sources: AsyncIterator<any>[] = []
): AsyncCoordinator<any> {
  type CoordinatorQueueItem = {
    result: IteratorResult<RunnerEvent<any>>;
    sourceIndex: number;
  };

  const queue: CoordinatorQueueItem[] = [];
  
  // Use sparse arrays to support dynamic indices
  const sourceList: (AsyncIterator<any> | null)[] = [...sources];
  const completed: boolean[] = sources.map(() => false);
  const pulling: boolean[] = sources.map(() => false);
  const pendingPulls: boolean[] = sources.map(() => false);

  let waitingResolve: ((v: any) => void) | null = null;
  let isDraining = false;
  let iteratorReturned = false;

  const allDone = () => {
    for (let i = 0; i < sourceList.length; i++) {
      if (sourceList[i] !== null && !completed[i]) {
        return false;
      }
    }
    return true;
  };

  function pushEvent(event: RunnerEvent<any>, sourceIndex: number) {
    queue.push({
      result: { done: false, value: event },
      sourceIndex
    });
  }

  function notify() {
    if (!waitingResolve) return;

    if (queue.length > 0) {
      const item = queue.shift()!;
      const res = waitingResolve;
      waitingResolve = null;
      res(item.result);
    } else if (allDone()) {
      const res = waitingResolve;
      waitingResolve = null;
      res(DONE);
    }
  }

  function pullAsync(i: number) {
    // CRITICAL: Don't start a new pull if already pulling, completed, removed, or returned
    if (!sourceList[i] || completed[i] || pulling[i] || iteratorReturned) return;
    
    pulling[i] = true;
    pendingPulls[i] = false;
    const src: any = sourceList[i];
    
    src.next().then(
      (r: IteratorResult<any>) => {
        pulling[i] = false;
        
        // Don't process if source was completed/removed during the async wait
        if (!sourceList[i] || completed[i] || iteratorReturned) return;

        if (r.done) {
          completed[i] = true;
          pushEvent({ type: "complete", sourceIndex: i }, i);
        } else {
          const event = (r as any).dropped
            ? { type: "value", value: r.value, sourceIndex: i, dropped: true as const }
            : { type: "value", value: r.value, sourceIndex: i };
          pushEvent(event, i);
        }

        notify();
        
        // CRITICAL: Only schedule next pull if there are more values AND not already pulling
        // AND not completed AND there's a pending pull request
        if (sourceList[i] && !completed[i] && !pulling[i] && pendingPulls[i]) {
          pendingPulls[i] = false;
          Promise.resolve().then(() => pullAsync(i));
        }
      },
      (err: any) => {
        pulling[i] = false;
        if (!sourceList[i] || completed[i] || iteratorReturned) return;
        
        completed[i] = true;
        pushEvent({ type: "error", error: err, sourceIndex: i }, i);
        notify();
      }
    );
  }

  function drainOneSource(i: number) {
    if (!sourceList[i] || completed[i] || iteratorReturned) return;

    const src: any = sourceList[i];

    if (src.__tryNext) {
      try {
        const r = src.__tryNext();
        if (!r) return;
        if (r.done) {
          completed[i] = true;
          pushEvent({ type: "complete", sourceIndex: i }, i);
        } else {
          const event = (r as any).dropped
            ? { type: "value", value: r.value, sourceIndex: i, dropped: true as const }
            : { type: "value", value: r.value, sourceIndex: i };
          pushEvent(event, i);
        }
      } catch (err) {
        completed[i] = true;
        pushEvent({ type: "error", error: err, sourceIndex: i }, i);
      }
      return;
    }

    pendingPulls[i] = true;
    if (!pulling[i] && !completed[i]) {
      pendingPulls[i] = false;
      pullAsync(i);
    }
  }

  function drainSources() {
    // CRITICAL: Prevent recursive drains
    if (isDraining || iteratorReturned) return;
    isDraining = true;

    try {
      for (let i = 0; i < sourceList.length; i++) {
        if (!sourceList[i] || completed[i]) continue;

        // Drain at most one event per source per pass. For push-based sources,
        // __onPush triggers this function repeatedly, preserving cross-source
        // emission ordering without source-local metadata.
        drainOneSource(i);
      }
    } finally {
      isDraining = false;
    }

    notify();
  }

  // Wire up push notifications for a source
  function wireSource(src: any, index: number) {
    const orig = src.__onPush;
    src.__onPush = () => {
      orig?.();
      // Drain this source immediately on push to preserve push-time ordering.
      drainOneSource(index);
      notify();
    };
  }

  // Wire up initial sources
  for (let i = 0; i < sources.length; i++) {
    wireSource((sources as any[])[i], i);
  }

  const iterator: any = {
    [Symbol.asyncIterator]() {
      return this;
    },

    next() {
      if (iteratorReturned) return Promise.resolve(DONE);
      
      drainSources();

      if (queue.length > 0) {
        const item = queue.shift()!;
        return Promise.resolve(item.result);
      }

      if (allDone()) return Promise.resolve(DONE);

      return new Promise(res => {
        waitingResolve = res;
      });
    },

    __tryNext() {
      if (iteratorReturned) return DONE;
      
      drainSources();

      if (queue.length > 0) {
        const item = queue.shift()!;
        return item.result;
      }

      return allDone() ? DONE : null;
    },

    __hasBufferedValues() {
      return queue.length > 0 || allDone();
    },

    async return() {
      iteratorReturned = true;
      
      // Mark all as completed immediately
      for (let i = 0; i < completed.length; i++) {
        completed[i] = true;
        pulling[i] = false;
        pendingPulls[i] = false;
      }

      const safe = (s: any) => {
        if (!s?.return) return Promise.resolve();
        try {
          return Promise.resolve(s.return()).catch(() => {});
        } catch {
          return Promise.resolve();
        }
      };

      await Promise.all(sourceList.filter(s => s !== null).map(safe));
      
      if (waitingResolve) {
        waitingResolve(DONE);
        waitingResolve = null;
      }
      
      return DONE;
    },

    // ============================================
    // Dynamic Source Management API
    // ============================================

    /**
     * Add a new source dynamically during iteration.
     * The source will be immediately wired for push notifications and drained.
     * 
     * @param source AsyncIterator to add
     * @returns The index assigned to this source (for tracking)
     */
    addSource(source: AsyncIterator<any>): number {
      if (iteratorReturned) {
        throw new Error('Cannot add source to returned coordinator');
      }

      const index = sourceList.length;
      sourceList.push(source);
      completed.push(false);
      pulling.push(false);
      pendingPulls.push(false);

      // Wire up push notification
      wireSource(source, index);

      // Trigger immediate drain for new source
      Promise.resolve().then(() => drainSources());

      return index;
    },

    /**
     * Remove a source from the coordinator and clean it up.
     * The source will be marked as completed and its return() method called.
     * 
     * @param index Index of the source to remove
     */
    async removeSource(index: number): Promise<void> {
      if (index < 0 || index >= sourceList.length) return;

      const source = sourceList[index];
      if (!source) return;

      // Mark as completed and clear the slot
      completed[index] = true;
      pulling[index] = false;
      pendingPulls[index] = false;
      sourceList[index] = null;

      // Call return on the source
      try {
        await source.return?.();
      } catch {
        // Ignore cleanup errors
      }

      // Notify in case we're waiting and all sources are now done
      notify();
    },

    /**
     * Get the count of currently active (non-completed, non-removed) sources.
     * 
     * @returns Number of active sources
     */
    getActiveSourceCount(): number {
      let count = 0;
      for (let i = 0; i < sourceList.length; i++) {
        if (sourceList[i] !== null && !completed[i]) {
          count++;
        }
      }
      return count;
    },

    /**
     * Check if a specific source is completed.
     * 
     * @param index Source index to check
     * @returns true if source is completed or removed, false otherwise
     */
    isSourceComplete(index: number): boolean {
      if (index < 0 || index >= sourceList.length) return true;
      return sourceList[index] === null || completed[index];
    }
  };

  // Initial drain - schedule to prevent blocking
  if (sources.length > 0) {
    Promise.resolve().then(() => drainSources());
  }

  return iterator as AsyncCoordinator<any>;
}
