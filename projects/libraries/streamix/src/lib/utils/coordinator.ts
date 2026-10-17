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
import { internalRuntime } from "../runtime/runtime";
import { RuntimeSourceExecution } from "../runtime/source-execution";

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
  const execution = new RuntimeSourceExecution<T, RunnerEvent<T>>(internalRuntime.events, DONE);

  // Use sparse arrays to support dynamic indices
  const sourceList: (AsyncIterator<T> | null)[] = [...sources];
  sources.forEach((source, index) => execution.attach(index, source));
  const completed: boolean[] = sources.map(() => false);
  const pendingPulls: boolean[] = sources.map(() => false);
  const originalPushHandlers: Array<(() => void) | undefined> = [];
  const wiredPushHandlers: Array<(() => void) | undefined> = [];
  // Sources that expose `__onPush` are push-driven: if their synchronous
  // `__tryNext()` has nothing yet, the push hook will wake the coordinator.
  // Sources that only expose `__tryNext()` use it as a fast path and still
  // need an ordinary async `next()` fallback (for example a pending Promise).
  const pushDriven: boolean[] = sources.map(source => "__onPush" in (source as any));

  let isDraining = false;
  let iteratorReturned = false;
  let returnPromise: Promise<IteratorResult<RunnerEvent<T>>> | undefined;
  let activeCount = sources.length;


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
    execution.publish(sourceIndex, event, event.type === "value" ? "next" : event.type === "complete" ? "complete" : "error", event.type === "error" ? event.error : undefined);
  }

  /**
   * Removes all queued events from a specific source.
   * @param sourceIndex The index of the source whose events should be removed.
   */
  function removeQueuedEvents(sourceIndex: number) {
    execution.dropSourceEvents(sourceIndex);
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
    pendingPulls[index] = false;
    sourceList[index] = null;
    execution.detach(index);
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
    execution.notify(allDone());
  }

  /**
   * Asynchronously pulls the next value from a source.
   * @param i The index of the source to pull from.
   */
  function pullAsync(i: number) {
    if (!sourceList[i] || completed[i] || iteratorReturned) return;
    if (execution.isPulling(i)) { pendingPulls[i] = true; return; }
    pendingPulls[i] = false;
    const src = sourceList[i];
    execution.request(i, result => {
      if (sourceList[i] !== src || completed[i] || iteratorReturned) return;
      if (result.done) {
        markSourceComplete(i);
        pushEvent({ type: "complete", sourceIndex: i }, i);
      } else {
        pushEvent({ type: "value", value: result.value, sourceIndex: i }, i);
      }
      notify();
      if (!result.done && sourceList[i] === src && pendingPulls[i]) {
        pendingPulls[i] = false;
        Promise.resolve().then(() => pullAsync(i));
      }
    }, error => {
      if (sourceList[i] !== src || completed[i] || iteratorReturned) return;
      markSourceComplete(i);
      pushEvent({ type: "error", error: normalizeError(error), sourceIndex: i }, i);
      notify();
    });
  }

  /**
   * Drains a single event from one source, using `__tryNext` if available.
   * @param i The index of the source to drain.
   */
  function drainOneSource(i: number) {
    if (!sourceList[i] || completed[i] || iteratorReturned) return;

    // Never synchronously drain past an outstanding async pull. The active
    // `next()` has already reserved the next source value; draining a later
    // buffered value here would let it overtake that reserved value. Remember
    // that another pull is needed and let `pullAsync()` continue in order.
    if (execution.isPulling(i)) {
      pendingPulls[i] = true;
      return;
    }

    const src: any = sourceList[i];

    if (src.__tryNext) {
      try {
        const r = src.__tryNext();
        if (r) {
          if (r.done) {
            markSourceComplete(i);
            pushEvent({ type: "complete", sourceIndex: i }, i);
          } else {
            pushEvent({ type: "value", value: r.value, sourceIndex: i }, i);
          }
          return;
        }
      } catch (err) {
        markSourceComplete(i);
        pushEvent({ type: "error", error: normalizeError(err), sourceIndex: i }, i);
        return;
      }

      // `__tryNext()` is a synchronous fast path. For explicitly push-driven
      // iterators, a null result means their `__onPush` hook will wake us when
      // a value arrives. Other iterators still need an ordinary async pull so
      // promises, timers, and async generators cannot be stranded.
      if (pushDriven[i]) return;
    }

    pendingPulls[i] = true;
    if (!execution.isPulling(i) && !completed[i]) {
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

      if (execution.hasEvents) return Promise.resolve(execution.take()!);

      if (allDone()) return Promise.resolve(DONE);

      return execution.wait();
    },

    __tryNext() {
      if (iteratorReturned) return DONE;

      drainSources();

      if (execution.hasEvents) return execution.take()!;

      return allDone() ? DONE : null;
    },

    __hasBufferedValues() {
      return execution.hasEvents || allDone();
    },

    return() {
      if (returnPromise) return returnPromise;
      iteratorReturned = true;
      execution.close();
      activeCount = 0;

      const toClose: AsyncIterator<T>[] = [];
      for (let i = 0; i < sourceList.length; i++) {
        completed[i] = true;
        pendingPulls[i] = false;
        const source = sourceList[i];
        if (!source) continue;
        restoreSource(source, i);
        toClose.push(source);
        sourceList[i] = null;
      }
      keyToSource.clear();
      // Release consumers before awaiting potentially non-terminating return().
      returnPromise = Promise.all(toClose.map(safeReturnSource)).then(() => DONE);
      return returnPromise;
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
            pendingPulls[index] = false;
        pushDriven[index] = "__onPush" in (source as any);
      } else {
        index = sourceList.length;
        sourceList.push(source);
        completed.push(false);
        pendingPulls.push(false);
        pushDriven.push("__onPush" in (source as any));
      }
      execution.attach(index, source);
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

      // Detachment changes the completion state synchronously. Wake waiting
      // consumers before awaiting return(): a source may never settle cleanup.
      notify();
      await safeReturnSource(source);
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
      execution.batch(() => { callback(); drainSources(); }, allDone);
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
