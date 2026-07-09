/**
 * Coordinator utilities for merging and managing multiple async iterators.
 *
 * Provides the {@link createAsyncCoordinator} function, which enables dynamic addition and removal of sources,
 * push notification support and correct emission ordering for both sync and async sources.
 *
 * @module coordinator
 */
import { DONE, NEXT } from "../atoms";
import { normalizeError } from "../atoms/atom";

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
  | { type: "value"; value: T; sourceIndex: number }
  | { type: "complete"; sourceIndex: number }
  | { type: "error"; error: any; sourceIndex: number };

/**
 * Options for {@link createAsyncCoordinator}.
 */
export interface AsyncCoordinatorOptions {
  /**
   * If true, drain initial sources synchronously instead of deferring to a microtask.
   */
  syncDrain?: boolean;
}


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
   * @param key - Optional key used to remove the source by reference later.
   * @returns The index assigned to the new source.
   */
  addSource(source: AsyncIterator<T>, key?: any): number;

  /**
   * Remove a source from the coordinator and clean it up.
   * @param index - The index of the source to remove.
   */
  removeSource(index: number): Promise<void>;

  /**
   * Remove a source by the key passed to {@link addSource}.
   * @param key - The key of the source to remove.
   */
  removeSourceByKey(key: any): Promise<void>;

  /**
   * Batch multiple source additions/removals and emit a single notification
   * after the batch completes.
   * @param callback - Function that performs source changes.
   */
  batch(callback: () => void): void;

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
 * const coordinator = createAsyncCoordinator<number>([stream1, stream2]);
 * for await (const event of coordinator) {
 *   if (event.type === 'value') {
 *     // event.value from event.sourceIndex
 *   }
 * }
 * ```
 */
export function createAsyncCoordinator<T = any>(
  sources: AsyncIterator<T>[] = [],
  options?: AsyncCoordinatorOptions
): AsyncCoordinator<T> {
  type CoordinatorQueueItem = {
    result: IteratorResult<RunnerEvent<T>>;
    sourceIndex: number;
  };

  const queue: CoordinatorQueueItem[] = [];

  // Use sparse arrays to support dynamic indices
  const sourceList: (AsyncIterator<T> | null)[] = [...sources];
  const completed: boolean[] = sources.map(() => false);
  const pulling: boolean[] = sources.map(() => false);
  const pendingPulls: boolean[] = sources.map(() => false);
  const originalPushHandlers: Array<(() => void) | undefined> = [];
  const wiredPushHandlers: Array<(() => void) | undefined> = [];

  let waitingResolve: ((v: any) => void) | null = null;
  let isDraining = false;
  let iteratorReturned = false;
  let activeCount = sources.length;
  let batchDepth = 0;

  // Optional key -> source iterator mapping for reference-based removal.
  const keyToSource = new Map<any, AsyncIterator<T>>();

  /** Checks if all sources are completed. */
  const allDone = () => activeCount === 0;

  /**
   * Pushes a runner event to the coordinator's queue.
   * @param event The event to push.
   * @param sourceIndex The index of the source that generated the event.
   */
  function pushEvent(event: RunnerEvent<T>, sourceIndex: number) {
    queue.push({
      result: NEXT(event),
      sourceIndex
    });
  }

  /**
   * Removes all queued events from a specific source.
   * @param sourceIndex The index of the source whose events should be removed.
   */
  function removeQueuedEvents(sourceIndex: number) {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].sourceIndex === sourceIndex) {
        queue.splice(i, 1);
      }
    }
  }

  /**
   * Marks a source as complete and decrements the active count.
   * @param index The index of the source to mark as complete.
   */
  function markSourceComplete(index: number) {
    if (!completed[index]) {
      completed[index] = true;
      activeCount--;
    }
  }

  /**
   * Removes the key associated with a source iterator.
   * @param source The source iterator to remove from the key map.
   */
  function removeSourceKey(source: AsyncIterator<T>) {
    for (const [key, mappedSource] of keyToSource.entries()) {
      if (mappedSource === source) {
        keyToSource.delete(key);
      }
    }
  }

  /**
   * Detaches a source from the coordinator, cleaning up its state.
   * @param index The index of the source to detach.
   * @returns The detached source iterator, or null if not found.
   */
  function detachSource(index: number): AsyncIterator<T> | null {
    if (index < 0 || index >= sourceList.length) return null;

    const source = sourceList[index];
    if (!source) return null;

    removeSourceKey(source);
    markSourceComplete(index);
    pulling[index] = false;
    pendingPulls[index] = false;
    sourceList[index] = null;
    removeQueuedEvents(index);
    restoreSource(source, index);

    return source;
  }

  /**
   * Safely calls the `return()` method on a source iterator, ignoring errors.
   * @param source The source iterator to return.
   * @returns A promise that resolves when the source has been returned.
   */
  function safeReturnSource(source: AsyncIterator<T>): Promise<void> {
    if (!source.return) return Promise.resolve();

    try {
      return Promise.resolve(source.return()).then(
        () => undefined,
        () => undefined
      );
    } catch {
      return Promise.resolve();
    }
  }

  /**
   * Notifies a waiting consumer that a new event is available or all sources
   * are complete.
   */
  function notify() {
    if (batchDepth > 0) {
      return;
    }

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

  /**
   * Asynchronously pulls the next value from a source.
   * @param i The index of the source to pull from.
   */
  function pullAsync(i: number) {
    // CRITICAL: Don't start a new pull if already pulling, completed, removed, or returned
    if (!sourceList[i] || completed[i] || pulling[i] || iteratorReturned) return;

    pulling[i] = true;
    pendingPulls[i] = false;
    const src = sourceList[i] as AsyncIterator<T>;

    src.next().then(
      (r: IteratorResult<T>) => {
        pulling[i] = false;

        // Don't process if source was completed/removed during the async wait
        if (sourceList[i] !== src || completed[i] || iteratorReturned) return;

        if (r.done) {
          markSourceComplete(i);
          pushEvent({ type: "complete", sourceIndex: i }, i);
        } else {
          pushEvent({ type: "value", value: r.value, sourceIndex: i }, i);
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
        if (sourceList[i] !== src || completed[i] || iteratorReturned) return;

        markSourceComplete(i);
        pushEvent({ type: "error", error: normalizeError(err), sourceIndex: i }, i);
        notify();
      }
    );
  }

  /**
   * Drains a single event from one source, using `__tryNext` if available.
   * @param i The index of the source to drain.
   */
  function drainOneSource(i: number) {
    if (!sourceList[i] || completed[i] || iteratorReturned) return;

    const src: any = sourceList[i];

    if (src.__tryNext) {
      try {
        const r = src.__tryNext();
        if (!r) return;
        if (r.done) {
          markSourceComplete(i);
          pushEvent({ type: "complete", sourceIndex: i }, i);
        } else {
          pushEvent({ type: "value", value: r.value, sourceIndex: i }, i);
        }
      } catch (err) {
        markSourceComplete(i);
        pushEvent({ type: "error", error: normalizeError(err), sourceIndex: i }, i);
      }
      return;
    }

    pendingPulls[i] = true;
    if (!pulling[i] && !completed[i]) {
      pendingPulls[i] = false;
      pullAsync(i);
    }
  }

  /**
   * Drains one event from all active sources.
   */
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

  /**
   * Wires up a source's `__onPush` handler to trigger a drain.
   * @param src The source iterator.
   * @param index The index of the source.
   */
  function wireSource(src: AsyncIterator<T> & { __onPush?: () => void }, index: number) {
    const orig = src.__onPush;
    const wired = () => {
      try {
        orig?.();
      } catch {
        // Preserve draining even if the source's push hook throws.
      }
      if (sourceList[index] !== src) return;
      // Drain this source immediately on push to preserve push-time ordering.
      drainOneSource(index);
      notify();
    };
    originalPushHandlers[index] = orig;
    wiredPushHandlers[index] = wired;
    src.__onPush = wired;
  }

  /**
   * Restores the original `__onPush` handler for a source.
   * @param src The source iterator.
   * @param index The index of the source.
   */
  function restoreSource(src: AsyncIterator<T>, index: number) {
    const source = src as AsyncIterator<T> & { __onPush?: () => void };
    if (source.__onPush === wiredPushHandlers[index]) {
      source.__onPush = originalPushHandlers[index];
    }
    originalPushHandlers[index] = undefined;
    wiredPushHandlers[index] = undefined;
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
      activeCount = 0;
      queue.length = 0;

      // Mark all as completed immediately
      for (let i = 0; i < completed.length; i++) {
        completed[i] = true;
        pulling[i] = false;
        pendingPulls[i] = false;
        const source = sourceList[i];
        if (source) {
          restoreSource(source, i);
        }
      }

      keyToSource.clear();
      await Promise.all(
        sourceList
          .filter((source): source is AsyncIterator<T> => source !== null)
          .map(source => safeReturnSource(source))
      );

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
     * @param key Optional key for reference-based removal
     * @returns The index assigned to this source (for tracking)
     */
    addSource(source: AsyncIterator<T>, key?: any): number {
      if (iteratorReturned) {
        throw new Error('Cannot add source to returned coordinator');
      }

      // Reuse a freed slot to prevent unbounded sparse array growth
      let index = sourceList.indexOf(null);
      if (index >= 0) {
        sourceList[index] = source;
        completed[index] = false;
        pulling[index] = false;
        pendingPulls[index] = false;
      } else {
        index = sourceList.length;
        sourceList.push(source);
        completed.push(false);
        pulling.push(false);
        pendingPulls.push(false);
      }
      activeCount++;

      if (key !== undefined) {
        keyToSource.set(key, source);
      }

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
      const source = detachSource(index);
      if (!source) return;

      await safeReturnSource(source);

      // Notify in case we're waiting and all sources are now done
      notify();
    },

    /**
     * Remove a source by the key passed to {@link addSource}.
     * 
     * @param key Key of the source to remove
     */
    async removeSourceByKey(key: any): Promise<void> {
      const source = keyToSource.get(key);
      if (!source) return;

      const index = sourceList.indexOf(source);
      if (index >= 0) {
        await iterator.removeSource(index);
      } else {
        keyToSource.delete(key);
      }
    },

    /**
     * Batch multiple source additions/removals and emit a single notification
     * after the batch completes.
     * 
     * @param callback Function that performs source changes
     */
    batch(callback: () => void): void {
      batchDepth++;
      try {
        callback();
      } finally {
        batchDepth--;
        if (batchDepth === 0) {
          // drainSources flushes buffered events and triggers notify() now that
          // the batch has ended.
          drainSources();
        }
      }
    },

    /**
     * Get the count of currently active (non-completed, non-removed) sources.
     * 
     * @returns Number of active sources
     */
    getActiveSourceCount(): number {
      return activeCount;
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

  // Initial drain - sync or microtask based on options
  if (sources.length > 0) {
    if (options?.syncDrain) {
      drainSources();
    } else {
      Promise.resolve().then(() => drainSources());
    }
  }

  return iterator as AsyncCoordinator<T>;
}

/**
 * Gets an iterator from an iterable object.
 * Supports both synchronous and asynchronous iterables.
 *
 * @param iterable The iterable to get an iterator from.
 * @returns An `AsyncIterator` or `Iterator`.
 * @throws If the provided object is not iterable.
 */
export function getIterator<T>(iterable: AsyncIterable<T> | Iterable<T>): AsyncIterator<T> | Iterator<T> {
  const asyncIter = (iterable as any)[Symbol.asyncIterator];
  if (asyncIter) return asyncIter.call(iterable);
  const syncIter = (iterable as any)[Symbol.iterator];
  if (syncIter) return syncIter.call(iterable);
  throw new Error("Source is not iterable");
}

/**
 * Races an iterator's `next()` call against an `AbortSignal`.
 * If the signal is aborted, the promise resolves with a `done: true` result.
 */
export function raceNext<T>(
  iterator: AsyncIterator<T> | Iterator<T>,
  signal: AbortSignal
): Promise<IteratorResult<T>> {
  if (signal.aborted) {
    return Promise.resolve({ done: true, value: undefined as any });
  }

  const pending = Promise.resolve(iterator.next());
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    const onAbort = () => resolve({ done: true, value: undefined as any });
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}
