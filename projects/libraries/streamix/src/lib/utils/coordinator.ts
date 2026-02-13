import { DONE, getIteratorEmissionStamp, setIteratorEmissionStamp } from "../abstractions";
import { insertOrdered, type QueueItem } from "./helpers";

export type RunnerEvent<T> =
  | { type: "value"; value: T; sourceIndex: number }
  | { type: "complete"; sourceIndex: number }
  | { type: "error"; error: any; sourceIndex: number };

export interface AsyncCoordinator<T> extends AsyncIterator<RunnerEvent<T>> {
  __tryNext?: () => IteratorResult<RunnerEvent<T>> | null;
  __hasBufferedValues?: () => boolean;
  
  // Dynamic source management
  addSource(source: AsyncIterator<T>): number;
  removeSource(index: number): Promise<void>;
  getActiveSourceCount(): number;
  isSourceComplete(index: number): boolean;
}

/**
 * Creates an async coordinator that merges multiple async iterators while preserving
 * timestamp-based ordering. Supports dynamically adding and removing sources during iteration.
 *
 * Features:
 * - Timestamp-ordered emission across all sources
 * - Sync source draining (via __tryNext)
 * - Async source concurrent pulling
 * - Push notification support
 * - Dynamic source addition/removal
 * - Automatic cleanup and error handling
 *
 * @param sources Initial array of async iterators (can be empty)
 * @returns AsyncCoordinator with dynamic source management capabilities
 */
export function createAsyncCoordinator(
  sources: AsyncIterator<any>[] = []
): AsyncCoordinator<any> {
  type CoordinatorQueueItem = QueueItem<RunnerEvent<any>> & {
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
  let nextStamp = 1;
  let iteratorReturned = false;

  const allDone = () => {
    for (let i = 0; i < sourceList.length; i++) {
      if (sourceList[i] !== null && !completed[i]) {
        return false;
      }
    }
    return true;
  };

  function pushEvent(event: RunnerEvent<any>, stamp: number, sourceIndex: number) {
    insertOrdered(queue, {
      result: { done: false, value: event },
      stamp,
      sourceIndex
    });
  }

  function notify() {
    if (!waitingResolve) return;

    if (queue.length > 0) {
      const item = queue.shift()!;
      const res = waitingResolve;
      waitingResolve = null;
      setIteratorEmissionStamp(iterator, item.stamp);
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

        const stamp = getIteratorEmissionStamp(src) ?? nextStamp++;

        if (r.done) {
          completed[i] = true;
          pushEvent({ type: "complete", sourceIndex: i }, stamp, i);
        } else {
          pushEvent({ type: "value", value: r.value, sourceIndex: i }, stamp, i);
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
        const stamp = getIteratorEmissionStamp(src) ?? nextStamp++;
        pushEvent({ type: "error", error: err, sourceIndex: i }, stamp, i);
        notify();
      }
    );
  }

  function drainSources() {
    // CRITICAL: Prevent recursive drains
    if (isDraining || iteratorReturned) return;
    isDraining = true;

    try {
      for (let i = 0; i < sourceList.length; i++) {
        if (!sourceList[i] || completed[i]) continue;

        const src: any = sourceList[i];

        // Sync sources - DRAIN ALL VALUES
        if (src.__tryNext) {
          try {
            let r;
            while ((r = src.__tryNext())) {
              const stamp = getIteratorEmissionStamp(src) ?? nextStamp++;

              if (r.done) {
                completed[i] = true;
                pushEvent({ type: "complete", sourceIndex: i }, stamp, i);
                break;
              } else {
                pushEvent({ type: "value", value: r.value, sourceIndex: i }, stamp, i);
              }
            }
          } catch (err) {
            completed[i] = true;
            const stamp = getIteratorEmissionStamp(src) ?? nextStamp++;
            pushEvent({ type: "error", error: err, sourceIndex: i }, stamp, i);
          }
        } 
        // Async sources
        else {
          // CRITICAL: Mark that we need a pull, but don't start it if already pulling
          pendingPulls[i] = true;
          if (!pulling[i] && !completed[i]) {
            pendingPulls[i] = false;
            pullAsync(i);
          }
        }
      }
    } finally {
      isDraining = false;
    }

    notify();
  }

  // Wire up push notifications for a source
  function wireSource(src: any) {
    const orig = src.__onPush;
    src.__onPush = () => {
      orig?.();
      // Schedule drain in next microtask to prevent recursion
      Promise.resolve().then(() => drainSources());
    };
  }

  // Wire up initial sources
  for (const src of sources as any[]) {
    wireSource(src);
  }

  const iterator: any = {
    next() {
      if (iteratorReturned) return Promise.resolve(DONE);
      
      drainSources();

      if (queue.length > 0) {
        const item = queue.shift()!;
        setIteratorEmissionStamp(iterator, item.stamp);
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
        setIteratorEmissionStamp(iterator, item.stamp);
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
      wireSource(source);

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