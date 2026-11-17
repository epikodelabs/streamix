/**
 * Coordinator utilities for merging and managing multiple async iterators.
 *
 * Provides the {@link createAsyncCoordinator} function, which enables dynamic addition and removal of sources,
 * push notification support and correct emission ordering for both sync and async sources.
 *
 * @module coordinator
 */
import { DONE } from "../atoms";
import { normalizeError } from "../atoms/atom";
import { RuntimeSourceExecution } from "../runtime/source-execution";
import { asStreamixSource, type StreamixSource, type SyncPoll } from "./source-protocol";

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
 * The coordinator is itself a {@link StreamixSource}: it exposes the standard
 * async pull plus the protocol's synchronous poll, buffered-events and
 * terminal-state probes. It declares no readiness notification — consumers
 * are woken through their pending `next()`.
 *
 * @typeParam T - The type of value emitted by the sources.
 */
export interface AsyncCoordinator<T> extends StreamixSource<RunnerEvent<T>> {
  [Symbol.asyncIterator](): AsyncIterator<RunnerEvent<T>>;

  /**
   * The coordinator always supports the synchronous poll: it drains buffered
   * source events and reports the all-sources-completed state through it.
   */
  pollSync(): SyncPoll<RunnerEvent<T>>;

  /** Events buffered from the sources but not yet consumed. */
  hasBufferedEvents(): boolean;

  /** True once every source has completed or the coordinator was returned. */
  isTerminal(): boolean;

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
 * - Synchronous draining for sources that support it (via `pollSync`)
 * - Concurrent async pulling for async sources
 * - Push notification support for sources with `onReady`
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
  // Source transport uses no bus: the execution delivers each event straight
  // into its own buffer. The shared runtime bus is the diagnostics channel,
  // and observing it is the gate that turns diagnostics eventing on — a
  // coordinator must never flip that gate in production.
  const execution = new RuntimeSourceExecution<T, RunnerEvent<T>>(DONE);

  // Use sparse arrays to support dynamic indices
  const sourceList: (StreamixSource<T> | null)[] = sources.map(asStreamixSource);
  sources.forEach((source, index) => execution.attach(index, source));
  const completed: boolean[] = sources.map(() => false);
  const pendingPulls: boolean[] = sources.map(() => false);
  const readyUnwires: Array<(() => void) | undefined> = [];
  // Sources that declare `onReady` are push-driven: if their synchronous
  // `pollSync()` has nothing yet, the readiness listener will wake the
  // coordinator. Sources that only expose `pollSync()` use it as a fast path
  // and still need an ordinary async `next()` fallback (for example a pending
  // Promise).
  const pushDriven: boolean[] = sources.map(source => typeof asStreamixSource(source).onReady === "function");

  let isDraining = false;
  let iteratorReturned = false;
  let returnPromise: Promise<IteratorResult<RunnerEvent<T>>> | undefined;
  let activeCount = sources.length;


  // Optional key -> source iterator mapping for reference-based removal.
  const keyToSource = new Map<any, AsyncIterator<T>>();
  const initialSourceCount = sources.length;
  const explicitlyRemoved = new Set<number>();
  const slotTokens = sources.map(() => ({}));
  const completionTokens = new WeakMap<object, object>();

  /** Checks if all sources are completed. */
  const allDone = () => activeCount === 0;

  /**
   * Pushes a runner event to the coordinator's queue.
   * @param event The event to push.
   * @param sourceIndex The index of the source that generated the event.
   */
  function pushEvent(event: RunnerEvent<T>, sourceIndex: number) {
    if (event.type === "complete") completionTokens.set(event, slotTokens[sourceIndex]);
    execution.publish(sourceIndex, event);
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
  function detachSource(index: number): StreamixSource<T> | null {
    if (index < 0 || index >= sourceList.length) return null;

    const source = sourceList[index];
    if (!source) return null;

    removeSourceKey(source);
    markSourceComplete(index);
    pendingPulls[index] = false;
    sourceList[index] = null;
    execution.detach(index);
    restoreSource(index);

    return source;
  }

  function acceptEvent(result: IteratorResult<RunnerEvent<T>>): IteratorResult<RunnerEvent<T>> {
    // Keep the slot until its completion event is consumed: reusing it earlier
    // would discard buffered values and completion via the replacement epoch.
    if (!result.done && result.value.type === "complete" &&
        completionTokens.get(result.value) === slotTokens[result.value.sourceIndex]) {
      detachSource(result.value.sourceIndex);
    }
    return result;
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
   * Drains a single event from one source, using `pollSync` when the source
   * declares the synchronous-poll capability.
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

    const src = sourceList[i]!;

    if (src.pollSync) {
      try {
        const poll = src.pollSync();
        if (poll.status === "available") {
          const result = poll.result;
          if (result.done) {
            markSourceComplete(i);
            pushEvent({ type: "complete", sourceIndex: i }, i);
          } else {
            pushEvent({ type: "value", value: result.value, sourceIndex: i }, i);
          }
          return;
        }
      } catch (err) {
        markSourceComplete(i);
        pushEvent({ type: "error", error: normalizeError(err), sourceIndex: i }, i);
        return;
      }

      // `pollSync()` is a synchronous fast path. For explicitly push-driven
      // sources, an `unavailable` outcome means their readiness listener will
      // wake us when an event arrives. Other sources still need an ordinary
      // async pull so promises, timers, and async generators cannot be
      // stranded.
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
        // readiness notifications trigger this function repeatedly, preserving
        // cross-source emission ordering without source-local metadata.
        drainOneSource(i);
      }
    } finally {
      isDraining = false;
    }

    notify();
  }

  /**
   * Registers a readiness listener on a source that declares the `onReady`
   * capability. The source is not mutated: the returned unregister function
   * detaches the listener again.
   * @param src The source iterator.
   * @param index The index of the source.
   */
  function wireSource(src: StreamixSource<T>, index: number) {
    const onReady = src.onReady;
    if (!onReady) return;
    readyUnwires[index] = onReady.call(src, () => {
      if (sourceList[index] !== src) return;
      // Drain this source immediately on readiness to preserve push-time ordering.
      drainOneSource(index);
      notify();
    });
  }

  /**
   * Unregisters a source's readiness listener.
   * @param index The index of the source.
   */
  function restoreSource(index: number) {
    const unwire = readyUnwires[index];
    readyUnwires[index] = undefined;
    unwire?.();
  }

  // Wire up initial sources
  for (let i = 0; i < sources.length; i++) {
    wireSource(sourceList[i]!, i);
  }

  const iterator: AsyncCoordinator<T> = {
    [Symbol.asyncIterator]() {
      return this;
    },

    next() {
      if (iteratorReturned) return Promise.resolve(DONE);

      drainSources();

      const event = execution.take();
      if (event !== undefined) return Promise.resolve(acceptEvent(event));

      if (allDone()) return Promise.resolve(DONE);

      return execution.wait().then(acceptEvent);
    },

    pollSync(): SyncPoll<RunnerEvent<T>> {
      if (iteratorReturned) return { status: "available", result: DONE };

      drainSources();

      const event = execution.take();
      if (event !== undefined) return { status: "available", result: acceptEvent(event) };

      return allDone() ? { status: "available", result: DONE } : { status: "unavailable" };
    },

    hasBufferedEvents() {
      return execution.hasEvents;
    },

    isTerminal() {
      return allDone();
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
        restoreSource(i);
        const source = sourceList[i];
        if (!source) continue;
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
      const sourceView = asStreamixSource(source);

      // Reuse a freed slot to prevent unbounded sparse array growth
      // Initial indices identify fixed inputs (e.g. mergeMap's outer source).
      // Natural completion releases their references without reusing those IDs.
      let index = sourceList.findIndex((item, i) =>
        item === null && (i >= initialSourceCount || explicitlyRemoved.has(i)));
      if (index >= 0) {
        sourceList[index] = sourceView;
        completed[index] = false;
        pendingPulls[index] = false;
        pushDriven[index] = typeof sourceView.onReady === "function";
      } else {
        index = sourceList.length;
        sourceList.push(sourceView);
        completed.push(false);
        pendingPulls.push(false);
        pushDriven.push(typeof sourceView.onReady === "function");
      }
      execution.attach(index, source);
      slotTokens[index] = {};
      explicitlyRemoved.delete(index);
      activeCount++;

      if (key !== undefined) {
        keyToSource.set(key, sourceView);
      }

      // Wire up push notification
      wireSource(sourceView, index);

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
      explicitlyRemoved.add(index);

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
