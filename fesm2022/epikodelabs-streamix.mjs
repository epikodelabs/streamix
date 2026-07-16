/**
 * Core state management for async iterators with pull/push coordination
 */
class AsyncIteratorState {
    constructor() {
        this.queue = [];
        this.backpressureQueue = [];
        this.pullResolve = null;
        this.pullReject = null;
        this.pendingError = null;
        this.completed = false;
    }
    /**
     * Check if there are any buffered values, errors, or completion
     */
    hasBufferedValues() {
        return this.queue.length > 0 || this.pendingError != null || this.completed;
    }
    /**
     * Clear all pending resolvers and backpressure
     */
    clear() {
        if (this.pullResolve) {
            this.pullResolve(DONE);
            this.pullResolve = null;
            this.pullReject = null;
        }
        for (const resolve of this.backpressureQueue) {
            resolve();
        }
        this.backpressureQueue.length = 0;
    }
    /**
     * Mark as completed and clear state
     */
    markCompleted() {
        this.completed = true;
        this.pendingError = null;
        this.queue.length = 0;
        this.clear();
    }
    /**
     * Enqueue a value
     */
    enqueueValue(value) {
        this.queue.push({
            result: { done: false, value }
        });
    }
    /**
     * Enqueue completion
     */
    enqueueCompletion() {
        this.queue.push({
            result: DONE
        });
    }
}
/**
 * Safely normalizes any thrown/rejected value to an Error instance.
 * Preserves real Error instances (and their stack traces); otherwise wraps
 * primitives and objects in `new Error(String(err))`.
 */
function normalizeError(err) {
    return err instanceof Error ? err : new Error(String(err));
}
/**
 * Synchronous pull handler - implements __tryNext logic
 */
function syncPull(state, _iterator, onDone) {
    // Check queue first
    if (state.queue.length > 0) {
        const { result } = state.queue.shift();
        state.backpressureQueue.shift()?.();
        if (result.done) {
            onDone?.();
        }
        return result;
    }
    // Check pending error
    if (state.pendingError) {
        const { err } = state.pendingError;
        state.pendingError = null;
        throw err;
    }
    // Check completion
    if (state.completed) {
        onDone?.();
        return DONE;
    }
    return null;
}
/**
 * Asynchronous pull handler - implements next() logic
 */
async function asyncPull(state, _iterator, onDone) {
    // Sync path: values already queued
    if (state.queue.length > 0) {
        const { result } = state.queue.shift();
        state.backpressureQueue.shift()?.();
        if (result.done) {
            onDone?.();
        }
        return result;
    }
    // Sync path: pending error
    if (state.pendingError) {
        const { err } = state.pendingError;
        state.pendingError = null;
        throw err;
    }
    // Sync path: already completed
    if (state.completed) {
        onDone?.();
        return DONE;
    }
    // Async path: wait for push
    return new Promise((res, rej) => {
        state.pullResolve = res;
        state.pullReject = rej;
    });
}
/**
 * Push a value with backpressure support
 */
function pushValue(state, _iterator, value, onPush) {
    if (state.completed)
        return;
    const result = { done: false, value };
    // If someone is waiting, resolve immediately
    if (state.pullResolve) {
        const r = state.pullResolve;
        state.pullResolve = state.pullReject = null;
        r(result);
        onPush?.();
        return;
    }
    // Otherwise queue it
    state.enqueueValue(value);
    // If there's a push handler, call it (no backpressure)
    if (onPush) {
        onPush();
        return;
    }
    // Otherwise, return backpressure promise
    return new Promise((resolve) => state.backpressureQueue.push(resolve));
}
/**
 * Push a completion signal
 */
function pushComplete(state, _iterator, onPush) {
    if (state.completed)
        return;
    state.completed = true;
    // If someone is waiting, resolve immediately
    if (state.pullResolve) {
        const r = state.pullResolve;
        state.pullResolve = state.pullReject = null;
        r(DONE);
        return;
    }
    // Otherwise queue it
    state.enqueueCompletion();
    onPush?.();
}
/**
 * Push an error signal
 */
function pushError(state, _iterator, err, onPush) {
    if (state.completed)
        return;
    state.completed = true;
    const error = normalizeError(err);
    // If someone is waiting, reject immediately
    if (state.pullReject) {
        const r = state.pullReject;
        state.pullResolve = state.pullReject = null;
        r(error);
        return;
    }
    // Otherwise store it
    state.pendingError = { err: error };
    onPush?.();
}

/**
 * Creates an `AsyncPushable` - an async iterator that you can manually
 * push values into with backpressure.
 */
function createAsyncPushable() {
    const state = new AsyncIteratorState();
    // Create the receiver that will handle pushes
    const receiver = {
        next(value) {
            return pushValue(state, iterator, value, iterator.__onPush);
        },
        complete() {
            pushComplete(state, iterator, iterator.__onPush);
        },
        error(err) {
            pushError(state, iterator, err, iterator.__onPush);
        },
        get completed() {
            return state.completed;
        }
    };
    // Create the iterator
    const iterator = {
        next() {
            return asyncPull(state, iterator);
        },
        async return() {
            state.markCompleted();
            return Promise.resolve(DONE);
        },
        async throw(err) {
            const error = normalizeError(err);
            state.completed = true;
            state.pendingError = null;
            state.queue.length = 0;
            if (state.pullReject) {
                const r = state.pullReject;
                state.pullResolve = state.pullReject = null;
                r(error);
            }
            state.clear();
            return Promise.reject(error);
        },
        __tryNext() {
            return syncPull(state, iterator);
        },
        __hasBufferedValues() {
            return state.hasBufferedValues();
        }
    };
    // Make it iterable
    iterator[Symbol.asyncIterator] = function () {
        return this;
    };
    // Augment with push API
    iterator.push = function (value) {
        return receiver.next(value);
    };
    iterator.error = function (err) {
        receiver.error(err);
    };
    iterator.complete = function () {
        receiver.complete();
    };
    iterator.completed = function () {
        return receiver.completed;
    };
    // Add optional hook for push notifications
    iterator.__onPush = () => { };
    return iterator;
}

/**
 * Type guard that checks whether a value behaves like a promise (thenable).
 *
 * We avoid relying on `instanceof Promise` so that promise-like values from
 * different realms or custom thenables are still treated correctly.
 *
 * Note: the return type is `PromiseLike<unknown>` (not `Promise<unknown>`)
 * because any object with a `.then()` method satisfies this check, not just
 * native Promise instances.
 */
const isPromiseLike = (value) => !!value && typeof value.then === 'function';
/**
 * A constant representing a completed stream result.
 *
 * Always `{ done: true, value: undefined }`.
 * Used to signal the end of a stream.
 */
const DONE = Object.freeze({ done: true, value: undefined });
/**
 * Factory function to create a normal stream result.
 *
 * @template R The type of the emitted value.
 * @param value The value to emit downstream.
 * @returns A `IteratorResult<R>` object with `{ done: false, value }`.
 */
const NEXT = (value) => ({ done: false, value });
/**
 * Type guard to check if a value is an Operator.
 *
 * @param value The value to check.
 * @returns True if the value is an Operator.
 */
const isOperator = (value) => !!value &&
    typeof value === 'object' &&
    value.type === 'operator' &&
    typeof value.apply === 'function';
/**
 * Creates a reusable stream operator.
 *
 * This factory function simplifies the creation of operators by bundling a name and a
 * transformation function into a single `Operator` object.
 *
 * The returned operator automatically fills in missing `return()` and `throw()` methods
 * on the produced iterator so that downstream consumers can always clean up properly:
 *
 * - **Default `return()`**: Forwards to `source.return()` (if present) and returns the
 *   caller-supplied value or the source's return value. Errors from `source.return()` are
 *   logged as warnings rather than silently swallowed.
 * - **Default `throw()`**: Forwards to `source.throw()` (if present). If the source
 *   handles the throw and returns a non-done result, that result is forwarded. Otherwise
 *   the source is cleaned up via `source.return()` and the original error is re-thrown.
 *
 * @template T The type of the value the operator will consume.
 * @template R The type of the value the operator will produce.
 * @param name The name of the operator, for identification and debugging.
 * @param transformFn The transformation function that defines the operator's logic.
 *   Receives the operator instance as `this`, allowing access to `this.name` etc.
 * @returns A new `Operator` object with the specified name and transformation function.
 */
function createOperator(name, transformFn) {
    const op = {
        name,
        type: 'operator',
        apply(source) {
            const iterator = transformFn.call(op, source);
            if (typeof iterator.return !== 'function') {
                iterator.return = async (value) => {
                    try {
                        if (typeof source.return === 'function') {
                            const result = await source.return(value);
                            // If the source produced a meaningful return value, forward it
                            if (result != null && result.done)
                                return result;
                        }
                    }
                    catch (err) {
                        console.warn(`Operator '${name}': source.return() threw during cleanup:`, err);
                    }
                    return { done: true, value };
                };
            }
            if (typeof iterator.throw !== 'function') {
                iterator.throw = async (err) => {
                    const error = err instanceof Error ? err : new Error(String(err));
                    try {
                        if (typeof source.throw === 'function') {
                            const result = await source.throw(error);
                            // Source handled the throw — forward its result
                            if (result.done)
                                return DONE;
                            // Cast the result to IteratorResult<R> since the operator transforms T → R
                            // The value may need transformation, but we're just forwarding it
                            return result;
                        }
                    }
                    catch (sourceErr) {
                        // source.throw() re-threw or threw a different error.
                        // Fall through to cleanup + re-throw the original error.
                        if (sourceErr !== error) {
                            console.warn(`Operator '${name}': source.throw() threw an unexpected error:`, sourceErr);
                        }
                    }
                    // Source doesn't support throw, or couldn't handle it — clean up
                    try {
                        if (typeof source.return === 'function') {
                            await source.return();
                        }
                    }
                    catch (cleanupErr) {
                        console.warn(`Operator '${name}': source.return() threw during throw cleanup:`, cleanupErr);
                    }
                    throw error;
                };
            }
            return iterator;
        }
    };
    return op;
}
/**
 * Creates a push operator where `setup` receives the source iterator and a pre-created output
 * pushable. `setup` may return an optional cleanup callback that is invoked when the downstream
 * cancels iteration (`return()` / `throw()`).
 *
 * The setup function is guarded by a cancellation gate: once the operator is cancelled (via
 * `return()` or `throw()` on the output), any further pushes to the output are silently ignored.
 * This prevents pushes to a completed/closed output after teardown.
 *
 * @template T The type of values consumed by the operator.
 * @template R The type of values produced by the operator.
 * @param name The name of the operator, for debugging.
 * @param setup A function that receives the source iterator and an output pushable.
 *   May return a cleanup function to be called on cancellation.
 */
function createPushOperator(name, setup) {
    return createOperator(name, function (source) {
        const output = createAsyncPushable();
        let cancelled = false;
        // Wrap output.push with a cancellation gate so that the setup function
        // cannot push values after the operator has been torn down.
        const originalPush = output.push.bind(output);
        output.push = (value) => {
            if (cancelled)
                return output;
            return originalPush(value);
        };
        const cleanup = setup(source, output);
        let cleanupCalled = false;
        const runCleanup = async () => {
            if (cleanupCalled)
                return;
            cleanupCalled = true;
            cancelled = true;
            if (!cleanup)
                return;
            try {
                await cleanup();
            }
            catch (err) {
                console.warn(`Operator '${name}': cleanup function threw:`, err);
            }
        };
        const baseReturn = output.return?.bind(output);
        const baseThrow = output.throw?.bind(output);
        output.return = async (value) => {
            await runCleanup();
            try {
                if (typeof source.return === 'function')
                    await source.return();
            }
            catch (err) {
                console.warn(`Operator '${name}': source.return() threw during output.return():`, err);
            }
            if (typeof output.completed === 'function' && !output.completed())
                output.complete();
            return baseReturn ? baseReturn(value) : DONE;
        };
        output.throw = async (err) => {
            const error = err instanceof Error ? err : new Error(String(err));
            await runCleanup();
            try {
                if (typeof source.return === 'function')
                    await source.return();
            }
            catch (cleanupErr) {
                console.warn(`Operator '${name}': source.return() threw during output.throw():`, cleanupErr);
            }
            if (typeof output.completed === 'function' && !output.completed())
                output.error(error);
            if (baseThrow)
                return baseThrow(error);
            throw error;
        };
        return output;
    });
}

/**
 * Create a strict receiver from a callback or receiver object.
 *
 * @template T The type of values received.
 * @param {((value: T) => MaybePromise) | Receiver<T>} [callbackOrReceiver] - Callback or receiver object.
 * @returns {StrictReceiver<T>} A strict receiver instance.
 */
function createReceiver(callbackOrReceiver) {
    let _completed = false;
    let _completedScheduled = false;
    let _pendingCount = 0;
    let _idlePromise = Promise.resolve();
    let _resolveIdle = null;
    // Normalize input to a receiver object
    const target = (typeof callbackOrReceiver === 'function'
        ? { next: callbackOrReceiver }
        : callbackOrReceiver || {});
    const waitForIdle = () => {
        if (_pendingCount === 0)
            return Promise.resolve();
        return _idlePromise;
    };
    const incrementPending = () => {
        if (_pendingCount === 0) {
            _idlePromise = new Promise((resolve) => {
                _resolveIdle = resolve;
            });
        }
        _pendingCount++;
    };
    const decrementPending = () => {
        _pendingCount--;
        if (_pendingCount === 0 && _resolveIdle) {
            _resolveIdle();
            _resolveIdle = null;
        }
    };
    // Helper to safely execute a user-provided handler within the scheduler
    const runAction = (handler, ...args) => {
        if (!handler || _completed || _completedScheduled)
            return Promise.resolve();
        const action = async () => {
            // Re-check completed status inside the scheduled task
            if (_completed)
                return;
            incrementPending();
            try {
                const result = handler.apply(target, args);
                if (isPromiseLike(result))
                    await result;
            }
            catch (err) {
                // If 'next' fails, trigger error flow but don't await it to avoid deadlocks
                if (handler === target.next) {
                    void wrapped.error(err);
                }
                else {
                    console.error("Unhandled error in Receiver:", err);
                }
            }
            finally {
                decrementPending();
            }
        };
        return new Promise((resolve, reject) => {
            queueMicrotask(() => void action().then(resolve, reject));
        });
    };
    const wrapped = {
        next: (value) => {
            if (_completed)
                return Promise.resolve();
            return runAction(target.next, value);
        },
        error: (err) => {
            if (_completed || _completedScheduled)
                return Promise.resolve();
            _completedScheduled = true;
            const normalizedError = err instanceof Error ? err : new Error(String(err));
            const action = async () => {
                if (_completed)
                    return;
                // Wait for pending actions to complete
                await waitForIdle();
                _completed = true;
                try {
                    const result = target.error?.(normalizedError);
                    if (isPromiseLike(result))
                        await result;
                }
                catch (err) {
                    try {
                        console.error('Unhandled error in error handler:', err);
                    }
                    catch (_) {
                        /* ignore logging failures */
                    }
                }
            };
            return new Promise((resolve, reject) => {
                queueMicrotask(() => void action().then(resolve, reject));
            });
        },
        complete: () => {
            if (_completed || _completedScheduled)
                return Promise.resolve();
            _completedScheduled = true;
            const action = async () => {
                if (_completed)
                    return;
                // Wait for pending actions to complete
                await waitForIdle();
                _completed = true;
                try {
                    const result = target.complete?.();
                    if (isPromiseLike(result))
                        await result;
                }
                catch (err) {
                    try {
                        console.error('Unhandled error in complete handler:', err);
                    }
                    catch (_) {
                        /* ignore logging failures */
                    }
                }
            };
            return new Promise((resolve, reject) => {
                queueMicrotask(() => void action().then(resolve, reject));
            });
        },
        get completed() {
            return _completed;
        },
    };
    return wrapped;
}

/**
 * Converts a `Stream` into an async generator, yielding each emitted value.
 *
 * The generator handles all stream events:
 * - Each yielded value corresponds to a real `next` emission, including undefined.
 * - The generator terminates when the stream `complete`s.
 * - It throws an error if the stream emits an `error` event.
 *
 * @template T The type of the values emitted by the stream.
 * @param stream The source stream to convert.
 * @returns An async generator that yields the values from the stream.
 */
function eachValueFrom(stream) {
    const iterator = stream[Symbol.asyncIterator]();
    async function* generate() {
        try {
            while (true) {
                const result = await iterator.next();
                if (result.done)
                    return;
                yield result.value;
            }
        }
        finally {
            try {
                await iterator.return?.();
            }
            catch {
            }
        }
    }
    return generate();
}

/**
 * Returns a promise that resolves with the first emitted value from a `Stream`.
 *
 * - If the stream emits a value, the promise resolves with that value.
 * - If the stream emits an error, the promise rejects with that error.
 * - If the stream completes without ever emitting a value, the promise rejects with an `Error`.
 *
 * @template T The type of the value that the promise will resolve with.
 * @param stream The source stream to listen to.
 * @returns A promise that resolves with the first value from the stream or rejects on error or completion without a value.
 */
function firstValueFrom(stream) {
    const iterator = stream[Symbol.asyncIterator]();
    return (async () => {
        try {
            while (true) {
                const result = await iterator.next();
                if (result.done) {
                    throw new Error("Stream completed without emitting a value");
                }
                return result.value;
            }
        }
        finally {
            try {
                await iterator.return?.();
            }
            catch {
            }
        }
    })();
}

/**
 * Converts various value types into a Stream.
 *
 * This function normalizes different input types into a consistent Stream interface:
 * - Streams are passed through as-is
 * - Promises are awaited and their resolved values are processed
 * - Arrays have each element emitted individually
 * - Single values are emitted as-is
 *
 * @template R The type of values emitted by the resulting stream.
 * @param value The input value to convert. Can be:
 *   - a {@link Stream<R>}
 *   - a `Promise<R>` (single value)
 *   - a `Promise<Array<R>>` (multiple values from array)
 *   - a plain value `R`
 *   - an array `Array<R>`
 * @returns A {@link Stream<R>} that emits the normalized values.
 */
function fromAny(value) {
    // Step 1: If it's already a stream, return as-is
    if (isStreamLike(value)) {
        return value;
    }
    // Step 2: Handle promises, arrays, iterables, and single values in one generator
    return createStream("fromAny", async function* () {
        // Await promise if needed
        const resolved = isPromiseLike(value) ? await value : value;
        const candidate = resolved;
        if (isStreamLike(resolved)) {
            for await (const item of resolved) {
                yield item;
            }
        }
        else if (candidate != null && typeof candidate[Symbol.asyncIterator] === 'function') {
            for await (const item of resolved) {
                yield item;
            }
        }
        else if (candidate != null && typeof candidate[Symbol.iterator] === 'function' && typeof resolved !== 'string') {
            for (const item of resolved) {
                yield item;
            }
        }
        else {
            // Single value
            yield resolved;
        }
    });
}

/**
 * Returns a promise that resolves with the last emitted value from a `Stream`.
 *
 * - **Successful resolution:** The promise resolves with the last value
 *   emitted by the stream, after the stream has completed.
 * - **Rejection on error:** If the stream emits an error, the promise is rejected.
 * - **Rejection on no value:** If the stream completes without emitting any
 *   values, the promise is rejected with a specific error message.
 *
 * @template T The type of the value expected from the stream.
 * @param stream The source stream to listen to for the final value.
 * @returns A promise that resolves with the last value from the stream or rejects on completion without a value or on error.
 */
function lastValueFrom(stream) {
    const iterator = stream[Symbol.asyncIterator]();
    return (async () => {
        let hasValue = false;
        let lastValue;
        try {
            while (true) {
                const next = await iterator.next();
                if (next.done)
                    break;
                hasValue = true;
                lastValue = next.value;
            }
            if (!hasValue) {
                throw new Error("Stream completed without emitting a value");
            }
            return lastValue;
        }
        finally {
            try {
                await iterator.return?.();
            }
            catch {
            }
        }
    })();
}

/**
 * Coordinator utilities for merging and managing multiple async iterators.
 *
 * Provides the {@link createAsyncCoordinator} function, which enables dynamic addition and removal of sources,
 * push notification support and correct emission ordering for both sync and async sources.
 *
 * @module coordinator
 */
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
function createAsyncCoordinator(sources = [], options) {
    const queue = [];
    // Use sparse arrays to support dynamic indices
    const sourceList = [...sources];
    const completed = sources.map(() => false);
    const pulling = sources.map(() => false);
    const pendingPulls = sources.map(() => false);
    const originalPushHandlers = [];
    const wiredPushHandlers = [];
    let waitingResolve = null;
    let isDraining = false;
    let iteratorReturned = false;
    let activeCount = sources.length;
    let batchDepth = 0;
    // Optional key -> source iterator mapping for reference-based removal.
    const keyToSource = new Map();
    /** Checks if all sources are completed. */
    const allDone = () => activeCount === 0;
    /**
     * Pushes a runner event to the coordinator's queue.
     * @param event The event to push.
     * @param sourceIndex The index of the source that generated the event.
     */
    function pushEvent(event, sourceIndex) {
        queue.push({
            result: NEXT(event),
            sourceIndex
        });
    }
    /**
     * Removes all queued events from a specific source.
     * @param sourceIndex The index of the source whose events should be removed.
     */
    function removeQueuedEvents(sourceIndex) {
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
    function markSourceComplete(index) {
        if (!completed[index]) {
            completed[index] = true;
            activeCount--;
        }
    }
    /**
     * Removes the key associated with a source iterator.
     * @param source The source iterator to remove from the key map.
     */
    function removeSourceKey(source) {
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
    function detachSource(index) {
        if (index < 0 || index >= sourceList.length)
            return null;
        const source = sourceList[index];
        if (!source)
            return null;
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
    function safeReturnSource(source) {
        if (!source.return)
            return Promise.resolve();
        try {
            return Promise.resolve(source.return()).then(() => undefined, () => undefined);
        }
        catch {
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
        if (!waitingResolve)
            return;
        if (queue.length > 0) {
            const item = queue.shift();
            const res = waitingResolve;
            waitingResolve = null;
            res(item.result);
        }
        else if (allDone()) {
            const res = waitingResolve;
            waitingResolve = null;
            res(DONE);
        }
    }
    /**
     * Asynchronously pulls the next value from a source.
     * @param i The index of the source to pull from.
     */
    function pullAsync(i) {
        // CRITICAL: Don't start a new pull if already pulling, completed, removed, or returned
        if (!sourceList[i] || completed[i] || pulling[i] || iteratorReturned)
            return;
        pulling[i] = true;
        pendingPulls[i] = false;
        const src = sourceList[i];
        src.next().then((r) => {
            pulling[i] = false;
            // Don't process if source was completed/removed during the async wait
            if (sourceList[i] !== src || completed[i] || iteratorReturned)
                return;
            if (r.done) {
                markSourceComplete(i);
                pushEvent({ type: "complete", sourceIndex: i }, i);
            }
            else {
                pushEvent({ type: "value", value: r.value, sourceIndex: i }, i);
            }
            notify();
            // CRITICAL: Only schedule next pull if there are more values AND not already pulling
            // AND not completed AND there's a pending pull request
            if (sourceList[i] && !completed[i] && !pulling[i] && pendingPulls[i]) {
                pendingPulls[i] = false;
                Promise.resolve().then(() => pullAsync(i));
            }
        }, (err) => {
            pulling[i] = false;
            if (sourceList[i] !== src || completed[i] || iteratorReturned)
                return;
            markSourceComplete(i);
            pushEvent({ type: "error", error: normalizeError(err), sourceIndex: i }, i);
            notify();
        });
    }
    /**
     * Drains a single event from one source, using `__tryNext` if available.
     * @param i The index of the source to drain.
     */
    function drainOneSource(i) {
        if (!sourceList[i] || completed[i] || iteratorReturned)
            return;
        const src = sourceList[i];
        if (src.__tryNext) {
            try {
                const r = src.__tryNext();
                if (!r)
                    return;
                if (r.done) {
                    markSourceComplete(i);
                    pushEvent({ type: "complete", sourceIndex: i }, i);
                }
                else {
                    pushEvent({ type: "value", value: r.value, sourceIndex: i }, i);
                }
            }
            catch (err) {
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
        if (isDraining || iteratorReturned)
            return;
        isDraining = true;
        try {
            for (let i = 0; i < sourceList.length; i++) {
                if (!sourceList[i] || completed[i])
                    continue;
                // Drain at most one event per source per pass. For push-based sources,
                // __onPush triggers this function repeatedly, preserving cross-source
                // emission ordering without source-local metadata.
                drainOneSource(i);
            }
        }
        finally {
            isDraining = false;
        }
        notify();
    }
    /**
     * Wires up a source's `__onPush` handler to trigger a drain.
     * @param src The source iterator.
     * @param index The index of the source.
     */
    function wireSource(src, index) {
        const orig = src.__onPush;
        const wired = () => {
            try {
                orig?.();
            }
            catch {
                // Preserve draining even if the source's push hook throws.
            }
            if (sourceList[index] !== src)
                return;
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
    function restoreSource(src, index) {
        const source = src;
        if (source.__onPush === wiredPushHandlers[index]) {
            source.__onPush = originalPushHandlers[index];
        }
        originalPushHandlers[index] = undefined;
        wiredPushHandlers[index] = undefined;
    }
    // Wire up initial sources
    for (let i = 0; i < sources.length; i++) {
        wireSource(sources[i], i);
    }
    const iterator = {
        [Symbol.asyncIterator]() {
            return this;
        },
        next() {
            if (iteratorReturned)
                return Promise.resolve(DONE);
            drainSources();
            if (queue.length > 0) {
                const item = queue.shift();
                return Promise.resolve(item.result);
            }
            if (allDone())
                return Promise.resolve(DONE);
            return new Promise(res => {
                waitingResolve = res;
            });
        },
        __tryNext() {
            if (iteratorReturned)
                return DONE;
            drainSources();
            if (queue.length > 0) {
                const item = queue.shift();
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
            await Promise.all(sourceList
                .filter((source) => source !== null)
                .map(source => safeReturnSource(source)));
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
        addSource(source, key) {
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
            }
            else {
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
        async removeSource(index) {
            const source = detachSource(index);
            if (!source)
                return;
            await safeReturnSource(source);
            // Notify in case we're waiting and all sources are now done
            notify();
        },
        /**
         * Remove a source by the key passed to {@link addSource}.
         *
         * @param key Key of the source to remove
         */
        async removeSourceByKey(key) {
            const source = keyToSource.get(key);
            if (!source)
                return;
            const index = sourceList.indexOf(source);
            if (index >= 0) {
                await iterator.removeSource(index);
            }
            else {
                keyToSource.delete(key);
            }
        },
        /**
         * Batch multiple source additions/removals and emit a single notification
         * after the batch completes.
         *
         * @param callback Function that performs source changes
         */
        batch(callback) {
            batchDepth++;
            try {
                callback();
            }
            finally {
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
        getActiveSourceCount() {
            return activeCount;
        },
        /**
         * Check if a specific source is completed.
         *
         * @param index Source index to check
         * @returns true if source is completed or removed, false otherwise
         */
        isSourceComplete(index) {
            if (index < 0 || index >= sourceList.length)
                return true;
            return sourceList[index] === null || completed[index];
        }
    };
    // Initial drain - sync or microtask based on options
    if (sources.length > 0) {
        if (options?.syncDrain) {
            drainSources();
        }
        else {
            Promise.resolve().then(() => drainSources());
        }
    }
    return iterator;
}
/**
 * Gets an iterator from an iterable object.
 * Supports both synchronous and asynchronous iterables.
 *
 * @param iterable The iterable to get an iterator from.
 * @returns An `AsyncIterator` or `Iterator`.
 * @throws If the provided object is not iterable.
 */
function getIterator(iterable) {
    const asyncIter = iterable[Symbol.asyncIterator];
    if (asyncIter)
        return asyncIter.call(iterable);
    const syncIter = iterable[Symbol.iterator];
    if (syncIter)
        return syncIter.call(iterable);
    throw new Error("Source is not iterable");
}
/**
 * Races an iterator's `next()` call against an `AbortSignal`.
 * If the signal is aborted, the promise resolves with a `done: true` result.
 */
function raceNext(iterator, signal) {
    if (signal.aborted) {
        return Promise.resolve({ done: true, value: undefined });
    }
    const pending = Promise.resolve(iterator.next());
    return new Promise((resolve, reject) => {
        const onAbort = () => resolve({ done: true, value: undefined });
        signal.addEventListener("abort", onAbort, { once: true });
        pending.then((result) => {
            signal.removeEventListener("abort", onAbort);
            resolve(result);
        }, (err) => {
            signal.removeEventListener("abort", onAbort);
            reject(err);
        });
    });
}

/**
 * Creates a factory that produces fresh `AsyncIterator` instances backed by
 * an internal queue with producer-backpressure.
 *
 * The `register` callback receives an `Observer<T>` whose `next()`/`complete()`/
 * `error()` methods push into the iterator's queue. `next()` returns a
 * `Promise<void>` (or `void`) — the promise acts as a backpressure signal
 * from the consumer: it resolves only when the consumer pulls the value with
 * `next()` or `__tryNext()`.
 *
 * Each call of the returned factory function creates an independent iterator
 * with its own buffer and subscription.
 *
 * When `lazy: true`, registration is deferred until the consumer actually pulls
 * (either `next()` or `__tryNext>`), which avoids hidden subscriptions for
 * iterators that are constructed but never consumed.
 *
 * Each call of the returned factory function creates an independent iterator
 * with its own buffer and subscription.
 *
 * @template T Value type.
 * @param opts Registration function and lazy mode.
 * @returns A function that creates a fresh AsyncIterator per call.
 */
function createAsyncIterator(opts) {
    const { register } = opts;
    const conflate = opts.conflate ?? false;
    return () => {
        const state = new AsyncIteratorState();
        let sub = null;
        let receiver = null;
        const pendingPushes = [];
        const ensureSubscribed = () => {
            if (state.completed)
                return;
            if (!sub && !receiver) {
                const _receiver = {
                    next(value) {
                        return pushValue(state, iterator, value, iterator.__onPush);
                    },
                    complete() {
                        pushComplete(state, iterator, iterator.__onPush);
                    },
                    error(err) {
                        pushError(state, iterator, err, iterator.__onPush);
                    },
                    get completed() {
                        return state.completed;
                    }
                };
                const nextSub = register(_receiver);
                receiver = _receiver;
                sub = nextSub;
                for (const push of pendingPushes) {
                    if (push.type === 'next') {
                        _receiver.next(push.value);
                    }
                    else if (push.type === 'complete') {
                        _receiver.complete();
                    }
                    else if (push.type === 'error') {
                        _receiver.error(push.err);
                    }
                }
                pendingPushes.length = 0;
            }
            return receiver;
        };
        const handleDone = () => {
            const unsubscribePromise = sub?.unsubscribe();
            sub = null;
            if (unsubscribePromise && isPromiseLike(unsubscribePromise)) {
                unsubscribePromise.catch(() => { });
            }
        };
        const iterator = {
            next() {
                try {
                    ensureSubscribed();
                }
                catch (err) {
                    return Promise.reject(normalizeError(err));
                }
                return asyncPull(state, iterator, handleDone);
            },
            async return() {
                state.markCompleted();
                const unsubscribePromise = sub?.unsubscribe();
                sub = null;
                try {
                    await unsubscribePromise;
                }
                catch { }
                return Promise.resolve(DONE);
            },
            async throw(err) {
                const error = normalizeError(err);
                state.completed = true;
                state.pendingError = null;
                state.queue.length = 0;
                const unsubscribePromise = sub?.unsubscribe();
                sub = null;
                receiver = null;
                if (state.pullReject) {
                    const r = state.pullReject;
                    state.pullResolve = state.pullReject = null;
                    r(error);
                }
                state.clear();
                try {
                    await unsubscribePromise;
                }
                catch { }
                return Promise.reject(error);
            }
        };
        iterator.__hasBufferedValues = () => state.hasBufferedValues() || pendingPushes.length > 0;
        iterator.__tryNext = () => {
            ensureSubscribed();
            return syncPull(state, iterator, handleDone);
        };
        iterator.__pushNext = (value) => {
            if (receiver) {
                receiver.next(value);
            }
            else if (conflate &&
                pendingPushes.length > 0 &&
                pendingPushes[pendingPushes.length - 1].type === 'next') {
                pendingPushes[pendingPushes.length - 1] = { type: 'next', value };
            }
            else {
                pendingPushes.push({ type: 'next', value });
            }
        };
        iterator.__pushComplete = () => {
            if (receiver) {
                receiver.complete();
            }
            else {
                pendingPushes.push({ type: 'complete' });
            }
        };
        iterator.__pushError = (err) => {
            if (receiver) {
                receiver.error(err);
            }
            else {
                pendingPushes.push({ type: 'error', err });
            }
        };
        return iterator;
    };
}

/**
 * Create a `BehaviorSubject` seeded with `initialValue`.
 *
 * @template T
 * @param {T} initialValue - initial value held by the subject
 * @returns {BehaviorSubject<T>} a new behavior subject
 */
function createBehaviorSubject(initialValue) {
    let latestValue = initialValue;
    let isCompleted = false;
    let completionInfo = null;
    const listeners = new Set();
    const next = (value) => {
        if (isCompleted)
            return;
        latestValue = value;
        for (const listener of listeners) {
            listener.push(value);
        }
    };
    const complete = () => {
        if (isCompleted)
            return;
        isCompleted = true;
        for (const listener of listeners) {
            listener.complete();
        }
        listeners.clear();
    };
    const error = (err) => {
        if (isCompleted)
            return;
        isCompleted = true;
        const error = normalizeError(err);
        completionInfo = { kind: 'error', error };
        for (const listener of listeners) {
            listener.error(error);
        }
        listeners.clear();
    };
    const subscribe = (cb) => {
        const listener = createAsyncPushable();
        listeners.add(listener);
        const receiver = createReceiver(cb);
        let isProcessing = false;
        let stopped = false;
        const drain = () => {
            if (isProcessing)
                return;
            isProcessing = true;
            try {
                while (true) {
                    let result;
                    try {
                        result = listener.__tryNext();
                    }
                    catch (e) {
                        receiver.error?.(e);
                        listeners.delete(listener);
                        return;
                    }
                    if (!result)
                        break;
                    if (result.done) {
                        receiver.complete?.();
                        listeners.delete(listener);
                        return;
                    }
                    // Skip next values after unsubscribe, but keep draining
                    // so the terminal signal (DONE) can still be delivered.
                    if (stopped)
                        continue;
                    if (receiver.next) {
                        const ret = receiver.next(result.value);
                        if (isPromiseLike(ret)) {
                            ret.then(() => {
                                isProcessing = false;
                                drain();
                            }, () => {
                                isProcessing = false;
                                drain();
                            });
                            return;
                        }
                    }
                }
            }
            catch (err) {
                receiver.error?.(err);
            }
            isProcessing = false;
        };
        listener.__onPush = drain;
        // Replay current value only if the subject is still alive.
        // After completion/error, late subscribers receive only the terminal signal.
        if (!isCompleted) {
            listener.push(latestValue);
        }
        if (isCompleted) {
            if (completionInfo?.kind === 'error')
                listener.error(completionInfo.error);
            else
                listener.complete();
        }
        // Initial drain
        drain();
        const sub = createSubscription(async () => {
            listeners.delete(listener);
            listener.complete();
        });
        const origUnsub = sub.unsubscribe.bind(sub);
        sub.unsubscribe = () => {
            stopped = true;
            return origUnsub();
        };
        return sub;
    };
    const self = {
        type: "subject",
        name: "behaviorSubject",
        get value() { return latestValue; },
        next,
        complete,
        error,
        completed: () => isCompleted,
        pipe: (...steps) => {
            return pipeSourceThrough(self, steps);
        },
        subscribe,
        query: () => firstValueFrom(self),
        toArray: () => streamToArray(self),
        [Symbol.asyncIterator]: () => {
            const listener = createAsyncPushable();
            // Replay current value only if the subject is still alive.
            if (!isCompleted) {
                listeners.add(listener);
                listener.push(latestValue);
            }
            else if (completionInfo?.kind === 'error') {
                listener.error(completionInfo.error);
            }
            else {
                listener.complete();
            }
            const originalReturn = listener.return.bind(listener);
            const originalThrow = listener.throw.bind(listener);
            const originalNext = listener.next.bind(listener);
            const originalTryNext = listener.__tryNext.bind(listener);
            listener.return = async (v) => {
                listeners.delete(listener);
                return originalReturn(v);
            };
            listener.throw = async (err) => {
                listeners.delete(listener);
                return originalThrow(err);
            };
            listener.next = originalNext;
            listener.__tryNext = originalTryNext;
            return listener;
        }
    };
    return self;
}

/**
 * Create a `ReplaySubject` with an optional capacity of buffered items.
 *
 * @template T
 * @param {number} [capacity=Infinity] - max number of values to retain
 * @returns {ReplaySubject<T>} a new replay subject
 */
function createReplaySubject(capacity = Infinity) {
    let latestValue;
    let isCompleted = false;
    let completionInfo = null;
    const listeners = new Set();
    const isFiniteCapacity = capacity !== Infinity;
    const replay = [];
    let replayHead = 0;
    const pushReplay = (value) => {
        if (!isFiniteCapacity) {
            replay.push(value);
            return;
        }
        if (capacity <= 0)
            return;
        if (replay.length < capacity) {
            replay.push(value);
        }
        else {
            replay[replayHead] = value;
            replayHead = (replayHead + 1) % capacity;
        }
    };
    const forEachReplay = (fn) => {
        if (!isFiniteCapacity) {
            for (const value of replay)
                fn(value);
            return;
        }
        if (capacity <= 0)
            return;
        const size = replay.length;
        const start = size < capacity ? 0 : replayHead;
        for (let i = 0; i < size; i++) {
            fn(replay[(start + i) % capacity]);
        }
    };
    const next = (value) => {
        if (isCompleted)
            return;
        latestValue = value;
        pushReplay(value);
        for (const listener of listeners) {
            listener.push(value);
        }
    };
    const complete = () => {
        if (isCompleted)
            return;
        isCompleted = true;
        for (const listener of listeners) {
            listener.complete();
        }
        listeners.clear();
    };
    const error = (err) => {
        if (isCompleted)
            return;
        isCompleted = true;
        const error = normalizeError(err);
        completionInfo = { kind: 'error', error };
        for (const listener of listeners) {
            listener.error(error);
        }
        listeners.clear();
    };
    const subscribe = (cb) => {
        const listener = createAsyncPushable();
        listeners.add(listener);
        const receiver = createReceiver(cb);
        let isProcessing = false;
        let stopped = false;
        const drain = () => {
            if (isProcessing)
                return;
            isProcessing = true;
            try {
                while (true) {
                    let result;
                    try {
                        result = listener.__tryNext();
                    }
                    catch (e) {
                        receiver.error?.(e);
                        listeners.delete(listener);
                        return;
                    }
                    if (!result)
                        break;
                    if (result.done) {
                        receiver.complete?.();
                        listeners.delete(listener);
                        return;
                    }
                    // Skip next values after unsubscribe, but keep draining
                    // so the terminal signal (DONE) can still be delivered.
                    if (stopped)
                        continue;
                    if (receiver.next) {
                        const ret = receiver.next(result.value);
                        if (isPromiseLike(ret)) {
                            ret.then(() => {
                                isProcessing = false;
                                drain();
                            }, () => {
                                isProcessing = false;
                                drain();
                            });
                            return;
                        }
                    }
                }
            }
            catch (err) {
                receiver.error?.(err);
            }
            isProcessing = false;
        };
        listener.__onPush = drain;
        // Replay buffered values
        forEachReplay((value) => listener.push(value));
        if (isCompleted) {
            if (completionInfo?.kind === 'error')
                listener.error(completionInfo.error);
            else
                listener.complete();
        }
        // Initial drain
        drain();
        const sub = createSubscription(async () => {
            listeners.delete(listener);
            listener.complete();
        });
        const origUnsub = sub.unsubscribe.bind(sub);
        sub.unsubscribe = () => {
            stopped = true;
            return origUnsub();
        };
        return sub;
    };
    const self = {
        type: "subject",
        name: "replaySubject",
        get value() { return latestValue; },
        next,
        complete,
        error,
        completed: () => isCompleted,
        pipe: (...steps) => {
            return pipeSourceThrough(self, steps);
        },
        subscribe,
        query: () => firstValueFrom(self),
        toArray: () => streamToArray(self),
        [Symbol.asyncIterator]: () => {
            const listener = createAsyncPushable();
            // Replay buffered values
            forEachReplay((value) => listener.push(value));
            if (!isCompleted) {
                listeners.add(listener);
            }
            else if (completionInfo?.kind === 'error') {
                listener.error(completionInfo.error);
            }
            else {
                listener.complete();
            }
            const originalReturn = listener.return.bind(listener);
            const originalThrow = listener.throw.bind(listener);
            const originalNext = listener.next.bind(listener);
            const originalTryNext = listener.__tryNext.bind(listener);
            listener.return = async (v) => {
                listeners.delete(listener);
                return originalReturn(v);
            };
            listener.throw = async (err) => {
                listeners.delete(listener);
                return originalThrow(err);
            };
            listener.next = originalNext;
            listener.__tryNext = originalTryNext;
            return listener;
        }
    };
    return self;
}

/**
 * Create a plain `Subject` which buffers emissions and delivers them to
 * current subscribers. The returned subject can be used as an async
 * iterable and as an imperative emitter via `next`/`complete`/`error`.
 *
 * @template T
 * @returns {Subject<T>} A new subject instance.
 */
function createSubject() {
    let latestValue;
    let isCompleted = false;
    let completionInfo = null;
    const listeners = new Set();
    const next = (value) => {
        if (isCompleted)
            return;
        latestValue = value;
        // Deliver to all current listeners
        for (const listener of listeners) {
            listener.push(value);
        }
    };
    const complete = () => {
        if (isCompleted)
            return;
        isCompleted = true;
        for (const listener of listeners) {
            listener.complete();
        }
        listeners.clear();
    };
    const error = (err) => {
        if (isCompleted)
            return;
        isCompleted = true;
        const error = normalizeError(err);
        completionInfo = { kind: 'error', error };
        for (const listener of listeners) {
            listener.error(error);
        }
        listeners.clear();
    };
    const subscribe = (cb) => {
        const listener = createAsyncPushable();
        listeners.add(listener);
        const receiver = createReceiver(cb);
        let isProcessing = false;
        let stopped = false;
        const drain = () => {
            if (isProcessing)
                return;
            isProcessing = true;
            try {
                while (true) {
                    let result;
                    try {
                        result = listener.__tryNext();
                    }
                    catch (e) {
                        receiver.error?.(e);
                        listeners.delete(listener);
                        return;
                    }
                    if (!result)
                        break;
                    if (result.done) {
                        receiver.complete?.();
                        listeners.delete(listener);
                        return;
                    }
                    // Skip next values after unsubscribe, but keep draining
                    // so the terminal signal (DONE) can still be delivered.
                    if (stopped)
                        continue;
                    if (receiver.next) {
                        const ret = receiver.next(result.value);
                        if (isPromiseLike(ret)) {
                            ret.then(() => {
                                isProcessing = false;
                                drain();
                            }, (err) => {
                                // If receiver.next() rejects, report the error and resume draining
                                // to prevent buffered values from stalling.
                                isProcessing = false;
                                receiver.error?.(err);
                                drain();
                            });
                            return;
                        }
                    }
                }
            }
            catch (err) {
                receiver.error?.(err);
            }
            isProcessing = false;
        };
        listener.__onPush = drain;
        if (isCompleted) {
            if (completionInfo?.kind === 'error')
                listener.error(completionInfo.error);
            else
                listener.complete();
        }
        // Initial drain
        drain();
        const sub = createSubscription(async () => {
            listeners.delete(listener);
            listener.complete();
        });
        const origUnsub = sub.unsubscribe.bind(sub);
        sub.unsubscribe = () => {
            stopped = true;
            return origUnsub();
        };
        return sub;
    };
    const self = {
        type: "subject",
        name: "subject",
        get value() { return latestValue; },
        next,
        complete,
        error,
        completed: () => isCompleted,
        pipe: (...steps) => {
            return pipeSourceThrough(self, steps);
        },
        subscribe,
        query: () => firstValueFrom(self),
        toArray: () => streamToArray(self),
        [Symbol.asyncIterator]: () => {
            const listener = createAsyncPushable();
            if (!isCompleted) {
                listeners.add(listener);
            }
            else if (completionInfo?.kind === 'error') {
                listener.error(completionInfo.error);
            }
            else {
                listener.complete();
            }
            const originalReturn = listener.return.bind(listener);
            const originalThrow = listener.throw.bind(listener);
            const originalNext = listener.next.bind(listener);
            const originalTryNext = listener.__tryNext.bind(listener);
            listener.return = async (v) => {
                listeners.delete(listener);
                return originalReturn(v);
            };
            listener.throw = async (err) => {
                listeners.delete(listener);
                return originalThrow(err);
            };
            listener.next = originalNext;
            listener.__tryNext = originalTryNext;
            return listener;
        }
    };
    return self;
}

/**
 * Creates a new `Subscription` instance.
 *
 * This factory encapsulates subscription state and ensures:
 * - Safe, idempotent unsubscription
 * - Proper execution of cleanup logic
 * - Consistent error handling during teardown
 *
 * @param teardown Optional cleanup callback executed on first unsubscribe
 * @returns {Subscription} A new Subscription object
 */
function createSubscription(teardown) {
    /** Internal mutable subscription state */
    let _unsubscribed = false;
    return {
        /**
       * - `true`  - subscription has been unsubscribed and is inactive
         */
        get unsubscribed() {
            return _unsubscribed;
        },
        /**
         * Unsubscribes from the subscription.
         *
         * This method:
         * 1. Marks the subscription as unsubscribed
         * 2. Executes the `teardown` callback (if present)
         * 3. Suppresses any errors thrown during cleanup
         */
        unsubscribe: async function () {
            if (!_unsubscribed) {
                _unsubscribed = true;
                try {
                    await this.teardown?.();
                }
                catch { }
            }
        },
        /**
         * Cleanup callback executed when unsubscribing.
         */
        teardown: teardown
    };
}

/**
 * Type guard to check if a value is stream-like (has type and async iterator).
 *
 * @template T
 * @param value The value to check.
 * @returns {boolean} True if the value is a Stream.
 */
const isStreamLike = (value) => {
    if (!value || (typeof value !== "object" && typeof value !== "function"))
        return false;
    const v = value;
    return ((v.type === "stream" || v.type === "subject") &&
        typeof v[Symbol.asyncIterator] === "function");
};
async function streamToArray(stream) {
    const iterator = stream[Symbol.asyncIterator]();
    const result = [];
    try {
        while (true) {
            const next = await iterator.next();
            if (next.done)
                break;
            result.push(next.value);
        }
        return result;
    }
    finally {
        try {
            await iterator.return?.();
        }
        catch { }
    }
}
function waitForAbort(signal) {
    if (signal.aborted)
        return Promise.resolve();
    return new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
}
async function drainIterator(iterator, getReceivers, signal) {
    const abortPromise = waitForAbort(signal);
    const processResult = (result) => {
        if (result.done)
            return true;
        const receivers = getReceivers();
        for (const { receiver, subscription } of receivers) {
            if (!subscription.unsubscribed) {
                try {
                    const ret = receiver.next?.(result.value);
                    // Fire async callbacks without blocking the source.
                    // Per-subscriber backpressure is handled by the receiver's own
                    // buffering (e.g. Subject's AsyncPushable queue).
                    if (isPromiseLike(ret)) {
                        ret.catch((err) => {
                            const error = err instanceof Error ? err : new Error(String(err));
                            receiver.error?.(error);
                        });
                    }
                }
                catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    receiver.error?.(error);
                }
            }
        }
        return false;
    };
    let forwardedError = false;
    try {
        while (true) {
            if (iterator.__tryNext) {
                while (true) {
                    const nextResult = iterator.__tryNext();
                    if (!nextResult)
                        break;
                    if (processResult(nextResult))
                        return;
                }
            }
            const winner = await Promise.race([
                abortPromise.then(() => ({ aborted: true })),
                iterator.next().then((result) => ({ result })),
            ]);
            if ("aborted" in winner || signal.aborted)
                break;
            if (processResult(winner.result))
                break;
        }
    }
    catch (err) {
        if (!signal.aborted) {
            const error = err instanceof Error ? err : new Error(String(err));
            for (const { receiver, subscription } of getReceivers()) {
                if (!subscription.unsubscribed) {
                    receiver.error?.(error);
                    forwardedError = true;
                }
            }
        }
    }
    finally {
        const entries = getReceivers();
        if (iterator.return) {
            try {
                await iterator.return();
            }
            catch { }
        }
        if (!signal.aborted && !forwardedError) {
            for (const { receiver, subscription } of entries) {
                if (!subscription.unsubscribed) {
                    receiver.complete?.();
                }
            }
        }
        entries.length = 0;
    }
}
/**
 * Creates a multicast {@link Stream} from an async generator factory.
 *
 * The returned Stream starts producing values on the first subscription and
 * delivers each yielded value to *all* active subscribers.
 *
 * - When the last subscriber unsubscribes, the underlying generator is aborted
 *   via an {@link AbortSignal}.
 * - When the generator completes, subscribers are completed and internal
 *   receiver references are cleared to avoid memory growth in long-running
 *   processes/tests.
 * - A new subscription after completion starts a fresh generator run.
 *
 * Receiver callbacks are executed in a microtask when there is no active
 * emission context, which helps keep delivery ordering consistent and avoids
 * surprising re-entrancy.
 *
 * @template T Value type emitted by the stream.
 * @param name Human-friendly name (used for debugging/tracing).
 * @param generatorFn Async generator factory. Receives an optional AbortSignal
 * that is aborted when the stream is torn down.
 * @returns A Stream that can be piped, subscribed to, or iterated.
 *
 * @example
 * const s = createStream('ticks', async function* (signal) {
 *   while (!signal?.aborted) {
 *     yield Date.now();
 *     await new Promise(r => setTimeout(r, 1000));
 *   }
 * });
 */
function createStream(name, generatorFn) {
    let activeRun = null;
    const startNewRun = () => {
        // Create new run state
        const abortController = new AbortController();
        const subject = createSubject();
        subject.name = name;
        subject.type = 'stream';
        const run = { subject, abortController, subscriberCount: 0 };
        // activeRun = run; // Caller handles this
        void (async () => {
            const signal = abortController.signal;
            const gen = generatorFn(signal)[Symbol.asyncIterator]();
            try {
                while (!signal.aborted) {
                    if (gen.__tryNext) {
                        while (true) {
                            const result = gen.__tryNext();
                            if (!result)
                                break;
                            if (result.done) {
                                run.subject.complete();
                                return;
                            }
                            run.subject.next(result.value);
                        }
                    }
                    const result = await Promise.race([
                        waitForAbort(signal).then(() => ({ aborted: true })),
                        gen.next().then((r) => ({ result: r })),
                    ]);
                    if ("aborted" in result || signal.aborted)
                        break;
                    if (result.result.done) {
                        run.subject.complete();
                        break;
                    }
                    run.subject.next(result.result.value);
                }
            }
            catch (err) {
                if (!signal.aborted) {
                    run.subject.error(err instanceof Error ? err : new Error(String(err)));
                }
            }
            finally {
                if (gen.return) {
                    try {
                        await gen.return();
                    }
                    catch { }
                }
                // If this was the active run, clear it.
                // Note: It might have been replaced already if we restarted.
                if (activeRun === run) {
                    activeRun = null;
                }
            }
        })();
        return run;
    };
    /**
     * Wrapper to track subscriber count and manage generator lifecycle.
     */
    const wrappedSubscribe = (cb) => {
        if (!activeRun || activeRun.abortController.signal.aborted) {
            activeRun = startNewRun();
        }
        const run = activeRun;
        run.subscriberCount++;
        const sub = run.subject.subscribe(cb);
        let unsubscribed = false;
        const originalUnsubscribe = sub.unsubscribe.bind(sub);
        sub.unsubscribe = async () => {
            if (unsubscribed)
                return;
            unsubscribed = true;
            await originalUnsubscribe();
            run.subscriberCount = Math.max(0, run.subscriberCount - 1);
            if (run.subscriberCount === 0 &&
                activeRun === run &&
                !run.abortController.signal.aborted) {
                run.abortController.abort();
            }
        };
        return sub;
    };
    let self;
    const pipe = ((...ops) => pipeSourceThrough(self, ops));
    self = {
        type: "stream",
        name,
        pipe,
        subscribe: wrappedSubscribe,
        query: () => firstValueFrom(self),
        toArray: () => streamToArray(self),
        [Symbol.asyncIterator]: () => {
            const factory = createAsyncIterator({
                register: (receiver) => wrappedSubscribe(receiver)
            });
            return factory();
        },
    };
    return self;
}
/**
 * Applies a list of operators to a source stream and returns the resulting stream.
 *
 * This is the implementation behind `stream.pipe(...)`.
 *
 * @template TIn Source value type.
 * @param source Source stream.
 * @param operators Operators to apply, in order.
 * @returns A new Stream that emits the transformed values.
 */
function pipeSourceThrough(source, operators) {
    const getSourceIterator = (stream) => stream[Symbol.asyncIterator]();
    const applyOperators = (baseSource) => {
        let iterator = baseSource;
        for (const op of operators) {
            iterator = op.apply(iterator);
        }
        if (typeof iterator[Symbol.asyncIterator] !== "function") {
            iterator[Symbol.asyncIterator] = () => iterator;
        }
        return iterator;
    };
    function registerReceiver(receiver) {
        const abortController = new AbortController();
        const signal = abortController.signal;
        const subscription = createSubscription(async () => {
            abortController.abort();
            receiver.complete?.();
        });
        const entries = [{ receiver, subscription }];
        const baseSource = getSourceIterator(source);
        const iterator = applyOperators(baseSource);
        queueMicrotask(() => {
            drainIterator(iterator, () => entries, signal).catch(() => { });
        });
        return subscription;
    }
    const pipedStream = {
        name: `${source.name}Sink`,
        type: "stream",
        pipe: (...nextOps) => pipeSourceThrough(pipedStream, nextOps),
        subscribe: (cb) => registerReceiver(createReceiver(cb)),
        query: () => firstValueFrom(pipedStream),
        toArray: () => streamToArray(pipedStream),
        [Symbol.asyncIterator]: () => {
            const iterator = applyOperators(getSourceIterator(source));
            const publicIterator = {
                async next() {
                    return iterator.next();
                },
                async return(value) {
                    if (iterator.return) {
                        return iterator.return(value);
                    }
                    return { done: true, value };
                },
                async throw(err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    if (iterator.throw) {
                        return iterator.throw(error);
                    }
                    throw error;
                },
            };
            publicIterator[Symbol.asyncIterator] = () => publicIterator;
            return publicIterator;
        },
    };
    return pipedStream;
}

/**
 * Creates a stream operator that emits the latest value from the source stream
 * at most once per specified duration.
 *
 * Each incoming value is stored as the "latest"; a timer emits that latest value
 * when the duration elapses. All values that arrive between timer ticks and are
 * ultimately superseded are forwarded with `dropped: true` so that backpressure
 * is released without surfacing them as real emissions.
 *
 * @template T The type of the values in the stream.
 * @param duration The time in milliseconds (or a promise resolving to it) to wait
 * before emitting the latest value.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const audit = (duration) => createPushOperator('audit', (source, output) => {
    let bufferedResult;
    let timerId;
    let resolvedDuration;
    let completed = false;
    const flush = () => {
        if (!bufferedResult)
            return;
        output.push(bufferedResult.value);
        bufferedResult = undefined;
        timerId = undefined;
        if (completed)
            output.complete();
    };
    const startTimer = () => {
        if (resolvedDuration === undefined || timerId !== undefined)
            return;
        timerId = setTimeout(flush, resolvedDuration);
    };
    void (async () => {
        try {
            resolvedDuration = isPromiseLike(duration) ? await duration : duration;
            while (true) {
                const result = await source.next();
                if (result.done) {
                    completed = true;
                    if (bufferedResult)
                        flush();
                    break;
                }
                bufferedResult = result;
                startTimer();
            }
        }
        catch (err) {
            output.error(normalizeError(err));
        }
        finally {
            if (timerId) {
                clearTimeout(timerId);
                timerId = undefined;
            }
            if (!output.completed())
                output.complete();
        }
    })();
    return () => {
        if (timerId) {
            clearTimeout(timerId);
            timerId = undefined;
        }
    };
});

/**
 * Combines multiple streams and emits a tuple containing the latest values
 * from each stream whenever any of the source streams emits a new value.
 *
 * This operator is useful for scenarios where you need to react to changes
 * in multiple independent data sources simultaneously. The output stream
 * will not emit a value until all source streams have emitted at least one
 * value. The output stream completes when all source streams have completed.
 *
 * @template {unknown[]} T A tuple type representing the combined values from the sources.
 * @param sources Streams or values (including promises) to combine.
 * @returns {Stream<T>} A new stream that emits a tuple of the latest values from all source streams.
 */
function combineLatest(...sources) {
    const gen = async function* () {
        if (sources.length === 0)
            return;
        const iterators = sources.map((s) => {
            const resolved = fromAny(s);
            return resolved[Symbol.asyncIterator]();
        });
        const runner = createAsyncCoordinator(iterators);
        const latestValues = new Array(sources.length).fill(undefined);
        const hasEmitted = new Set();
        let completedCount = 0;
        try {
            while (completedCount < sources.length) {
                const result = await runner.next();
                if (result.done)
                    break;
                const event = result.value;
                switch (event.type) {
                    case "value":
                        latestValues[event.sourceIndex] = event.value;
                        hasEmitted.add(event.sourceIndex);
                        // Only emit if all sources have provided at least one value
                        if (hasEmitted.size === sources.length) {
                            yield latestValues;
                        }
                        break;
                    case "complete":
                        if (!hasEmitted.has(event.sourceIndex)) {
                            return;
                        }
                        completedCount++;
                        break;
                    case "error":
                        throw event.error;
                }
            }
        }
        finally {
            // Ensure all upstream iterators are closed
            await runner.return?.();
        }
    };
    return createStream("combineLatest", gen);
}

/**
 * Creates a transactional retrying stream that commits values only after a full
 * attempt completes successfully.
 *
 * Unlike {@link retry}, this operator buffers values produced during each
 * attempt. If an attempt fails, the buffered values are discarded and the next
 * retry starts from a clean state. When an attempt completes, its buffered
 * values are emitted downstream in order.
 *
 * This is useful when retries should preserve all-or-nothing visibility for a
 * sequence, while {@link retry} itself remains pass-through.
 *
 * @template T The type of values emitted by the source stream.
 * @param factory A factory executed for each attempt. The produced result is
 * normalized through {@link fromAny}, so it may be a stream, a promise, or a
 * plain value.
 * @param maxRetries The maximum number of retry operations allowed. A value of
 * `0` runs a single attempt.
 * @param delay The delay window in milliseconds to pause between attempts.
 * @returns A stream that emits values only after an attempt finishes
 * successfully.
 */
function commit(factory, maxRetries = 3, delay = 1000) {
    return createStream("commit", async function* (signal) {
        const resolvedMaxRetries = isPromiseLike(maxRetries) ? await maxRetries : maxRetries;
        let resolvedDelayValue;
        const resolveDelayValue = async () => {
            if (resolvedDelayValue !== undefined)
                return resolvedDelayValue;
            if (delay === undefined)
                return undefined;
            resolvedDelayValue = isPromiseLike(delay) ? await delay : delay;
            return resolvedDelayValue;
        };
        let retryCount = 0;
        let lastError = null;
        while (retryCount <= resolvedMaxRetries) {
            let iterator = null;
            try {
                if (signal?.aborted) {
                    throw new DOMException("Stream aborted", "AbortError");
                }
                let produced;
                try {
                    produced = factory();
                }
                catch (factoryError) {
                    throw factoryError instanceof Error ? factoryError : new Error(String(factoryError));
                }
                const stream = fromAny(isPromiseLike(produced) ? await produced : produced);
                iterator = stream[Symbol.asyncIterator]();
                // Buffer the entire attempt — only commit on full success
                const batch = [];
                while (true) {
                    if (signal?.aborted) {
                        throw new DOMException("Stream aborted", "AbortError");
                    }
                    const next = await iterator.next();
                    if (next.done)
                        break;
                    batch.push(next.value);
                }
                // Attempt completed successfully — emit buffered values
                yield* batch;
                lastError = null;
                break;
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                retryCount++;
                const resolvedDelay = await resolveDelayValue();
                if (retryCount <= resolvedMaxRetries && resolvedDelay !== undefined && resolvedDelay > 0) {
                    await new Promise((resolve, reject) => {
                        if (signal?.aborted) {
                            return reject(new DOMException("Stream aborted", "AbortError"));
                        }
                        const timeoutId = setTimeout(() => {
                            if (signal)
                                signal.removeEventListener("abort", abortHandler);
                            resolve();
                        }, resolvedDelay);
                        const abortHandler = () => {
                            clearTimeout(timeoutId);
                            reject(new DOMException("Stream aborted", "AbortError"));
                        };
                        if (signal) {
                            signal.addEventListener("abort", abortHandler, { once: true });
                        }
                    });
                }
            }
            finally {
                if (iterator?.return) {
                    try {
                        await iterator.return(undefined);
                    }
                    catch {
                        // Suppress secondary exceptions to protect the core error trace
                    }
                }
            }
        }
        if (lastError) {
            throw lastError;
        }
    });
}

/**
 * Concatenates sources sequentially.
 *
 * `concat(a, b, c)` subscribes to `a`, yields all its values, waits for it to
 * complete, then moves to `b`, then `c`.
 *
 * - If any source errors, the concatenated stream errors and remaining sources
 *   are not processed.
 * - Sources may be Streams, raw values, arrays/iterables, or Promises of those.
 *
 * @template T Value type.
 * @param sources Streams or values (including promises) to concatenate.
 * @returns A new stream that emits values from all input sources in order.
 *
 * @example
 * const s = concat(from([1, 2]), from([3]), 4);
 * // emits: 1, 2, 3, 4
 */
function concat(...sources) {
    async function* generator() {
        for (const source of sources) {
            const resolvedSource = isPromiseLike(source) ? await source : source;
            const stream = fromAny(resolvedSource);
            const iterator = stream[Symbol.asyncIterator]();
            try {
                while (true) {
                    const result = await iterator.next();
                    if (result.done)
                        break;
                    yield result.value;
                }
            }
            finally {
                // Attempt to close iterator early on abort or completion
                if (iterator.return) {
                    try {
                        await iterator.return(undefined);
                    }
                    catch {
                        // ignore
                    }
                }
            }
        }
    }
    return createStream("concat", generator);
}

/**
 * Creates a stream that defers the creation of an inner stream until it is
 * subscribed to.
 *
 * This operator ensures that the `factory` function is called only when
 * a consumer subscribes to the stream, making it a good choice for
 * creating "cold" streams. Each new subscription will trigger a new
 * call to the `factory` and create a fresh stream instance.
 *
 * @template T The type of the values in the inner stream.
 * @param {() => (Stream<T> | Promise<T>)} factory A function that returns the stream or value to be subscribed to.
 * @returns {Stream<T>} A new stream that defers subscription to the inner stream.
 */
function defer(factory) {
    async function* generator() {
        const produced = factory();
        const innerStream = isPromiseLike(produced) ? await produced : produced;
        try {
            const stream = fromAny(innerStream);
            const iterator = stream[Symbol.asyncIterator]();
            try {
                while (true) {
                    const result = await iterator.next();
                    if (result.done)
                        break;
                    yield result.value;
                }
            }
            finally {
                if (iterator.return) {
                    try {
                        await iterator.return(undefined);
                    }
                    catch {
                        // ignore
                    }
                }
            }
        }
        catch (error) {
            throw normalizeError(error);
        }
    }
    return createStream('defer', generator);
}

/**
 * Creates an empty stream that emits no values and completes immediately.
 *
 * @template T The type of the stream's values (will never be emitted).
 * @returns {Stream<T>} An empty stream.
 */
const empty = () => {
    const stream = createStream('EMPTY', async function* () {
        // No emissions, just complete immediately
    });
    return Object.assign(stream, { completed: () => true });
};
/**
 * A singleton instance of an empty stream.
 *
 * This constant provides a reusable, empty stream that immediately completes
 * upon subscription without emitting any values. It is useful in stream
 * compositions as a placeholder or to represent a sequence with no elements.
 */
const EMPTY = empty();

/**
 * Implementation signature.
 *
 * This implementation supports both `forkJoin(a, b, c)` and `forkJoin([a, b, c])`.
 */
function forkJoin(...sources) {
    async function* generator() {
        const normalizedSources = sources.length === 1 && Array.isArray(sources[0]) ? sources[0] : sources;
        const results = new Array(normalizedSources.length);
        const hasValue = new Array(normalizedSources.length).fill(false);
        const iterators = normalizedSources.map((source) => {
            const stream = fromAny(source);
            return stream[Symbol.asyncIterator]();
        });
        const coordinator = createAsyncCoordinator(iterators);
        let completedCount = 0;
        try {
            while (completedCount < iterators.length) {
                const next = await coordinator.next();
                if (next.done)
                    break;
                const event = next.value;
                if (event.type === "error") {
                    throw event.error;
                }
                if (event.type === "value") {
                    hasValue[event.sourceIndex] = true;
                    results[event.sourceIndex] = event.value;
                    continue;
                }
                completedCount++;
                if (!hasValue[event.sourceIndex]) {
                    throw new Error(`forkJoin: stream at index ${event.sourceIndex} completed without emitting any value`);
                }
            }
            yield results;
        }
        finally {
            await coordinator.return?.();
        }
    }
    return createStream("forkJoin", generator);
}

/**
 * Creates a stream from an asynchronous or synchronous iterable.
 *
 * This operator is a powerful way to convert any source that can be iterated
 * over (such as arrays, strings, `Map`, `Set`, `AsyncGenerator`, etc.) into
 * a reactive stream. The stream will emit each value from the source in order
 * before completing.
 *
 * @template T The type of the values in the iterable.
 * @param {AsyncIterable<T> | Iterable<T> | PromiseLike<AsyncIterable<T> | Iterable<T>>} source The iterable source to convert into a stream.
 * @returns {Stream<T>} A new stream that emits each value from the source.
 */
function from(source) {
    async function* generator() {
        const resolvedSource = isPromiseLike(source) ? await source : source;
        const iterator = resolvedSource[Symbol.asyncIterator]?.() ?? resolvedSource[Symbol.iterator]?.();
        try {
            while (true) {
                const result = await iterator.next();
                if (result.done)
                    break;
                yield result.value;
            }
        }
        finally {
            if (iterator.return) {
                try {
                    await iterator.return();
                }
                catch {
                    // ignore
                }
            }
        }
    }
    return createStream("from", generator);
}

/**
 * Creates a stream that emits events of the specified type from the given EventTarget.
 *
 * This function provides a reactive way to handle DOM events or other events,
 * such as mouse clicks, keyboard presses, or custom events. The stream
 * will emit a new event object each time the event is dispatched.
 *
 * The stream handles:
 * - Promise-based resolution of both target and event name
 * - Automatic cleanup when the last subscriber unsubscribes
 * - Multicast to multiple subscribers
 * - Proper error propagation if event listener setup fails
 *
 * @template T The type of the event to listen for.
 * @param target The event target to listen to (e.g., a DOM element, `window`, or `document`).
 *               Can be a direct EventTarget or a Promise that resolves to one.
 * @param event The name of the event to listen for (e.g., 'click', 'keydown').
 *              Can be a direct string or a Promise that resolves to one.
 * @param options Optional event listener options (e.g., `{ once: false, passive: true }`).
 * @returns A stream that emits the event objects as they occur.
 *
 * @example
 * // Basic usage
 * const clicks = fromEvent(document.getElementById('myButton'), 'click');
 * clicks.subscribe(console.log);
 *
 * @example
 * // With async target (e.g., waiting for DOM element)
 * const asyncButton = waitForElement('#myButton');
 * const clicks = fromEvent(asyncButton, 'click');
 *
 * @example
 * // With custom event
 * const customEvents = fromEvent(window, 'my-custom-event');
 */
function fromEvent(target, event, options) {
    const subject = createSubject();
    let subscriberCount = 0;
    let listening = false;
    let resolvedTarget = null;
    let resolvedEvent = null;
    const listener = (ev) => {
        if (!subject.completed()) {
            subject.next(ev);
        }
    };
    const start = async () => {
        if (listening)
            return;
        listening = true;
        if (!isPromiseLike(target) && !isPromiseLike(event)) {
            resolvedTarget = target;
            resolvedEvent = event;
            resolvedTarget.addEventListener(resolvedEvent, listener, options);
            return;
        }
        const targetValue = isPromiseLike(target) ? await target : target;
        const eventValue = isPromiseLike(event) ? await event : event;
        if (!listening)
            return;
        resolvedTarget = targetValue;
        resolvedEvent = eventValue;
        resolvedTarget.addEventListener(resolvedEvent, listener, options);
    };
    const stop = () => {
        if (!listening)
            return;
        listening = false;
        if (resolvedTarget && resolvedEvent) {
            resolvedTarget.removeEventListener(resolvedEvent, listener, options);
        }
        resolvedTarget = null;
        resolvedEvent = null;
    };
    const originalSubscribe = subject.subscribe;
    subject.subscribe = (callback) => {
        const subscription = originalSubscribe.call(subject, callback);
        if (++subscriberCount === 1) {
            void start();
        }
        const originalOnUnsubscribe = subscription.teardown;
        subscription.teardown = () => {
            if (--subscriberCount === 0) {
                stop();
            }
            originalOnUnsubscribe?.call(subscription);
        };
        return subscription;
    };
    subject[Symbol.asyncIterator] = () => createAsyncIterator({ register: (receiver) => subject.subscribe(receiver) })();
    subject.name = 'fromEvent';
    subject.type = "stream";
    return subject;
}

/**
 * Creates a stream from a value, promise, or a cancelable asynchronous factory.
 *
 * The input can be:
 * - A value
 * - A promise
 * - A function that returns a value or promise, and optionally reacts to cancellation via an {@link AbortSignal}.
 *
 * The factory function (if provided) is invoked on subscription and receives an {@link AbortSignal}
 * that is aborted when the stream is unsubscribed. If the factory throws or returns a rejected promise,
 * the stream will emit an error.
 *
 * @typeParam T - The type of the emitted value.
 * @param input - A value, promise, or a function producing a value or promise, optionally using the provided abort signal for cancellation.
 * @returns A stream that emits the produced value and then completes.
 */
function fromPromise(input) {
    return createStream('fromPromise', async function* (signal) {
        const valueOrPromise = typeof input === "function" ? input(signal) : input;
        yield isPromiseLike(valueOrPromise) ? await valueOrPromise : valueOrPromise;
    });
}

/**
 * Creates a stream that chooses between two streams based on a condition.
 *
 * The condition is evaluated lazily when the stream is subscribed to. This allows
 * for dynamic stream selection based on runtime state.
 *
 * @template T The type of the values in the streams.
 * @param {() => MaybePromise<boolean>} condition A function that returns a boolean to determine which stream to use. It is called when the iif stream is subscribed to.
 * @param {Stream<T> | Promise<T>} trueStream The stream or value to use if the condition is `true`.
 * @param {Stream<T> | Promise<T>} falseStream The stream or value to use if the condition is `false`.
 * @returns {Stream<T>} A new stream that emits values from either `trueStream` or `falseStream` based on the condition.
 */
function iif(condition, trueStream, falseStream) {
    async function* generator() {
        // Evaluate condition lazily when the stream starts
        const conditionResult = condition();
        const resolvedCondition = isPromiseLike(conditionResult) ? await conditionResult : conditionResult;
        const chosen = resolvedCondition ? trueStream : falseStream;
        const resolvedChosen = isPromiseLike(chosen) ? await chosen : chosen;
        const stream = fromAny(resolvedChosen);
        const iterator = stream[Symbol.asyncIterator]();
        try {
            while (true) {
                const result = await iterator.next();
                if (result.done)
                    break;
                yield result.value;
            }
        }
        finally {
            // Ensure proper cleanup of the iterator
            if (iterator.return) {
                try {
                    await iterator.return(undefined);
                }
                catch {
                    // Ignore any errors during cleanup
                }
            }
        }
    }
    return createStream('iif', generator);
}

/**
 * Creates a timer stream that emits numbers starting from 0.
 *
 * This stream is useful for scheduling events or generating periodic data.
 * It is analogous to `setInterval` but as an asynchronous stream.
 *
 * @param {number} [delayMs=0] - The time in milliseconds to wait before emitting the first value (0).
 * If 0, the first value is emitted immediately (in the next microtask).
 * @param {number} [intervalMs] - The time in milliseconds between subsequent emissions.
 * If not provided, it defaults to `delayMs`.
 * @returns {Stream<number>} A stream that emits incrementing numbers (0, 1, 2, ...).
 */
function timer(delayMs = 0, intervalMs) {
    async function* timerGenerator() {
        const resolvedDelay = isPromiseLike(delayMs) ? await delayMs : delayMs;
        const resolvedInterval = intervalMs !== undefined
            ? (isPromiseLike(intervalMs) ? await intervalMs : intervalMs)
            : resolvedDelay;
        let count = 0;
        let cancelled = false;
        let timeoutId = null;
        const sleep = (ms) => new Promise((resolve) => {
            timeoutId = setTimeout(() => {
                timeoutId = null;
                if (!cancelled)
                    resolve();
            }, ms);
        });
        const clearPending = () => {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        };
        try {
            if (resolvedDelay > 0) {
                await sleep(resolvedDelay);
            }
            else {
                await Promise.resolve();
            }
            yield count++;
            while (true) {
                await sleep(resolvedInterval);
                yield count++;
            }
        }
        finally {
            cancelled = true;
            clearPending();
        }
    }
    return createStream('timer', timerGenerator);
}

/**
 * Creates a stream that emits incremental numbers starting from 0 at a regular
 * interval.
 *
 * This operator is a shorthand for `timer(0, intervalMs)`, useful for
 * creating a simple, repeating sequence of numbers. The stream emits a new
 * value every `intervalMs` milliseconds. It is analogous to `setInterval` but
 * as an asynchronous stream.
 *
 * @param {MaybePromise<number>} intervalMs The time in milliseconds between each emission.
 * @returns {Stream<number>} A stream that emits incrementing numbers (0, 1, 2, ...).
 */
function interval(intervalMs) {
    // Use the timer function to create a stream that emits at the specified interval
    const stream = timer(0, intervalMs);
    stream.name = 'interval';
    return stream;
}

/**
 * Creates a stream that emits values in a loop based on a condition and an
 * iteration function.
 *
 * This operator is useful for generating a sequence of values until a specific
 * condition is no longer met. It starts with an `initialValue` and, for each
 * iteration, it yields the current value and then uses `iterateFn` to
 * calculate the next value in the sequence.
 *
 * @template T The type of the values in the stream.
 * @param {MaybePromise<T>} initialValue The starting value for the loop.
 * @param {(value: T) => MaybePromise<boolean>} condition A function that returns `true` to continue the loop and `false` to stop.
 * @param {(value: T) => MaybePromise<T>} iterateFn A function that returns the next value in the sequence.
 * @returns {Stream<T>} A stream that emits the generated sequence of values.
 */
function loop(initialValue, condition, iterateFn) {
    return createStream('loop', async function* (signal) {
        let currentValue = isPromiseLike(initialValue) ? await initialValue : initialValue;
        while (true) {
            if (signal?.aborted)
                break;
            const shouldContinue = condition(currentValue);
            const continueValue = isPromiseLike(shouldContinue) ? await shouldContinue : shouldContinue;
            if (!continueValue)
                break;
            yield currentValue;
            await Promise.resolve();
            if (signal?.aborted)
                break;
            const nextValue = iterateFn(currentValue);
            currentValue = isPromiseLike(nextValue) ? await nextValue : nextValue;
        }
    });
}

/**
 * Merges multiple source streams into a single stream, emitting values as they arrive from any source.
 *
 * This is useful for combining data from multiple independent sources into a single,
 * unified stream of events. Unlike `zip`, it does not wait for a value from every
 * stream before emitting; it emits values as they become available.
 *
 * The merged stream completes only after all source streams have completed.
 * If any source stream errors, the merged stream immediately errors.
 *
 * **Performance characteristics:**
 * - Synchronous sources with buffered values are drained immediately
 * - Asynchronous sources are pulled concurrently
 *
 * @template T The type of the values in the streams.
 * @param sources Streams or values (including promises) to merge.
 * @returns {Stream<T>} A new stream that emits values from all input streams.
 *
 * @example
 * ```typescript
 * const fast = interval(10);
 * const slow = interval(100);
 * const instant = from([1, 2, 3]);
 *
 * // Values emitted as they arrive
 * merge(fast, slow, instant).forEach(console.log);
 * ```
 */
function merge(...sources) {
    const gen = async function* () {
        if (sources.length === 0)
            return;
        const iterators = sources.map((source) => fromAny(source)[Symbol.asyncIterator]());
        const coordinator = createAsyncCoordinator(iterators);
        try {
            while (true) {
                const result = await coordinator.next();
                if (result.done)
                    break;
                const event = result.value;
                if (event.type === "error") {
                    throw normalizeError(event.error);
                }
                if (event.type === "value") {
                    yield event.value;
                }
            }
        }
        finally {
            await coordinator.return?.();
        }
    };
    return createStream("merge", gen);
}

/**
 * Creates a stream that emits a single value and then completes.
 *
 * This operator is useful for scenarios where you need to treat a static,
 * single value as a stream. It immediately yields the provided `value`
 * and then signals completion, which is a common pattern for creating a
 * "hot" stream from a predefined value.
 *
 * @template T The type of the value to be emitted.
 * @param {MaybePromise<T>} value The single value to emit.
 * @returns {Stream<T>} A new stream that emits the value and then completes.
 */
function of(value) {
    return createStream('of', async function* () {
        const resolved = isPromiseLike(value) ? await value : value;
        yield resolved;
    });
}

/**
 * Returns a stream that races multiple input streams.
 * It emits values from the first stream that produces a value,
 * then cancels all other streams.
 *
 * This operator is useful for scenarios where you only need the result from the fastest
 * of several asynchronous operations. For example, fetching data from multiple servers
 * and only taking the result from the one that responds first.
 *
 * Once the winning stream completes, the output stream also completes.
 * If the winning stream emits an error, the output stream will emit that error.
 *
 * @template {readonly unknown[]} T - A tuple type representing the combined values from the streams.
 * @param streams Streams or values (including promises) to race against each other.
 * @returns {Stream<T[number]>} A new stream that emits values from the first stream to produce a value.
 */
function race(...streams) {
    const gen = async function* () {
        if (streams.length === 0)
            return;
        const iterators = streams.map(s => {
            const resolved = fromAny(s);
            return resolved[Symbol.asyncIterator]();
        });
        const runner = createAsyncCoordinator(iterators);
        let winnerIndex = null;
        try {
            while (true) {
                const result = await runner.next();
                if (result.done)
                    break;
                const event = result.value;
                // 1. Handle errors immediately regardless of winner
                if (event.type === 'error') {
                    throw normalizeError(event.error);
                }
                // 2. Identify the winner from the first real value or completion
                if (winnerIndex === null) {
                    winnerIndex = event.sourceIndex;
                    // Once we have a winner, tell the runner to stop polling the others
                    // by calling return on the losers. Await all cleanups so resources
                    // are freed before we continue yielding from the winner.
                    await Promise.all(iterators.map((it, idx) => idx !== winnerIndex ? it.return?.().catch(() => { }) : null));
                }
                // 3. Only process events from the winner
                if (winnerIndex !== null && event.sourceIndex === winnerIndex) {
                    if (event.type === 'value') {
                        yield event.value;
                    }
                    else if (event.type === 'complete') {
                        break;
                    }
                }
            }
        }
        finally {
            // Clean up the runner and all underlying iterators
            await runner.return?.();
        }
    };
    return createStream('race', gen);
}

/**
 * Creates a stream that emits a sequence of numbers, starting from `start`,
 * incrementing by `step`, and emitting a total of `count` values.
 *
 * This operator is a powerful way to generate a numerical sequence in a
 * reactive context. It's similar to a standard `for` loop but produces
 * values as a stream. It's built upon the `loop` operator for its
 * underlying logic.
 *
 * @param {MaybePromise<number>} start - The first number to emit in the sequence.
 * @param {MaybePromise<number>} count - The total number of values to emit. Must be a non-negative number.
 * @param {MaybePromise<number>} [step=1] - The amount to increment or decrement the value in each step.
 * @returns {Stream<number>} A stream that emits a sequence of numbers.
 */
function range(start, count, step = 1) {
    return createStream('range', async function* () {
        const resolvedStart = isPromiseLike(start) ? await start : start;
        const resolvedCount = isPromiseLike(count) ? await count : count;
        const resolvedStep = isPromiseLike(step) ? await step : step;
        for (let i = 0; i < resolvedCount; i++) {
            yield resolvedStart + i * resolvedStep;
        }
    });
}

/**
 * Creates a stream that subscribes to a source factory and retries the entire sequence on error.
 *
 * Values are yielded as each attempt produces them. If an attempt fails after emitting some values,
 * those values stay visible downstream and the operator restarts the factory for the next attempt.
 *
 * Abortion: the operator honors the abort signal during stream iteration and between-retry delays,
 * clearing allocations safely without event listener leaks.
 *
 * @template T - The type of values emitted by the source stream.
 * @param {() => (Stream<T> | Promise<T>)} factory - A factory function executed on each initialization attempt.
 * @param {MaybePromise<number>} [maxRetries=3] - The maximum number of retry operations allowed. A value of 0 runs a single attempt.
 * @param {MaybePromise<number>} [delay=1000] - The delay window in milliseconds to pause between attempts.
 * @returns {Stream<T>} A stream that retries the sequence factory after errors.
 */
function retry(factory, maxRetries = 3, delay = 1000) {
    return createStream("retry", async function* (signal) {
        const resolvedMaxRetries = isPromiseLike(maxRetries) ? await maxRetries : maxRetries;
        let resolvedDelayValue;
        const resolveDelayValue = async () => {
            if (resolvedDelayValue !== undefined)
                return resolvedDelayValue;
            if (delay === undefined)
                return undefined;
            resolvedDelayValue = isPromiseLike(delay) ? await delay : delay;
            return resolvedDelayValue;
        };
        let retryCount = 0;
        let lastError = null;
        while (retryCount <= resolvedMaxRetries) {
            let iterator = null;
            try {
                if (signal?.aborted) {
                    throw new DOMException("Stream aborted", "AbortError");
                }
                let produced;
                try {
                    produced = factory();
                }
                catch (factoryError) {
                    throw factoryError instanceof Error ? factoryError : new Error(String(factoryError));
                }
                const source = isPromiseLike(produced) ? await produced : produced;
                const stream = fromAny(source);
                iterator = stream[Symbol.asyncIterator]();
                while (true) {
                    if (signal?.aborted) {
                        throw new DOMException("Stream aborted", "AbortError");
                    }
                    const next = await iterator.next();
                    if (next.done)
                        break;
                    yield next.value;
                }
                lastError = null;
                break;
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                retryCount++;
                const resolvedDelay = await resolveDelayValue();
                if (retryCount <= resolvedMaxRetries && resolvedDelay !== undefined && resolvedDelay > 0) {
                    // Secure delay engine that cleanly removes abort listeners when timing out naturally
                    await new Promise((resolve, reject) => {
                        if (signal?.aborted) {
                            return reject(new DOMException("Stream aborted", "AbortError"));
                        }
                        const timeoutId = setTimeout(() => {
                            if (signal)
                                signal.removeEventListener("abort", abortHandler);
                            resolve();
                        }, resolvedDelay);
                        const abortHandler = () => {
                            clearTimeout(timeoutId);
                            reject(new DOMException("Stream aborted", "AbortError"));
                        };
                        if (signal) {
                            signal.addEventListener("abort", abortHandler, { once: true });
                        }
                    });
                }
            }
            finally {
                if (iterator?.return) {
                    try {
                        await iterator.return(undefined);
                    }
                    catch {
                        // Suppress secondary exceptions to protect the core error trace
                    }
                }
            }
        }
        if (lastError) {
            throw lastError;
        }
    });
}

/**
 * Combine multiple streams into a single stream that emits arrays of the latest values
 * from each input stream whenever any input emits. Emission occurs only when all inputs
 * have emitted at least once.
 *
 * @template T
 * @param {...Stream<T[number]>[]} sources - The input streams to zip.
 * @returns {Stream<T>} A stream emitting arrays of values from each input.
 */
function zip(...sources) {
    const gen = async function* () {
        if (sources.length === 0)
            return;
        const iterators = sources.map((source) => {
            const resolved = fromAny(source);
            return resolved[Symbol.asyncIterator]();
        });
        const runner = createAsyncCoordinator(iterators);
        const queues = sources.map(() => []);
        const completed = new Set();
        const canEmitTuple = () => queues.every(queue => queue.length > 0);
        const cannotEmitMore = () => queues.some((queue, index) => completed.has(index) && queue.length === 0);
        try {
            while (true) {
                if (cannotEmitMore())
                    break;
                const result = await runner.next();
                if (result.done)
                    break;
                const event = result.value;
                if (event.type === 'error') {
                    throw normalizeError(event.error);
                }
                if (event.type === 'complete') {
                    completed.add(event.sourceIndex);
                }
                else {
                    queues[event.sourceIndex].push(event.value);
                }
                while (canEmitTuple()) {
                    yield queues.map(queue => queue.shift());
                    if (cannotEmitMore()) {
                        break;
                    }
                }
                if (cannotEmitMore()) {
                    break;
                }
            }
        }
        finally {
            await runner.return?.();
        }
    };
    return createStream('zip', gen);
}

/**
 * Buffers values from the source stream and emits them as arrays every `period` milliseconds.
 *
 * @template T The type of the values in the source stream.
 * @param period Time in milliseconds between each buffer flush.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
function buffer(period) {
    return createPushOperator("buffer", (source, output) => {
        let buf = [];
        let completed = false;
        const flush = () => {
            if (buf.length === 0)
                return;
            const values = buf.map((e) => e.value);
            output.push(values);
            buf = [];
        };
        let intervalSubscription;
        let pendingIntervalUnsubscribe = false;
        const requestIntervalUnsubscribe = () => {
            if (intervalSubscription) {
                const sub = intervalSubscription;
                intervalSubscription = undefined;
                sub.unsubscribe();
                return;
            }
            pendingIntervalUnsubscribe = true;
        };
        const cleanup = () => {
            requestIntervalUnsubscribe();
        };
        const flushAndComplete = () => {
            flush();
            if (!completed) {
                completed = true;
                output.complete();
            }
            cleanup();
        };
        const fail = (err) => {
            buf = [];
            output.error(normalizeError(err));
            cleanup();
        };
        intervalSubscription = timer(period, period).subscribe({
            next: () => flush(),
            error: (err) => fail(err),
            complete: () => flushAndComplete(),
        });
        if (pendingIntervalUnsubscribe) {
            requestIntervalUnsubscribe();
        }
        void (async () => {
            try {
                while (true) {
                    const result = await source.next();
                    if (result.done)
                        break;
                    buf.push(result);
                }
            }
            catch (err) {
                fail(err);
            }
            finally {
                flushAndComplete();
            }
        })();
        return () => {
            cleanup();
            buf = [];
        };
    });
}

/**
 * Buffers a fixed number of values from the source stream and emits them as arrays,
 * tracking pending and phantom values in the PipeContext.
 *
 * @template T The type of values in the source stream.
 * @param bufferSize The maximum number of values per buffer (default: Infinity).
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
const bufferCount = (bufferSize = Infinity) => createOperator("bufferCount", function (source) {
    let completed = false;
    const iterator = {
        next: async () => {
            if (completed)
                return DONE;
            const buffer = [];
            const size = isPromiseLike(bufferSize) ? await bufferSize : bufferSize;
            while (buffer.length < size) {
                const result = await source.next();
                if (result.done) {
                    completed = true;
                    // Flush any remaining buffered values
                    if (buffer.length > 0) {
                        return NEXT(buffer.map((r) => r.value));
                    }
                    return DONE;
                }
                buffer.push(result);
            }
            return NEXT(buffer.map((r) => r.value));
        },
    };
    return iterator;
});

/**
 * Buffers values from the source iterator until the notifier emits.
 * Once the notifier emits, the buffered values are flushed as an array.
 *
 * @template T Type of values emitted by the source iterator.
 * @template N Type of values emitted by the notifier stream (ignored).
 * @param {Stream<N>} notifier - Stream whose emissions trigger buffer flush.
 * @returns {Operator<T, T[]>} A Streamix operator that collects values into arrays
 *   and emits them whenever the notifier emits or the source completes.
 */
const bufferUntil = (notifier) => createOperator("bufferUntil", function (source) {
    const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();
    const runner = createAsyncCoordinator([source, notifierIt]);
    // Buffered source values
    let buffer = [];
    // Whether the iterator has been cancelled (return/throw)
    let cancelled = false;
    /**
     * Flushes the current buffer.
     *
     * - Emits a copy of the buffered values.
     *
     * @returns {IteratorResult<T[]>} IteratorResult with flushed values or DONE.
     */
    const flushBuffer = () => {
        if (buffer.length === 0)
            return DONE;
        const values = [...buffer];
        buffer = [];
        return { value: values, done: false };
    };
    /**
     * The AsyncIterator returned by the operator.
     *
     * Supports the standard AsyncIterator protocol:
     * - `next()`
     * - `return()`
     * - `throw()`
     *
     * And two internal helpers for Streamix internals:
     * - `__tryNext()` — synchronous try-pull for testing and internal operators.
     * - `__hasBufferedValues()` — checks if buffer or runner has pending values.
     */
    const iterator = {
        /**
         * Pulls the next buffered array of values.
         *
         * - Buffers source values.
         * - Flushes buffer on notifier emission.
         * - Flushes buffer when source completes.
         *
         * @returns {Promise<IteratorResult<T[]>>} Next buffered array or DONE.
         */
        async next() {
            while (true) {
                if (cancelled)
                    return DONE;
                const runnerResult = await runner.next();
                if (runnerResult.done) {
                    // Flush any remaining buffered values when runner completes
                    return flushBuffer();
                }
                const event = runnerResult.value;
                switch (event.type) {
                    case "value":
                        if (event.sourceIndex === 0) {
                            // Source value: buffer it
                            buffer.push(event.value);
                        }
                        else {
                            // Notifier value: flush buffer
                            if (buffer.length > 0)
                                return flushBuffer();
                        }
                        break;
                    case "complete":
                        // Source completed: flush buffer if any
                        if (event.sourceIndex === 0 && buffer.length > 0)
                            return flushBuffer();
                        break;
                    case "error":
                        // Propagate error and cancel iterator
                        cancelled = true;
                        try {
                            await runner.return?.();
                        }
                        catch { }
                        throw event.error;
                }
            }
        },
        /**
         * Cancels the iterator and flushes/cleans upstream sources.
         *
         * @param value Optional value to return
         * @returns {Promise<IteratorResult<T[]>>} DONE or returned value
         */
        async return(value) {
            if (cancelled)
                return value !== undefined ? { value, done: true } : DONE;
            cancelled = true;
            try {
                await runner.return?.();
            }
            catch { }
            return value !== undefined ? { value, done: true } : DONE;
        },
        /**
         * Throws an error into the iterator and cancels upstream sources.
         *
         * @param err Error to propagate
         * @returns {Promise<never>} Rejected promise with the error
         */
        async throw(err) {
            const error = normalizeError(err);
            if (cancelled)
                return Promise.reject(error);
            cancelled = true;
            try {
                await runner.throw?.(error);
            }
            catch { }
            return Promise.reject(error);
        },
        /**
         * Internal synchronous try-pull (used by Streamix for tests/operators).
         *
         * @returns {IteratorResult<T[]> | null} Next buffered array or null if no sync value
         */
        __tryNext: () => {
            if (cancelled)
                return DONE;
            if (!runner.__tryNext)
                return null;
            while (true) {
                const runnerResult = runner.__tryNext();
                if (!runnerResult)
                    return null;
                if (runnerResult.done)
                    return flushBuffer();
                const event = runnerResult.value;
                switch (event.type) {
                    case "value":
                        if (event.sourceIndex === 0) {
                            buffer.push(event.value);
                        }
                        else if (buffer.length > 0) {
                            return flushBuffer();
                        }
                        break;
                    case "complete":
                        if (event.sourceIndex === 0 && buffer.length > 0)
                            return flushBuffer();
                        break;
                    case "error":
                        cancelled = true;
                        runner.return?.().catch(() => { });
                        throw event.error;
                }
            }
        },
        /**
         * Checks whether the operator has buffered values (including runner pending items)
         *
         * @returns {boolean} True if buffer or runner has pending values
         */
        __hasBufferedValues: () => buffer.length > 0 || (runner.__hasBufferedValues ? runner.__hasBufferedValues() : false),
    };
    return iterator;
});

/**
 * Buffers values while the provided predicate returns `true`.
 *
 * The predicate is evaluated for each incoming value against the *current* buffer (before the value is added).
 * If it resolves to `true`, the value is appended to the current buffer. If it resolves to `false`, the current
 * buffer is flushed and a new buffer is started with the incoming value.
 *
 * When the source completes, any remaining buffered values are emitted automatically.
 *
 * @template T Source value type.
 * @param predicate Function invoked for each value to decide whether the value should remain in the current buffer.
 * Receives the incoming value, the index, and the current buffer (before pushing the value). It may return a promise.
 */
const bufferWhile = (predicate) => createOperator("bufferWhile", function (source) {
    let completed = false;
    let index = 0;
    const buffer = [];
    const iterator = {
        next: async () => {
            const flushBuffer = () => {
                const records = buffer.splice(0);
                if (records.length === 0)
                    return NEXT([]);
                return NEXT(records.map((record) => record.result.value));
            };
            if (completed) {
                if (buffer.length > 0) {
                    return flushBuffer();
                }
                return DONE;
            }
            while (true) {
                const result = await source.next();
                if (result.done) {
                    completed = true;
                    if (buffer.length > 0) {
                        return flushBuffer();
                    }
                    return DONE;
                }
                const record = { result };
                const values = buffer.map((item) => item.result.value);
                const predicateResult = predicate(result.value, index++, values);
                const shouldKeep = isPromiseLike(predicateResult) ? await predicateResult : predicateResult;
                // Always start a buffer with the first value.
                if (buffer.length === 0) {
                    buffer.push(record);
                    continue;
                }
                if (shouldKeep) {
                    buffer.push(record);
                    continue;
                }
                // Boundary: flush the current buffer and start a new one with this value.
                const flushed = flushBuffer();
                buffer.push(record);
                return flushed;
            }
        },
    };
    return iterator;
});

/**
 * Creates a stream operator that catches errors from the source stream and handles them.
 *
 * This operator listens for errors from the upstream source. When the first error is
 * caught, it invokes a provided `handler` callback, yields a single dropped result
 * for that error, and then completes on the following pull, preventing the error
 * from propagating further down the pipeline.
 *
 * - **Error Handling:** The `handler` is executed only for the first error encountered.
 * - **Dropped Signal:** The first handled error is yielded with `dropped: true` so
 *   backpressure is released and downstream operators can observe the suppressed error.
 * - **Completion:** After that dropped signal, the operator completes, terminating
 *   the stream's flow.
 * - **Subsequent Errors:** Any errors after the first will be re-thrown.
 *
 * This is useful for error-handling strategies where you want to perform a specific
 * cleanup action and then gracefully terminate the stream.
 *
 * @template T The type of the values emitted by the stream.
 * @param handler The function to call when an error is caught. It can return a `void` or a `Promise<void>`.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const catchError = (handler = () => { }) => createOperator('catchError', function (source) {
    let errorCaughtAndHandled = false;
    let completed = false;
    return {
        next: async () => {
            if (errorCaughtAndHandled || completed) {
                return DONE;
            }
            try {
                const result = await source.next();
                if (result.done) {
                    completed = true;
                    return DONE;
                }
                return NEXT(result.value);
            }
            catch (error) {
                const normalizedError = normalizeError(error);
                if (!errorCaughtAndHandled) {
                    errorCaughtAndHandled = true;
                    const handlerResult = handler(normalizedError);
                    if (isPromiseLike(handlerResult))
                        await handlerResult;
                    completed = true;
                    return DONE;
                }
                throw normalizedError;
            }
        }
    };
});

/**
 * Creates a stream operator that maps each value from the source stream to a new
 * inner stream (or value/array/promise) and flattens all inner streams sequentially.
 *
 * For each value from the source:
 * 1. The `project` function is called with the value and its index.
 * 2. The returned value is normalized into a stream using {@link fromAny}.
 * 3. The inner stream is consumed fully before processing the next outer value.
 *
 * This ensures that all emitted values maintain their original sequential order.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the inner streams and the output.
 * @param project A function that takes a value from the source stream and its index,
 * and returns either:
 *   - a {@link Stream<R>},
 *   - a {@link MaybePromise<R>},
 *   - or an array of `R`.
 * @returns An {@link Operator} instance that can be used in a stream's `pipe` method.
 */
const concatMap = (project) => createOperator("concatMap", function (source) {
    let outerIndex = 0;
    let innerIterator = null;
    let result = null;
    const iterator = {
        next: async () => {
            while (true) {
                // If no active inner iterator, pull the next outer value
                if (!innerIterator) {
                    result = await source.next();
                    if (result.done)
                        return DONE;
                    const projected = project(result.value, outerIndex++);
                    const normalized = isPromiseLike(projected) ? await projected : projected;
                    const innerStream = fromAny(normalized);
                    innerIterator = innerStream[Symbol.asyncIterator]();
                }
                // Pull next value from inner stream
                const innerResult = await innerIterator.next();
                if (innerResult.done) {
                    innerIterator = null;
                    // Otherwise continue to next outer value
                    continue;
                }
                return NEXT(innerResult.value);
            }
        },
        async return(value) {
            try {
                await innerIterator?.return?.(value);
            }
            catch { }
            try {
                await source.return?.();
            }
            catch { }
            innerIterator = null;
            return DONE;
        },
        async throw(err) {
            const error = normalizeError(err);
            try {
                await innerIterator?.return?.();
            }
            catch { }
            try {
                await source.return?.();
            }
            catch { }
            innerIterator = null;
            throw error;
        }
    };
    return iterator;
});

/**
 * Creates a stream operator that emits the most recent value from the source stream
 * only after a specified duration has passed without another new value.
 *
 * Values that are superseded before the timeout fires are forwarded to the output
 * with `dropped: true` so that backpressure is released without surfacing them as
 * real emissions.
 *
 * @template T The type of the values in the source and output streams.
 * @param duration The debounce duration in milliseconds.
 * @returns An Operator instance for use in a stream pipeline.
 */
function debounce(duration) {
    return createPushOperator("debounce", (source, output) => {
        let timeoutId;
        let latestResult;
        let resolvedDuration;
        let completed = false;
        const flush = () => {
            if (!latestResult)
                return;
            output.push(latestResult.value);
            latestResult = undefined;
            timeoutId = undefined;
            if (completed)
                output.complete();
        };
        void (async () => {
            try {
                resolvedDuration = isPromiseLike(duration) ? await duration : duration;
                while (true) {
                    const result = await source.next();
                    if (result.done) {
                        completed = true;
                        if (latestResult && timeoutId === undefined)
                            flush();
                        break;
                    }
                    latestResult = result;
                    if (timeoutId)
                        clearTimeout(timeoutId);
                    if (resolvedDuration !== undefined) {
                        timeoutId = setTimeout(flush, resolvedDuration);
                    }
                }
            }
            catch (err) {
                output.error(normalizeError(err));
            }
            finally {
                completed = true;
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = undefined;
                }
                if (latestResult)
                    flush();
                if (!output.completed())
                    output.complete();
            }
        })();
        return () => {
            if (timeoutId)
                clearTimeout(timeoutId);
            timeoutId = undefined;
        };
    });
}

/**
 * Creates a stream operator that emits a default value if the source stream is empty.
 *
 * This operator monitors the source stream for any emitted values. If the source
 * stream completes without emitting any values, this operator will emit a single
 * `defaultValue` and then complete. If the source stream does emit at least one value,
 * this operator will pass all values through and will not emit the `defaultValue`.
 *
 * @template T The type of the values in the stream.
 * @param defaultValue The value to emit if the source stream is empty.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const defaultIfEmpty = (defaultValue) => createOperator("defaultIfEmpty", function (source) {
    let emitted = false;
    let completed = false;
    return {
        next: async () => {
            if (completed) {
                return DONE;
            }
            const result = await source.next();
            if (result.done) {
                if (!emitted) {
                    completed = true;
                    const value = isPromiseLike(defaultValue) ? await defaultValue : defaultValue;
                    return NEXT(value);
                }
                completed = true;
                return DONE;
            }
            emitted = true;
            return result;
        }
    };
});

/**
 * Creates a stream operator that delays the emission of each value from the source stream.
 *
 * Each value received from the source is held for the specified duration before
 * being emitted downstream.
 *
 * @template T The type of the values in the source and output streams.
 * @param ms The time in milliseconds to delay each value.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
function delay(ms) {
    return createPushOperator('delay', (source, output) => {
        void (async () => {
            try {
                const resolvedMs = isPromiseLike(ms) ? await ms : ms;
                while (true) {
                    const result = await source.next();
                    if (result.done)
                        break;
                    if (resolvedMs !== undefined) {
                        await new Promise((resolve) => setTimeout(resolve, resolvedMs));
                    }
                    output.push(result.value);
                }
            }
            catch (err) {
                output.error(normalizeError(err));
            }
            finally {
                if (!output.completed())
                    output.complete();
            }
        })();
        return () => { };
    });
}

/**
 * Delay values from the source until a notifier emits.
 *
 * This operator buffers every value produced by the source stream and releases
 * them only after the provided `notifier` produces its first emission. After the
 * notifier emits, the operator flushes the buffered values and forwards all
 * subsequent source values immediately.
 *
 * Important semantics:
 * - Buffering: values are buffered until the notifier emits, then flushed in order
 * - Notifier completion without emission: if the notifier completes without
 *   emitting, buffered values are discarded and the operator will not forward
 *   any buffered values (it simply waits for the source to continue/complete).
 * - Error propagation: any error from the notifier or source is propagated to
 *   the output (the operator records the error and terminates the output
 *   iterator accordingly).
 *
 * Use-cases:
 * - Delay producing values until an initialization step completes (e.g. wait
 *   for a connection or configuration event).
 * - Gate values until user interaction or external readiness signal occurs.
 *
 * @template T Source/output value type.
 * @template N Notifier value type (ignored by this operator).
 * @param notifier A `Stream<N>` or `Promise<N>` that gates the source.
 * @returns An `Operator<T, T>` that can be used in a stream pipeline.
 */
function delayUntil(notifier) {
    return createOperator("delayUntil", function (source) {
        const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();
        const runner = createAsyncCoordinator([notifierIt, source]);
        const buffer = [];
        let gateOpened = false;
        let isDone = false;
        let sourceCompleted = false;
        /**
         * Internal logic to handle events from the runner.
         * Returns a result if we should emit, null if we should keep pulling.
         */
        const handleEvent = (event) => {
            if (event.type === 'error') {
                isDone = true;
                throw event.error;
            }
            if (event.type === 'complete') {
                if (event.sourceIndex === 1) {
                    // Source completed
                    sourceCompleted = true;
                    if (gateOpened) {
                        // If gate is open, flush remaining buffer on next iteration
                        return null;
                    }
                    // Gate closed: keep buffered values and wait for notifier.
                    return null;
                }
                else {
                    // Notifier completed without ever emitting - discard buffer
                    if (!gateOpened) {
                        buffer.length = 0;
                        isDone = true;
                        return DONE;
                    }
                    return null;
                }
            }
            if (event.sourceIndex === 1) {
                if (gateOpened) {
                    // Gate is open - forward immediately
                    return NEXT(event.value);
                }
                else {
                    // Gate is closed - buffer
                    buffer.push(event.value);
                }
            }
            else {
                // Notifier emitted - open the gate (even if it's the first and only emission)
                if (!gateOpened) {
                    gateOpened = true;
                    // Immediately try to flush one buffered value
                    return iterator.flushOne();
                }
            }
            return null;
        };
        const iterator = {
            async next() {
                if (isDone)
                    return DONE;
                while (true) {
                    // 1. Always check the buffer first if the gate is open
                    if (gateOpened) {
                        const flushed = this.flushOne();
                        if (flushed)
                            return flushed;
                    }
                    // 2. If source completed and gate opened, but buffer is empty, we're done
                    if (sourceCompleted && gateOpened && buffer.length === 0) {
                        isDone = true;
                        return DONE;
                    }
                    // 3. Pull from runner
                    const result = await runner.next();
                    if (result.done) {
                        // Runner completed - this means both sources are done
                        isDone = true;
                        // Flush any remaining buffered values if gate was opened
                        if (gateOpened && buffer.length > 0) {
                            const flushed = this.flushOne();
                            if (flushed)
                                return flushed;
                        }
                        return DONE;
                    }
                    const out = handleEvent(result.value);
                    if (out)
                        return out;
                }
            },
            __tryNext: () => {
                if (isDone)
                    return DONE;
                // 1. Try flushing buffer if gate is open
                if (gateOpened) {
                    const flushed = iterator.flushOne();
                    if (flushed)
                        return flushed;
                }
                // 2. If source completed and gate opened, but buffer is empty
                if (sourceCompleted && gateOpened && buffer.length === 0) {
                    isDone = true;
                    return DONE;
                }
                // 3. Try draining sync events from runner
                while (runner.__hasBufferedValues?.()) {
                    const res = runner.__tryNext?.();
                    if (!res || res.done)
                        break;
                    const out = handleEvent(res.value);
                    if (out)
                        return out;
                    // After handling an event, check buffer again
                    if (gateOpened) {
                        const flushed = iterator.flushOne();
                        if (flushed)
                            return flushed;
                    }
                }
                return isDone ? DONE : null;
            },
            flushOne() {
                if (!gateOpened || buffer.length === 0)
                    return null;
                const value = buffer.shift();
                return { done: false, value };
            },
            __hasBufferedValues: () => (gateOpened && buffer.length > 0) || (runner.__hasBufferedValues?.() ?? false),
            async return(value) {
                isDone = true;
                await runner.return?.();
                return value !== undefined ? { value, done: true } : DONE;
            },
            async throw(err) {
                const error = normalizeError(err);
                isDone = true;
                await runner.throw?.(error);
                return Promise.reject(error);
            }
        };
        return iterator;
    });
}

/**
 * Buffers values while a predicate returns `true` and releases them once the predicate flips to `false`.
 *
 * This operator evaluates the provided predicate for every value coming from the source stream.
 * - When the predicate resolves to `true`, the value is held in an internal queue.
 * - Once the predicate returns `false` for the first time, all buffered values are flushed in order,
 *   including the current value, and the operator resumes emitting immediately.
 * - The operator can re-enter the buffering state later if the predicate becomes `true` again.
 * - When the source completes while values are buffered, those values are flushed before completing.
 *
 * The predicate is allowed to return either a boolean or a promise of a boolean.
 *
 * @template T The type of values flowing through the stream.
 * @param predicate Function to test each value. Receives the value and its index; `true` means delay, `false` means emit immediately.
 */
const delayWhile = (predicate) => createPushOperator('delayWhile', (source, output) => {
    const queue = [];
    let index = 0;
    const flushQueue = () => {
        for (const item of queue) {
            output.push(item);
        }
        queue.length = 0;
    };
    void (async () => {
        try {
            while (true) {
                const result = await source.next();
                if (result.done)
                    break;
                const predicateResult = predicate(result.value, index++);
                const shouldDelay = isPromiseLike(predicateResult)
                    ? await predicateResult
                    : predicateResult;
                if (shouldDelay) {
                    queue.push(result.value);
                    continue;
                }
                if (queue.length > 0)
                    flushQueue();
                output.push(result.value);
            }
            if (queue.length > 0)
                flushQueue();
        }
        catch (err) {
            output.error(normalizeError(err));
        }
        finally {
            if (!output.completed())
                output.complete();
        }
    })();
    return () => { queue.length = 0; };
});

/**
 * Creates a stream operator that emits values from the source stream only if
 * they are different from the previous value.
 *
 * Consecutive duplicate values are yielded with `dropped: true` so that
 * backpressure is released and downstream operators can observe the suppressed
 * emissions without treating them as real values.
 *
 * @template T The type of the values in the stream.
 * @param comparator An optional function that compares the previous and current values.
 * It should return `true` if they are considered the same, and `false` otherwise.
 * If not provided, a strict equality check (`===`) is used.
 * @returns An `Operator<T, T>` instance that can be used in a stream's `pipe` method.
 */
const distinctUntilChanged = (comparator) => createOperator('distinctUntilChanged', function (source) {
    let lastValue;
    let hasLast = false;
    return {
        next: async () => {
            while (true) {
                const result = await source.next();
                if (result.done)
                    return DONE;
                if (!hasLast) {
                    lastValue = result.value;
                    hasLast = true;
                    return NEXT(result.value);
                }
                const comparison = comparator ? comparator(lastValue, result.value) : (lastValue === result.value);
                const isSame = comparator
                    ? (isPromiseLike(comparison) ? await comparison : comparison)
                    : comparison;
                if (!isSame) {
                    lastValue = result.value;
                    hasLast = true;
                    return NEXT(result.value);
                }
                // duplicate found, continue loop
            }
        },
    };
});

/**
 * Creates a stream operator that filters out consecutive values from the source
 * stream if a specified key's value has not changed.
 *
 * This operator is a specialized version of `distinctUntilChanged`. It checks for
 * uniqueness based on the value of a single property (`key`). Consecutive values
 * where the key has not changed are yielded with `dropped: true` so that backpressure
 * is released and downstream operators can observe suppressed emissions.
 *
 * @template T The type of the objects in the stream. Must extend `object`.
 * @template K The key of the property to check for changes.
 * @param key The name of the property to check for changes.
 * @param comparator An optional function to compare the previous and current values of the `key`.
 * It should return `true` if the values are considered the same. If not provided,
 * strict inequality (`!==`) is used.
 * @returns An `Operator<T, T>` instance that can be used in a stream's `pipe` method.
 */
const distinctUntilKeyChanged = (key, comparator) => createOperator('distinctUntilKeyChanged', function (source) {
    let lastValue;
    let isFirst = true;
    let resolvedKey;
    const getKey = async () => {
        if (resolvedKey === undefined) {
            resolvedKey = isPromiseLike(key) ? await key : key;
        }
        return resolvedKey;
    };
    return {
        next: async () => {
            while (true) {
                const result = await source.next();
                if (result.done)
                    return DONE;
                const current = result.value;
                const currentKey = await getKey();
                if (isFirst) {
                    isFirst = false;
                    lastValue = current;
                    return NEXT(current);
                }
                const prevKey = lastValue[currentKey];
                const currKey = current[currentKey];
                let isSame;
                if (comparator) {
                    const comparison = comparator(prevKey, currKey);
                    isSame = isPromiseLike(comparison) ? await comparison : comparison;
                }
                else {
                    isSame = prevKey === currKey;
                }
                if (!isSame) {
                    lastValue = current;
                    return NEXT(current);
                }
                // duplicate found, continue loop
            }
        }
    };
});

/**
 * Creates a stream operator that emits a final, specified value after the source stream has completed.
 *
 * The operator first consumes all values from the upstream source. Once the source stream signals
 * its completion (`done`), this operator then emits the `finalValue` and immediately completes.
 *
 * @template T The type of the values in the stream.
 * @param finalValue The value to be emitted as the last item in the stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const endWith = (finalValue) => createOperator("endWith", function (source) {
    let sourceDone = false;
    let finalEmitted = false;
    let completed = false;
    const finalValuePromise = Promise.resolve(finalValue);
    return {
        next: async () => {
            if (completed) {
                return DONE;
            }
            if (!sourceDone) {
                const result = await source.next();
                if (!result.done) {
                    return result;
                }
                sourceDone = true;
            }
            if (!finalEmitted) {
                finalEmitted = true;
                return NEXT(await finalValuePromise);
            }
            completed = true;
            return DONE;
        }
    };
});

/**
 * Maps each value from the source stream to an inner stream, ignoring
 * new outer values while the current inner stream is still executing.
 *
 * This operator is useful for preventing overlapping operations (e.g., preventing
 * multiple simultaneous form submissions or API calls). If a new value arrives
 * from the source while an earlier projected stream is still active, that
 * new value is silently discarded.
 * * Only after the current inner stream completes will the operator become
 * "idle" and ready to accept the next value from the source.
 *
 * @template T The type of values emitted by the source stream.
 * @template R The type of values emitted by the produced inner streams.
 * @param project A function that transforms a source value into a {@link Stream},
 * a {@link MaybePromise<R>}, or an array. It receives the source value and a
 * zero-based index of the emission.
 * @returns An {@link Operator} that performs the "exhaust" transformation.
 */
const exhaustMap = (project) => createOperator("exhaustMap", function (source) {
    let outerIndex = 0;
    let innerIterator = null;
    let isSourceDone = false;
    const drainBufferedOuterValues = () => {
        const tryNext = source.__tryNext;
        if (!tryNext)
            return null;
        while (true) {
            const r = tryNext.call(source);
            if (!r)
                return null;
            if (r.done) {
                isSourceDone = true;
                return null;
            }
        }
    };
    return {
        async next() {
            while (true) {
                if (innerIterator) {
                    const result = await innerIterator.next();
                    if (!result.done) {
                        return NEXT(result.value);
                    }
                    innerIterator = null;
                    const buffered = drainBufferedOuterValues();
                    if (buffered)
                        return buffered;
                    if (isSourceDone)
                        return DONE;
                    continue;
                }
                const result = await source.next();
                if (result.done) {
                    isSourceDone = true;
                    return DONE;
                }
                let projected;
                try {
                    projected = project(result.value, outerIndex++);
                }
                catch (err) {
                    isSourceDone = true;
                    throw normalizeError(err);
                }
                if (isPromiseLike(projected)) {
                    try {
                        projected = await projected;
                    }
                    catch (err) {
                        isSourceDone = true;
                        throw normalizeError(err);
                    }
                }
                const innerStream = fromAny(projected);
                innerIterator = innerStream[Symbol.asyncIterator]();
            }
        },
        async return(value) {
            try {
                await innerIterator?.return?.(value);
            }
            catch { }
            try {
                await source.return?.();
            }
            catch { }
            innerIterator = null;
            return DONE;
        },
        async throw(err) {
            const error = normalizeError(err);
            try {
                await innerIterator?.return?.();
            }
            catch { }
            try {
                await source.return?.();
            }
            catch { }
            innerIterator = null;
            throw error;
        }
    };
});

/**
 * Creates a stream operator that recursively expands each emitted value.
 *
 * This operator takes each value from the source stream and applies the `project`
 * function to it, which must return a new stream. It then recursively applies
 * the same logic to each value emitted by that new stream, effectively
 * flattening an infinitely deep, asynchronous data structure.
 *
 * This is particularly useful for traversing graph or tree-like data, such as
 * file directories or hierarchical API endpoints, where each item might lead
 * to a new collection of items that also need to be processed.
 *
 * @template T The type of the values in the source and output streams.
 * @param project A function that takes a value and returns a stream, value/array,
 * or a promise of those shapes to be expanded.
 * @param options An optional configuration object for traversal strategy and max depth.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const expand = (project, options = {}) => createOperator('expand', function (source) {
    const queue = [];
    let sourceDone = false;
    const enqueueChildren = async (value, depth) => {
        if (options.maxDepth !== undefined && depth >= options.maxDepth)
            return;
        const projected = project(value);
        const normalized = isPromiseLike(projected) ? await projected : projected;
        const stream = fromAny(normalized);
        const iterator = stream[Symbol.asyncIterator]();
        while (true) {
            const child = await iterator.next();
            if (child.done)
                break;
            const item = { result: child, depth: depth + 1 };
            if (options.traversal === 'breadth') {
                queue.push(item);
            }
            else {
                queue.unshift(item);
            }
        }
    };
    const iterator = {
        next: async () => {
            while (true) {
                while (queue.length === 0 && !sourceDone) {
                    const result = await source.next();
                    if (result.done) {
                        sourceDone = true;
                        break;
                    }
                    queue.push({ result, depth: 0 });
                }
                if (queue.length > 0) {
                    const item = options.traversal === 'breadth' ? queue.shift() : queue.pop();
                    await enqueueChildren(item.result.value, item.depth);
                    return NEXT(item.result.value);
                }
                if (sourceDone && queue.length === 0) {
                    return DONE;
                }
                // Yield to microtask queue to avoid starving the event loop
                await new Promise((resolve) => queueMicrotask(resolve));
            }
        },
        async return(value) {
            queue.length = 0;
            try {
                await source.return?.(value);
            }
            catch { }
            return DONE;
        },
        async throw(err) {
            const error = normalizeError(err);
            queue.length = 0;
            try {
                await source.return?.();
            }
            catch { }
            throw error;
        }
    };
    return iterator;
});

/**
 * Creates a stream operator that filters values emitted by the source stream.
 *
 * This operator provides flexible filtering capabilities. It processes each value
 * from the source stream and passes it through to the output stream only if it meets
 * a specific criterion.
 *
 * The filtering can be configured in one of three ways:
 * - A **predicate function**: A function that returns `true` for values to be included.
 * - A **single value**: Only values that are strictly equal (`===`) to this value are included.
 * - An **array of values**: Only values that are present in this array are included.
 *
 * Values that do not pass the filter are yielded with `dropped: true` so that
 * backpressure is released and downstream operators can observe suppressed emissions.
 *
 * @template T The type of the values in the stream.
 * @param predicateOrValue The filtering criterion. Can be a predicate function, a single value, or an array of values.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const filter = (predicateOrValue) => createOperator('filter', function (source) {
    let index = 0;
    return {
        next: async () => {
            while (true) {
                const result = await source.next();
                if (result.done)
                    return DONE;
                const value = result.value;
                const currentIndex = index++;
                let shouldInclude = false;
                if (typeof predicateOrValue === 'function') {
                    const predicateResult = predicateOrValue(value, currentIndex);
                    shouldInclude = isPromiseLike(predicateResult) ? await predicateResult : predicateResult;
                }
                else if (Array.isArray(predicateOrValue)) {
                    shouldInclude = predicateOrValue.includes(value);
                }
                else {
                    shouldInclude = value === predicateOrValue;
                }
                if (shouldInclude) {
                    return NEXT(value);
                }
                // value should be dropped, continue loop
            }
        }
    };
});

/**
 * Creates a stream operator that invokes a finalizer callback upon stream termination.
 *
 * This operator is useful for performing cleanup tasks, such as closing resources
 * or logging, after a stream has completed or encountered an error. The provided
 * `callback` is guaranteed to be called exactly once, regardless of whether the
 * stream terminates gracefully or with an error.
 *
 * @template T The type of the values emitted by the stream.
 * @param callback The function to be called when the stream completes or errors.
 * It can be synchronous or return a Promise.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const finalize = (callback) => {
    let finalized = false;
    let completed = false;
    let finalizationPromise = null;
    const doFinalize = async () => {
        if (!finalized) {
            finalized = true;
            completed = true;
            if (!finalizationPromise) {
                finalizationPromise = (async () => {
                    try {
                        await callback?.();
                    }
                    catch {
                        // Swallow errors to avoid affecting downstream consumers
                    }
                })();
            }
            await finalizationPromise;
        }
        else if (finalizationPromise) {
            await finalizationPromise;
        }
    };
    return createOperator("finalize", function (source) {
        const iterator = {
            async next() {
                if (completed) {
                    return DONE;
                }
                try {
                    const result = await source.next();
                    if (result.done) {
                        await doFinalize();
                        return DONE;
                    }
                    return result;
                }
                catch (err) {
                    await doFinalize();
                    throw normalizeError(err);
                }
            },
            async return(value) {
                await doFinalize();
                if (source.return) {
                    return source.return(value);
                }
                return DONE;
            },
            async throw(error) {
                await doFinalize();
                const normalizedError = normalizeError(error);
                if (source.throw) {
                    return source.throw(normalizedError);
                }
                throw normalizedError;
            }
        };
        return iterator;
    });
};

/**
 * Creates a stream operator that emits only the first element from the source stream
 * that matches an optional predicate.
 *
 * This operator is designed to find a specific value and then immediately terminate.
 * - If a `predicate` function is provided, the operator will emit the first value for which
 *   the predicate returns a truthy value.
 * - If no predicate is provided, it will simply emit the very first value from the source.
 *
 * After emitting a single value, the operator completes. If the source stream completes
 * before a matching value is found, an error is thrown.
 *
 * @template T The type of the values in the source stream.
 * @param predicate An optional function to test each value. It receives the value
 * and should return `true` to indicate a match.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 * @throws {Error} Throws an error with the message "No elements in sequence" if no matching
 * value is found before the source stream completes.
 */
const first = (predicate) => createOperator('first', function (source) {
    let found = false;
    let sourceDone = false;
    let stopped = false;
    const stopSource = async () => {
        if (stopped)
            return;
        stopped = true;
        try {
            await source.return?.();
        }
        catch {
        }
    };
    return {
        next: async () => {
            if (found) {
                return DONE;
            }
            if (sourceDone) {
                throw new Error("No elements in sequence");
            }
            while (true) {
                const result = await source.next();
                if (result.done) {
                    sourceDone = true;
                    await stopSource();
                    throw new Error("No elements in sequence");
                }
                const value = result.value;
                const predicateResult = predicate ? predicate(value) : true;
                const matches = predicate ? (isPromiseLike(predicateResult) ? await predicateResult : predicateResult) : predicateResult;
                if (matches) {
                    found = true;
                    await stopSource();
                    return NEXT(value);
                }
                // predicate doesn't match, continue loop
            }
        }
    };
});

/**
 * Creates a stream operator that routes each source value through a specific handler
 * based on matching predicates defined in the provided `ForkOption`s.
 *
 * For each value from the source stream:
 * 1. Iterates over the `options` array.
 * 2. Executes the `on` predicate for each option until one returns `true`.
 * 3. Calls the corresponding `handler` for the first matching option.
 * 4. Flattens the result (stream, value, promise, or array) sequentially into the output stream.
 *
 * If no predicate matches a value, an error is thrown.
 *
 * This operator allows conditional branching in streams based on the content of each item.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the output stream.
 * @param options {@link ForkOption} objects defining predicates and handlers.
 * @returns An {@link Operator} instance suitable for use in a stream's `pipe` method.
 *
 * @throws {Error} If a source value does not match any predicate.
 */
const fork = (...options) => createOperator('fork', function (source) {
    const resolvedOptions = options;
    let outerIndex = 0;
    let innerIterator = null;
    const iterator = {
        next: async () => {
            while (true) {
                // If no active inner iterator, get next outer value
                if (!innerIterator) {
                    const result = await source.next();
                    if (result.done) {
                        return DONE;
                    }
                    let matched;
                    const outerValue = result.value;
                    const currentIndex = outerIndex++;
                    for (const option of resolvedOptions) {
                        const predicateResult = option.on(outerValue, currentIndex);
                        if (isPromiseLike(predicateResult) ? await predicateResult : predicateResult) {
                            matched = option;
                            break;
                        }
                    }
                    if (!matched) {
                        throw new Error(`No handler found for value: ${outerValue}`);
                    }
                    const innerStream = fromAny(matched.handler(outerValue));
                    innerIterator = innerStream[Symbol.asyncIterator]();
                }
                // Pull next inner value
                const innerResult = await innerIterator.next();
                if (innerResult.done) {
                    innerIterator = null;
                    continue;
                }
                return NEXT(innerResult.value);
            }
        },
        async return(value) {
            try {
                await innerIterator?.return?.(value);
            }
            catch { }
            try {
                await source.return?.();
            }
            catch { }
            innerIterator = null;
            return DONE;
        },
        async throw(err) {
            const error = normalizeError(err);
            try {
                await innerIterator?.return?.();
            }
            catch { }
            try {
                await source.return?.();
            }
            catch { }
            innerIterator = null;
            throw error;
        }
    };
    return iterator;
});

/**
 * Creates a stream operator that groups values from the source stream by a computed key.
 *
 * This operator is a projection operator that transforms a stream of values into a
 * stream of `GroupItem` objects. For each value from the source, it applies the
 * `keySelector` function to determine a key and then emits an object containing both
 * the original value and the computed key.
 *
 * This operator is the first step in a typical grouping pipeline. The resulting stream
 * of `GroupItem` objects can then be processed further by other operators (e.g., `scan`
 * or `reduce`) to perform a true grouping into collections.
 *
 * @template T The type of the values in the source stream.
 * @template K The type of the key computed by `keySelector`.
 * @param keySelector A function that takes a value from the source stream and returns
 * a key. This function can be synchronous or asynchronous.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const groupBy = (keySelector) => createOperator("groupBy", function (source) {
    return {
        next: async () => {
            const result = await source.next();
            if (result.done) {
                return DONE;
            }
            const keyResult = keySelector(result.value);
            const key = isPromiseLike(keyResult) ? await keyResult : keyResult;
            return NEXT({ key, value: result.value });
        },
    };
});

/**
 * Creates a stream operator that ignores all values emitted by the source stream.
 *
 * This operator consumes the source stream but does not emit any values. It only
 * forwards the completion or error signal from the source stream. This is useful
 * when you only care about the "end" of an operation, not the intermediate results.
 * For example, waiting for a stream of side effects to complete before continuing.
 *
 * @template T The type of the values in the source stream (which are ignored).
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const ignoreElements = () => createOperator("ignoreElements", function (source) {
    return {
        next: async () => {
            while (true) {
                const result = await source.next();
                if (result.done)
                    return DONE;
                // ignore value, continue loop
            }
        }
    };
});

/**
 * Creates a stream operator that emits only the last value from the source stream
 * that matches an optional predicate.
 *
 * This operator must consume the entire source stream to find the last matching
 * value. It caches the last value that satisfies the `predicate` (or the last
 * value of the stream if no predicate is provided) and emits it only when the
 * source stream completes.
 *
 * @template T The type of the values in the source stream.
 * @param predicate An optional function to test each value. It receives the value
 * and should return `true` to indicate a match.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 * @throws {Error} Throws an error with the message "No elements in sequence" if no
 * matching value is found before the source stream completes.
 */
const last = (predicate) => createOperator("last", function (source) {
    let lastValue = undefined;
    let hasMatch = false;
    let finished = false;
    return {
        next: async () => {
            if (finished)
                return DONE;
            while (true) {
                const result = await source.next();
                if (result.done) {
                    finished = true;
                    if (!hasMatch)
                        throw new Error("No elements in sequence");
                    return NEXT(lastValue);
                }
                const value = result.value;
                const predicateResult = predicate ? predicate(value) : true;
                const matches = predicate ? (isPromiseLike(predicateResult) ? await predicateResult : predicateResult) : predicateResult;
                if (matches) {
                    lastValue = value;
                    hasMatch = true;
                }
                // continue consuming values
            }
        }
    };
});

/**
 * Creates a stream operator that applies a transformation function to each value
 * emitted by the source stream.
 *
 * This operator is a fundamental part of stream processing. It consumes each value
 * from the source, passes it to the `transform` function, and then emits the result
 * of that function. This is a one-to-one mapping, meaning the output stream will
 * have the same number of values as the source stream, but with potentially different
 * content and/or type.
 *
 * @template T The type of the values in the source stream.
 * @template R The type of the values in the output stream.
 * @param transform The transformation function to apply to each value. It receives
 * the value and its index. This function can be synchronous or asynchronous.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const map = (transform) => createOperator('map', function (source) {
    let index = 0;
    return {
        async next() {
            const result = await source.next();
            if (result.done) {
                return DONE;
            }
            const transformedResult = transform(result.value, index++);
            const transformedValue = isPromiseLike(transformedResult) ? await transformedResult : transformedResult;
            return NEXT(transformedValue);
        },
    };
});

/**
 * Creates a stream operator that maps each value from the source stream to an "inner" stream
 * and merges all inner streams concurrently into a single output stream.
 *
 * For each value from the source stream:
 * 1. The `project` function is called with the value and its index.
 * 2. The returned value is normalized into a stream using {@link fromAny}.
 * 3. The inner stream is consumed concurrently with all other active inner streams.
 * 4. Emitted values from all inner streams are interleaved into the output stream.
 *
 * This operator is useful for performing parallel asynchronous operations while
 * preserving all emitted values in a merged output with correct temporal ordering.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the inner and output streams.
 * @param project A function that maps a source value and its index to either:
 *   - a {@link Stream<R>},
 *   - a {@link MaybePromise<R>},
 *   - or an array of `R`.
 * @param concurrent Maximum number of concurrent inner streams (default: Infinity).
 * @param bufferSize Maximum number of source values to queue when concurrency limit is reached (default: Infinity).
 * @returns An {@link Operator} instance that can be used in a stream's `pipe` method.
 *
 * @example
 * ```typescript
 * // Process HTTP requests with max 3 concurrent
 * stream(urls).pipe(
 *   mergeMap(url => fetch(url), 3)
 * )
 * ```
 */
function mergeMap(project, concurrent = Infinity, bufferSize = Infinity) {
    return createPushOperator('mergeMap', function (source, output) {
        let stopped = false;
        const coordinator = createAsyncCoordinator([source]);
        void (async () => {
            const SOURCE_INDEX = 0;
            let projectIndex = 0;
            let sourceCompleted = false;
            let pendingInners = 0;
            const queuedSourceValues = [];
            const startInner = (value) => {
                const projected = project(value, projectIndex++);
                const inner = fromAny(projected);
                coordinator.addSource(inner[Symbol.asyncIterator]());
                pendingInners++;
            };
            const drainQueuedSourceValues = () => {
                while (queuedSourceValues.length > 0 && pendingInners < concurrent) {
                    startInner(queuedSourceValues.shift());
                }
            };
            try {
                while (!stopped) {
                    const nextEvent = await coordinator.next();
                    if (nextEvent.done)
                        break;
                    const event = nextEvent.value;
                    if (event.sourceIndex === SOURCE_INDEX) {
                        if (event.type === 'value') {
                            const sourceValue = event.value;
                            if (pendingInners >= concurrent) {
                                if (bufferSize !== Infinity && queuedSourceValues.length >= bufferSize) {
                                    queuedSourceValues.shift();
                                }
                                queuedSourceValues.push(sourceValue);
                            }
                            else {
                                startInner(sourceValue);
                            }
                        }
                        else if (event.type === 'complete') {
                            sourceCompleted = true;
                            if (pendingInners === 0 && queuedSourceValues.length === 0) {
                                break;
                            }
                        }
                        else if (event.type === 'error') {
                            throw event.error;
                        }
                    }
                    else {
                        if (event.type === 'value') {
                            output.push(event.value);
                        }
                        else if (event.type === 'complete') {
                            pendingInners--;
                            drainQueuedSourceValues();
                            if (sourceCompleted && pendingInners === 0 && queuedSourceValues.length === 0) {
                                break;
                            }
                        }
                        else if (event.type === 'error') {
                            throw event.error;
                        }
                    }
                }
                if (!output.completed())
                    output.complete();
            }
            catch (err) {
                if (!output.completed())
                    output.error(normalizeError(err));
            }
            finally {
                await coordinator.return?.();
            }
        })();
        return async () => {
            stopped = true;
            await coordinator.return?.();
        };
    });
}

/**
 * Creates a stream operator that schedules the emission of each value from the source
 * stream on a specified JavaScript task queue.
 *
 * This operator is a scheduler. It decouples the timing of value production from
 * its consumption, allowing you to control when values are emitted to downstream
 * operators. This is essential for preventing long-running synchronous operations
 * from blocking the main thread and for prioritizing different types of work.
 *
 * The operator supports three contexts:
 * - `"microtask"`: Emits the value at the end of the current task using `queueMicrotask`.
 * - `"macrotask"`: Emits the value in the next event loop cycle using `setTimeout(0)`.
 * - `"idle"`: Emits the value when the browser is idle using `requestIdleCallback`.
 *
 * @template T The type of the values in the source and output streams.
 * @param context The JavaScript task queue context to schedule emissions on.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const observeOn = (context) => {
    return createOperator('observeOn', function (source) {
        const output = createSubject();
        const outputIterator = output[Symbol.asyncIterator]();
        let pendingCount = 0;
        let allDoneResolve = null;
        let stopped = false;
        const pendingCancels = new Set();
        const waitForPending = () => {
            if (pendingCount === 0)
                return Promise.resolve();
            return new Promise((resolve) => { allDoneResolve = resolve; });
        };
        const settlePending = () => {
            pendingCount--;
            if (pendingCount === 0 && allDoneResolve) {
                allDoneResolve();
                allDoneResolve = null;
            }
        };
        void (async () => {
            try {
                const contextValue = isPromiseLike(context) ? await context : context;
                const schedule = contextValue === 'microtask'
                    ? (fn) => {
                        let settled = false;
                        const cancel = () => {
                            if (settled)
                                return;
                            settled = true;
                            settlePending();
                        };
                        queueMicrotask(() => {
                            if (settled || stopped)
                                return;
                            settled = true;
                            try {
                                fn();
                            }
                            finally {
                                settlePending();
                            }
                        });
                        return cancel;
                    }
                    : contextValue === 'macrotask'
                        ? (fn) => {
                            let settled = false;
                            const timeoutId = setTimeout(() => {
                                if (settled || stopped)
                                    return;
                                settled = true;
                                try {
                                    fn();
                                }
                                finally {
                                    settlePending();
                                }
                            }, 0);
                            return () => {
                                if (settled)
                                    return;
                                settled = true;
                                clearTimeout(timeoutId);
                                settlePending();
                            };
                        }
                        : (fn) => {
                            let settled = false;
                            const fallback = () => {
                                const timeoutId = setTimeout(() => {
                                    if (settled || stopped)
                                        return;
                                    settled = true;
                                    try {
                                        fn();
                                    }
                                    finally {
                                        settlePending();
                                    }
                                }, 0);
                                return () => {
                                    if (settled)
                                        return;
                                    settled = true;
                                    clearTimeout(timeoutId);
                                    settlePending();
                                };
                            };
                            if (typeof requestIdleCallback !== 'function') {
                                return fallback();
                            }
                            const idleId = requestIdleCallback(() => {
                                if (settled || stopped)
                                    return;
                                settled = true;
                                try {
                                    fn();
                                }
                                finally {
                                    settlePending();
                                }
                            });
                            return () => {
                                if (settled)
                                    return;
                                settled = true;
                                if (typeof cancelIdleCallback === 'function') {
                                    cancelIdleCallback(idleId);
                                }
                                settlePending();
                            };
                        };
                while (true) {
                    const result = await source.next();
                    if (result.done)
                        break;
                    pendingCount++;
                    const capturedResult = result;
                    const cancel = schedule(() => {
                        pendingCancels.delete(cancel);
                        output.next(capturedResult.value);
                    });
                    pendingCancels.add(cancel);
                }
                // Wait for all scheduled emissions before completing
                await waitForPending();
            }
            catch (err) {
                output.error(normalizeError(err));
            }
            finally {
                if (!output.completed())
                    output.complete();
            }
        })();
        let completed = false;
        const iterator = {
            async next() {
                while (true) {
                    if (completed)
                        return DONE;
                    const result = await outputIterator.next();
                    if (result.done) {
                        completed = true;
                        return DONE;
                    }
                    return { done: false, value: result.value };
                }
            },
            async return(value) {
                completed = true;
                stopped = true;
                for (const cancel of pendingCancels) {
                    cancel();
                }
                pendingCancels.clear();
                try {
                    await source.return?.(value);
                }
                catch { }
                if (!output.completed())
                    output.complete();
                return DONE;
            },
            async throw(err) {
                const error = normalizeError(err);
                completed = true;
                stopped = true;
                for (const cancel of pendingCancels) {
                    cancel();
                }
                pendingCancels.clear();
                try {
                    await source.return?.();
                }
                catch { }
                if (!output.completed())
                    output.error(error);
                throw error;
            }
        };
        return iterator;
    });
};

/**
 * Creates a stream operator that partitions the source stream into two groups based on a predicate.
 *
 * This operator is a specialized form of `groupBy`. For each value from the source stream,
 * it applies the provided `predicate` function. It then emits a new object, a `GroupItem`,
 * containing the original value and a key of `"true"` or `"false"`, indicating whether the
 * value satisfied the predicate.
 *
 * This operator does not create two physical streams, but rather tags each item with its
 * group membership, allowing for subsequent conditional routing or processing.
 *
 * @template T The type of the values in the source stream.
 * @param predicate A function that takes a value and its index and returns a boolean or
 * `Promise<boolean>`. `true` for one group, `false` for the other.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method,
 * emitting objects of type `GroupItem<T, "true" | "false">`.
 */
const partition = (predicate) => createOperator('partition', function (source) {
    let index = 0;
    return {
        next: async () => {
            const result = await source.next();
            if (result.done) {
                return result;
            }
            const predicateResult = predicate(result.value, index++);
            const key = (isPromiseLike(predicateResult) ? await predicateResult : predicateResult) ? "true" : "false";
            return NEXT({ key, value: result.value });
        }
    };
});

/**
 * Creates a stream operator that accumulates all values from the source stream
 * into a single value using a provided accumulator function.
 *
 * This operator consumes the source lazily and emits intermediate values as phantoms.
 * It will always emit at least the seed value if the stream is empty.
 *
 * @template T The type of the values in the source stream.
 * @template A The type of the accumulated value.
 * @param accumulator Function combining current accumulated value with a new value.
 * Can be synchronous or asynchronous.
 * @param seed Initial value for the accumulator.
 * @returns An `Operator` instance usable in a stream's `pipe` method.
 */
const reduce = (accumulator, seed) => createOperator("reduce", function (source) {
    let finalValue = seed;
    let emittedFinal = false;
    return {
        next: async () => {
            while (true) {
                const result = await source.next();
                if (result.done) {
                    if (!emittedFinal) {
                        emittedFinal = true;
                        return NEXT(finalValue);
                    }
                    return DONE;
                }
                const accumulated = accumulator(finalValue, result.value);
                finalValue = isPromiseLike(accumulated) ? await accumulated : accumulated;
                // continue consuming values
            }
        },
    };
});

/**
 * Creates a stream operator that emits the most recent value from the source stream
 * at a fixed periodic interval.
 *
 * Values that arrive between sample ticks and are not emitted are forwarded with
 * `dropped: true` so that backpressure is released without surfacing them as real
 * emissions.
 *
 * @template T The type of the values in the source and output streams.
 * @param period The time in milliseconds between each emission.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
const sample = (period) => createPushOperator('sample', (source, output) => {
    let lastValue;
    let hasValue = false;
    let intervalId = null;
    let resolvedPeriod = undefined;
    const emit = () => {
        if (hasValue) {
            output.push(lastValue);
            hasValue = false;
        }
    };
    const startSampling = () => {
        if (resolvedPeriod === undefined)
            return;
        intervalId = setInterval(emit, resolvedPeriod);
    };
    const stopSampling = () => {
        if (intervalId !== null)
            clearInterval(intervalId);
        intervalId = null;
    };
    void (async () => {
        try {
            resolvedPeriod = isPromiseLike(period) ? await period : period;
            startSampling();
            while (true) {
                const result = await source.next();
                if (result.done)
                    break;
                lastValue = result.value;
                hasValue = true;
            }
            // Emit the last value if pending when source completes.
            emit();
        }
        catch (err) {
            output.error(normalizeError(err));
        }
        finally {
            stopSampling();
            if (!output.completed())
                output.complete();
        }
    })();
    return stopSampling;
});

/**
 * Creates a stream operator that accumulates values from the source stream,
 * emitting each intermediate accumulated result.
 *
 * This operator is stateful and is ideal for scenarios where you need to maintain
 * a running total or build a state object over the life of a stream. It takes a
 * `seed` value and an `accumulator` function. For each value from the source,
 * it applies the accumulator and emits the new result immediately.
 *
 * @template T The type of the values in the source stream.
 * @template R The type of the accumulated value and the output stream.
 * @param accumulator The function that combines the current accumulated value
 * with the new value from the source. This function can be synchronous or asynchronous.
 * @param seed The initial value for the accumulator.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const scan = (accumulator, seed) => createOperator("scan", function (source) {
    let acc = seed;
    let index = 0;
    return {
        next: async () => {
            const result = await source.next();
            if (result.done) {
                return DONE;
            }
            const accumulated = accumulator(acc, result.value, index++);
            acc = isPromiseLike(accumulated) ? await accumulated : accumulated;
            return NEXT(acc);
        },
    };
});

/**
 * Creates a stream operator that emits only the values at the specified indices from a source stream.
 *
 * This operator takes an `indexIterator` (which can be a synchronous or asynchronous iterator
 * of numbers) and uses it to determine which values from the source stream should be emitted.
 * It acts as a positional filter: each source value is inspected once, and if its zero-based
 * index matches the next index yielded by `indexIterator`, that value is emitted. No buffering
 * of past values occurs. If the iterator completes, the operator completes regardless of
 * remaining source values.
 *
 * @template T The type of the values in the source and output streams.
 * @param indexIterator An iterator or async iterator that provides the zero-based indices
 * of the elements to be emitted.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const select = (indexIterator) => createOperator("select", function (source) {
    function toAsyncIterator(iter) {
        if (typeof iter[Symbol.asyncIterator] === "function") {
            return iter;
        }
        const syncIter = iter;
        return {
            async next() {
                return syncIter.next();
            },
            [Symbol.asyncIterator]() {
                return this;
            }
        };
    }
    const asyncIndexIterator = toAsyncIterator(indexIterator);
    async function* generator() {
        let currentIndex = 0;
        let nextTargetIndexPromise = asyncIndexIterator.next();
        while (true) {
            const result = await source.next();
            if (result.done)
                break;
            const targetIndexResult = await nextTargetIndexPromise;
            if (targetIndexResult.done)
                return;
            const nextTargetIndex = targetIndexResult.value;
            if (currentIndex === nextTargetIndex) {
                yield result.value;
                // fetch next target index
                nextTargetIndexPromise = asyncIndexIterator.next();
            }
            currentIndex++;
        }
    }
    // Return the async iterator directly - operators work with AsyncIterator<T>
    return generator();
});

/**
 * Shares a single subscription to the source stream between multiple consumers.
 *
 * This operator multicasts the upstream iterator through an internal subject so
 * that every subsequent consumer receives the same values without re-running the source.
 * The subject does not replay values for late subscribers; they receive only values
 * emitted after they subscribe.
 *
 * @template T Value type in the shared stream.
 * @returns An operator that can be inserted into a pipeline to share the source.
 */
function share() {
    let shared;
    let isConnected = false;
    let sourceIterator = null;
    let subscriberCount = 0;
    const disconnect = () => {
        if (sourceIterator) {
            const it = sourceIterator;
            sourceIterator = null;
            isConnected = false;
            void it.return?.().catch(() => { });
        }
    };
    const connect = (source) => {
        sourceIterator = source;
        isConnected = true;
        void (async () => {
            try {
                while (true) {
                    const result = await source.next();
                    if (result.done)
                        break;
                    shared.next(result.value);
                }
            }
            catch (err) {
                shared.error(normalizeError(err));
                return;
            }
            finally {
                if (shared && !shared.completed())
                    shared.complete();
            }
        })();
    };
    return createOperator('share', function (source) {
        if (!shared)
            shared = createSubject();
        if (!isConnected) {
            connect(source);
        }
        else if (typeof source.return === "function") {
            // Each `for await` on the piped stream creates a fresh upstream iterator.
            // Once we're connected, we must close these unused iterators immediately,
            // otherwise they remain subscribed and can backpressure the shared source.
            Promise.resolve(source.return()).catch(() => { });
        }
        subscriberCount++;
        const outputIterator = shared[Symbol.asyncIterator]();
        const baseReturn = outputIterator.return?.bind(outputIterator);
        const baseThrow = outputIterator.throw?.bind(outputIterator);
        outputIterator.return = async (value) => {
            subscriberCount--;
            if (subscriberCount === 0 && isConnected) {
                disconnect();
            }
            return baseReturn ? baseReturn(value) : DONE;
        };
        outputIterator.throw = async (err) => {
            const error = normalizeError(err);
            if (baseThrow)
                return baseThrow(error);
            throw error;
        };
        return outputIterator;
    });
}

/**
 * Creates a stream operator that shares a single subscription to the source stream
 * and replays a specified number of past values to new subscribers.
 *
 * This operator multicasts the source stream, ensuring that multiple downstream
 * consumers can receive values from a single source connection. It uses an internal
 * subscriber queue and a bounded replay buffer so that late subscribers receive the
 * most recent values before continuing with live emissions.
 *
 * This is useful for:
 * - Preventing redundant execution of a source stream (e.g. a network request).
 * - Providing a "state history" to late subscribers.
 *
 * @template T The type of the values in the stream.
 * @param bufferSize The number of last values to replay to new subscribers. Defaults to `Infinity`.
 *                   Can be a Promise that resolves to a number.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
function shareReplay(bufferSize = Infinity) {
    let isConnected = false;
    let resolvedSize;
    let sourceIterator = null;
    let activeConnection = null;
    const replay = [];
    let replayHead = 0;
    let completed = false;
    let errorValue;
    const subscribers = new Set();
    const pushReplay = (value) => {
        if (resolvedSize === undefined || resolvedSize === Infinity) {
            replay.push(value);
            return;
        }
        if (resolvedSize <= 0)
            return;
        if (replay.length < resolvedSize) {
            replay.push(value);
        }
        else {
            replay[replayHead] = value;
            replayHead = (replayHead + 1) % resolvedSize;
        }
    };
    const snapshotReplay = () => {
        if (resolvedSize === undefined || resolvedSize === Infinity) {
            return [...replay];
        }
        if (resolvedSize <= 0 || replay.length === 0) {
            return [];
        }
        if (replay.length < resolvedSize) {
            return [...replay];
        }
        return [...replay.slice(replayHead), ...replay.slice(0, replayHead)];
    };
    const broadcastValue = (value) => {
        for (const subscriber of subscribers) {
            if (subscriber.done)
                continue;
            if (subscriber.pendingResolve) {
                const resolve = subscriber.pendingResolve;
                subscriber.pendingResolve = subscriber.pendingReject = null;
                resolve({ value, done: false });
            }
            else {
                subscriber.queue.push(value);
            }
        }
    };
    const broadcastCompletion = () => {
        for (const subscriber of subscribers) {
            if (subscriber.done || subscriber.queue.length > 0 || !subscriber.pendingResolve) {
                continue;
            }
            const resolve = subscriber.pendingResolve;
            subscriber.pendingResolve = subscriber.pendingReject = null;
            resolve(DONE);
        }
    };
    const broadcastError = (error) => {
        for (const subscriber of subscribers) {
            if (subscriber.done || !subscriber.pendingReject) {
                continue;
            }
            const reject = subscriber.pendingReject;
            subscriber.pendingResolve = subscriber.pendingReject = null;
            reject(error);
        }
    };
    const disconnect = () => {
        if (sourceIterator) {
            const it = sourceIterator;
            sourceIterator = null;
            isConnected = false;
            activeConnection = null;
            void it.return?.().catch(() => { });
        }
    };
    const connectSource = (source) => {
        const connection = Symbol("shareReplayConnection");
        sourceIterator = source;
        isConnected = true;
        activeConnection = connection;
        void (async () => {
            try {
                while (true) {
                    const result = await source.next();
                    if (result.done)
                        break;
                    pushReplay(result.value);
                    broadcastValue(result.value);
                }
            }
            catch (err) {
                errorValue = normalizeError(err);
                broadcastError(errorValue);
                return;
            }
            finally {
                if (activeConnection !== connection) {
                    return;
                }
                sourceIterator = null;
                completed = true;
                isConnected = false;
                activeConnection = null;
                broadcastCompletion();
            }
        })();
    };
    return createOperator('shareReplay', function (source) {
        let initialized = false;
        const subscriber = {
            done: false,
            queue: [],
            pendingResolve: null,
            pendingReject: null,
        };
        const ensureConnected = async () => {
            if (initialized)
                return;
            initialized = true;
            if (resolvedSize === undefined) {
                resolvedSize = isPromiseLike(bufferSize) ? await bufferSize : bufferSize;
            }
            subscriber.queue.push(...snapshotReplay());
            subscribers.add(subscriber);
            if (!completed && errorValue === undefined && !isConnected) {
                connectSource(source);
            }
            else if (typeof source.return === 'function') {
                await Promise.resolve(source.return()).catch(() => { });
            }
        };
        const cleanup = () => {
            if (subscriber.done)
                return;
            subscriber.done = true;
            subscribers.delete(subscriber);
            if (subscribers.size === 0 && isConnected) {
                disconnect();
            }
            if (subscriber.pendingResolve) {
                subscriber.pendingResolve(DONE);
                subscriber.pendingResolve = subscriber.pendingReject = null;
            }
        };
        const iterator = {
            async next() {
                if (subscriber.done)
                    return DONE;
                await ensureConnected();
                if (subscriber.queue.length > 0) {
                    return { value: subscriber.queue.shift(), done: false };
                }
                if (errorValue !== undefined) {
                    cleanup();
                    throw errorValue;
                }
                if (completed) {
                    cleanup();
                    return DONE;
                }
                return new Promise((resolve, reject) => {
                    subscriber.pendingResolve = resolve;
                    subscriber.pendingReject = reject;
                });
            },
            async return(value) {
                cleanup();
                return { value, done: true };
            },
            async throw(err) {
                cleanup();
                throw normalizeError(err);
            }
        };
        void ensureConnected();
        return iterator;
    });
}

/**
 * Creates a stream operator that skips the first specified number of values from the source stream.
 *
 * This operator is useful for "fast-forwarding" a stream. It consumes the initial `count` values
 * from the source stream without emitting them to the output. Once the count is reached,
 * it begins to pass all subsequent values through unchanged.
 *
 * Skipped values are yielded with `dropped: true` so that backpressure is released and
 * downstream operators can observe the suppressed emissions.
 *
 * @template T The type of the values in the source and output streams.
 * @param count The number of values to skip from the beginning of the stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const skip = (count) => createOperator('skip', function (source) {
    let remaining;
    const getRemaining = () => {
        if (remaining !== undefined) {
            return remaining;
        }
        if (isPromiseLike(count)) {
            return count.then((val) => {
                remaining = val;
                return val;
            });
        }
        remaining = count;
        return remaining;
    };
    return {
        next: async () => {
            while (true) {
                const result = await source.next();
                if (result.done)
                    return DONE;
                const remainingOrPromise = getRemaining();
                const currentRemaining = isPromiseLike(remainingOrPromise) ? await remainingOrPromise : remainingOrPromise;
                if (currentRemaining > 0) {
                    remaining = currentRemaining - 1;
                    // skip this value, continue loop
                    continue;
                }
                return NEXT(result.value);
            }
        },
    };
});

/**
 * Skip source values until a notifier emits.
 *
 * `skipUntil` suppresses (drops) source values until the provided `notifier`
 * produces its first emission. After the notifier emits, subsequent source
 * values are forwarded normally.
 *
 * Values suppressed before the gate opens are yielded with `dropped: true` so
 * that backpressure is released and downstream operators can observe the
 * suppressed emissions.
 *
 * Important details:
 * - Notifier completion without emission: if the notifier completes without
 *   emitting, the operator remains closed and continues to drop source values.
 * - Error propagation: errors from either the notifier or source are propagated
 *   to the output and will terminate the subscription.
 *
 * @template T Source/output value type.
 * @template N Notifier value type (ignored by this operator).
 * @param notifier A `Stream<N>` or `Promise<N>` that opens the gate when it emits.
 * @returns An `Operator<T, T>` that drops source values until the notifier emits.
 */
function skipUntil(notifier) {
    return createOperator("skipUntil", function (source) {
        const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();
        const runner = createAsyncCoordinator([source, notifierIt]);
        let gateOpened = false;
        let droppingBacklog = false;
        let isDone = false;
        const handleEvent = (event) => {
            if (event.type === 'error') {
                isDone = true;
                throw event.error;
            }
            if (event.type === 'complete') {
                if (event.sourceIndex === 0) {
                    isDone = true;
                    return DONE;
                }
                // Notifier completing without emission is handled by gateOpened remaining false
                return null;
            }
            if (event.sourceIndex === 1) {
                // Notifier emitted: open the gate
                if (!gateOpened) {
                    gateOpened = true;
                    droppingBacklog = !!source.__hasBufferedValues?.();
                }
                return null;
            }
            // Source value (sourceIndex === 0)
            if (gateOpened && droppingBacklog) {
                // Drop values that were already buffered before the gate opened.
                droppingBacklog = !!source.__hasBufferedValues?.();
                return null;
            }
            if (gateOpened) {
                return NEXT(event.value);
            }
            // Gate not yet open — skip this value and continue waiting.
            return null;
        };
        const iterator = {
            async next() {
                if (isDone)
                    return DONE;
                while (true) {
                    // 1. Try sync drain
                    const sync = this.__tryNext?.();
                    if (sync)
                        return sync;
                    // 2. Wait for runner
                    const result = await runner.next();
                    if (result.done)
                        return DONE;
                    const out = handleEvent(result.value);
                    if (out)
                        return out;
                }
            },
            __tryNext() {
                if (isDone)
                    return DONE;
                while (runner.__hasBufferedValues?.()) {
                    const res = runner.__tryNext?.();
                    if (!res || res.done)
                        break;
                    const out = handleEvent(res.value);
                    if (out)
                        return out;
                }
                return isDone ? DONE : null;
            },
            __hasBufferedValues: () => runner.__hasBufferedValues?.() ?? false,
            async return(value) {
                isDone = true;
                await runner.return?.();
                return value !== undefined ? { value, done: true } : DONE;
            }
        };
        return iterator;
    });
}

/**
 * Creates a stream operator that skips values from the source stream while a predicate returns true.
 *
 * Values skipped while the predicate holds are yielded with `dropped: true` so that
 * backpressure is released and downstream operators can observe suppressed emissions.
 * As soon as the predicate returns `false` for the first time, this operator emits
 * that value and all subsequent values normally.
 *
 * @template T The type of the values in the source and output streams.
 * @param predicate The function to test each value. Receives the value and its index. `true` means to continue skipping,
 * and `false` means to stop skipping and begin emitting.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const skipWhile = (predicate) => createOperator('skipWhile', function (source) {
    let skipping = true;
    let index = 0;
    return {
        next: async () => {
            while (true) {
                const result = await source.next();
                if (result.done)
                    return DONE;
                if (skipping) {
                    const predicateResult = predicate(result.value, index++);
                    const shouldSkip = isPromiseLike(predicateResult) ? await predicateResult : predicateResult;
                    if (!shouldSkip) {
                        skipping = false;
                        return NEXT(result.value);
                    }
                    // skip this value, continue loop
                    continue;
                }
                index++;
                return NEXT(result.value);
            }
        }
    };
});

/**
 * Creates a stream operator that emits pairs of values from the source stream,
 * where each pair consists of the previous and the current value.
 *
 * This operator is a powerful tool for comparing consecutive values in a stream.
 * It maintains an internal state to remember the last value it received. For
 * each new value, it creates a tuple of `[prior, currentValue]` and
 * emits it to the output stream.
 *
 * The very first value emitted will have `undefined` as its "previous" value.
 *
 * @template T The type of the values in the source stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method,
 * emitting tuples of `[T | undefined, T]`.
 */
const slidingPair = () => createOperator('slidingPair', function (source) {
    let prev = undefined;
    let first = true;
    return {
        next: async () => {
            const result = await source.next();
            if (result.done) {
                return result;
            }
            const value = [first ? undefined : prev, result.value];
            prev = result.value;
            first = false;
            return NEXT(value);
        }
    };
});

/**
 * Creates a stream operator that prepends a specified value to the beginning of the stream.
 *
 * The operator first emits the `initialValue` immediately upon being iterated.
 * After this initial emission, it begins to pull and emit values from the
 * source stream as they become available.
 *
 * @template T The type of the values in the stream.
 * @param initialValue The value to be emitted as the first item in the stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const startWith = (initialValue) => createOperator("startWith", function (source) {
    let emittedInitial = false;
    let completed = false;
    const initialValuePromise = Promise.resolve(initialValue);
    return {
        next: async () => {
            if (completed) {
                return DONE;
            }
            if (!emittedInitial) {
                emittedInitial = true;
                return NEXT(await initialValuePromise);
            }
            const result = await source.next();
            if (result.done) {
                completed = true;
                return DONE;
            }
            return result;
        }
    };
});

/**
 * Transforms each value from the source stream into a new inner stream, promise, or array,
 * and emits values only from the most recently created inner stream.
 *
 * When a new value is emitted from the source, the previous inner stream (if any) is cancelled
 * and unsubscribed, and a new inner stream is created using the `project` function. Only values
 * from the latest inner stream are emitted to the output. If the projected value is a {@link MaybePromise<R>} or array,
 * it is normalized to a stream.
 *
 * If the source completes and there is no active inner stream, the output completes. If an error occurs
 * in the source, the projection function, or the inner stream, the output emits an error and completes.
 *
 * @typeParam T - The type of values emitted by the source stream.
 * @typeParam R - The type of values emitted by the projected inner streams.
 * @param project - A function that receives each value and index from the source stream and returns a stream, a {@link MaybePromise<R>}, or array of values to be emitted.
 * @returns An operator function that can be applied to a stream, emitting values from the most recent inner stream created by the projection function.
 *
 * @example
 * ```ts
 * // For each number, start a new timer stream and emit its ticks, cancelling the previous timer.
 * source.pipe(switchMap(n => timerStream(n)))
 * ```
 */
function switchMap(project) {
    return createOperator("switchMap", function (source) {
        const output = createAsyncPushable();
        const outputIterator = output;
        let currentInner = null;
        let inputCompleted = false;
        let currentInnerToken = null;
        let index = 0;
        let stopped = false;
        /**
         * Checks if the overall operator should complete.
         * Only completes if the source is done AND no inner stream is active.
         */
        const checkComplete = () => {
            if (inputCompleted && !currentInner) {
                output.complete();
            }
        };
        const subscribeToInner = (innerStream, token) => {
            // Cancel the previous inner immediately so sync inner streams can't
            // interleave emissions out-of-order via re-entrant scheduler execution.
            const prev = currentInner;
            if (prev) {
                Promise.resolve(prev.it.return?.()).catch(() => { });
            }
            const it = innerStream[Symbol.asyncIterator]();
            currentInner = { token, it };
            void (async () => {
                try {
                    while (!stopped && token === currentInnerToken) {
                        const r = await it.next();
                        if (r.done)
                            break;
                        if (stopped || token !== currentInnerToken)
                            break;
                        output.push(r.value);
                    }
                }
                catch (err) {
                    if (!stopped && token === currentInnerToken) {
                        output.error(normalizeError(err));
                    }
                }
                finally {
                    if (currentInner?.token === token) {
                        currentInner = null;
                    }
                    checkComplete();
                }
            })();
        };
        const processOuterValue = (value) => {
            const token = {};
            currentInnerToken = token;
            let projected;
            try {
                projected = project(value, index++);
            }
            catch (err) {
                output.error(normalizeError(err));
                return;
            }
            if (isPromiseLike(projected)) {
                const capturedToken = token;
                Promise.resolve(projected).then((normalized) => {
                    if (stopped || capturedToken !== currentInnerToken)
                        return;
                    subscribeToInner(fromAny(normalized), capturedToken);
                }, (err) => {
                    if (stopped || capturedToken !== currentInnerToken)
                        return;
                    output.error(normalizeError(err));
                });
            }
            else {
                subscribeToInner(fromAny(projected), token);
            }
        };
        const sourceWithPush = source;
        const tryNext = sourceWithPush.__tryNext;
        const originalOnPush = sourceWithPush.__onPush;
        let wiredOnPush;
        const restoreSourcePush = () => {
            if (wiredOnPush && sourceWithPush.__onPush === wiredOnPush) {
                sourceWithPush.__onPush = originalOnPush;
            }
            wiredOnPush = undefined;
        };
        if (typeof tryNext === "function") {
            const drain = () => {
                while (!stopped) {
                    let result;
                    try {
                        result = tryNext.call(source);
                    }
                    catch (err) {
                        restoreSourcePush();
                        output.error(normalizeError(err));
                        return;
                    }
                    if (!result)
                        return;
                    if (result.done) {
                        inputCompleted = true;
                        restoreSourcePush();
                        checkComplete();
                        return;
                    }
                    processOuterValue(result.value);
                }
            };
            wiredOnPush = drain;
            sourceWithPush.__onPush = wiredOnPush;
            drain();
        }
        else {
            void (async () => {
                try {
                    while (!stopped) {
                        const result = await source.next();
                        if (result.done)
                            break;
                        processOuterValue(result.value);
                    }
                    inputCompleted = true;
                    checkComplete();
                }
                catch (err) {
                    output.error(normalizeError(err));
                }
            })();
        }
        const baseReturn = outputIterator.return?.bind(outputIterator);
        const baseThrow = outputIterator.throw?.bind(outputIterator);
        outputIterator.return = async () => {
            stopped = true;
            restoreSourcePush();
            try {
                try {
                    await currentInner?.it.return?.();
                }
                catch { }
            }
            finally {
                currentInner = null;
            }
            try {
                await source.return?.();
            }
            catch { }
            return baseReturn ? baseReturn(undefined) : DONE;
        };
        outputIterator.throw = async (err) => {
            const error = normalizeError(err);
            stopped = true;
            restoreSourcePush();
            try {
                try {
                    await currentInner?.it.return?.();
                }
                catch { }
            }
            finally {
                currentInner = null;
            }
            if (baseThrow)
                return baseThrow(error);
            throw error;
        };
        return outputIterator;
    });
}

/**
 * Creates a stream operator that emits only the first `count` values from the source stream
 * and then completes.
 *
 * This operator is a powerful tool for controlling the length of a stream. It consumes values
 * from the source one by one, and as long as the total number of values emitted is less than
 * `count`, it passes them through to the output. Once the count is reached, it stops
 * processing the source and signals completion to its downstream consumers. This is especially
 * useful for managing finite segments of large or infinite streams.
 *
 * @template T The type of the values in the source and output streams.
 * @param count The maximum number of values to take from the beginning of the stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const take = (count) => createOperator("take", function (source) {
    let emitted = 0;
    let done = false;
    let resolvedCount;
    const getCount = () => {
        if (resolvedCount !== undefined) {
            return resolvedCount;
        }
        if (isPromiseLike(count)) {
            return count.then((val) => {
                resolvedCount = val;
                return val;
            });
        }
        resolvedCount = count;
        return resolvedCount;
    };
    return {
        next: async () => {
            if (done) {
                return DONE;
            }
            const result = await source.next();
            if (result.done) {
                done = true;
                return DONE;
            }
            emitted++;
            const countOrPromise = getCount();
            const limit = isPromiseLike(countOrPromise) ? await countOrPromise : countOrPromise;
            if (emitted > limit) {
                done = true;
                try {
                    await source.return?.();
                }
                catch { }
                return DONE;
            }
            return NEXT(result.value);
        }
    };
});

/**
 * Take values from the source until a notifier emits.
 *
 * This operator forwards values from the source stream until the notifier
 * emits its first value or completes. Once the notifier emits, the operator
 * completes immediately and unsubscribes from the source.
 *
 * Important semantics:
 * - If notifier emits before any source values, no source values are emitted
 * - If source completes before notifier emits, operator completes normally
 * - Errors from either source or notifier are propagated
 *
 * @template T Source/output value type.
 * @template N Notifier value type (ignored by this operator).
 * @param notifier A `Stream<N>` or `Promise<N>` that signals when to stop taking.
 * @returns An `Operator<T, T>` that can be used in a stream pipeline.
 */
function takeUntil(notifier) {
    return createOperator("takeUntil", function (source) {
        const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();
        const runner = createAsyncCoordinator([source, notifierIt]);
        let isDone = false;
        const iterator = {
            async next() {
                if (isDone)
                    return DONE;
                while (true) {
                    const result = await runner.next();
                    if (result.done) {
                        // Both sources completed - this means notifier never emitted and source is done
                        isDone = true;
                        return DONE;
                    }
                    const event = result.value;
                    switch (event.type) {
                        case 'value':
                            if (event.sourceIndex === 0) {
                                // Source value - forward it (preserving dropped flag)
                                return NEXT(event.value);
                            }
                            // Notifier emitted - stop immediately
                            isDone = true;
                            await notifierIt.return?.();
                            return DONE;
                        case 'complete':
                            if (event.sourceIndex === 0) {
                                // Source completed normally - we're done
                                isDone = true;
                                return DONE;
                            }
                            else {
                                // Notifier completed without emitting - ignore, keep taking from source
                                // Just continue
                            }
                            break;
                        case 'error':
                            isDone = true;
                            throw event.error;
                    }
                }
            },
            __tryNext: () => {
                if (isDone)
                    return DONE;
                if (!runner.__tryNext)
                    return null;
                while (true) {
                    const result = runner.__tryNext();
                    if (!result || result.done)
                        break;
                    const event = result.value;
                    switch (event.type) {
                        case 'value':
                            if (event.sourceIndex === 0) {
                                return NEXT(event.value);
                            }
                            isDone = true;
                            // Can't await in sync method, but we can schedule cleanup
                            notifierIt.return?.().catch(() => { });
                            return DONE;
                        case 'complete':
                            if (event.sourceIndex === 0) {
                                isDone = true;
                                return DONE;
                            }
                            // Ignore notifier completion
                            break;
                        case 'error':
                            isDone = true;
                            throw event.error;
                    }
                }
                return isDone ? DONE : null;
            },
            __hasBufferedValues: () => {
                return runner.__hasBufferedValues?.() ?? false;
            },
            async return(value) {
                if (isDone)
                    return value !== undefined ? { value, done: true } : DONE;
                isDone = true;
                // Clean up both iterators
                await runner.return?.();
                await notifierIt.return?.();
                return value !== undefined ? { value, done: true } : DONE;
            },
            async throw(err) {
                const error = normalizeError(err);
                if (isDone)
                    return Promise.reject(error);
                isDone = true;
                await runner.throw?.(error);
                await notifierIt.return?.();
                return Promise.reject(error);
            }
        };
        return iterator;
    });
}

/**
 * Creates a stream operator that emits values from the source stream as long as
 * a predicate returns true.
 *
 * This operator is a conditional limiter. It consumes values from the source stream
 * and applies the `predicate` function to each. As long as the predicate returns `true`,
 * the value is passed through to the output stream. The first time the predicate returns
 * a falsy value, the operator stops emitting and immediately completes the output stream.
 * The value that caused the predicate to fail is not emitted.
 *
 * This is useful for taking a contiguous block of data from a stream that meets a certain
 * condition, such as processing user input until an invalid entry is made.
 *
 * @template T The type of the values in the source and output streams.
 * @param predicate The function to test each value. Receives the value and its index. `true` means to continue emitting,
 * and `false` means to stop and complete. It can be synchronous or asynchronous.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const takeWhile = (predicate) => createOperator("takeWhile", function (source) {
    let active = true;
    let index = 0;
    return {
        next: async () => {
            if (!active) {
                return DONE;
            }
            const result = await source.next();
            if (result.done) {
                return DONE;
            }
            const predicateResult = predicate(result.value, index++);
            const pass = isPromiseLike(predicateResult) ? await predicateResult : predicateResult;
            if (!pass) {
                active = false;
                return DONE;
            }
            return NEXT(result.value);
        },
    };
});

/**
 * Creates a stream operator that performs a side-effect for each value from the source
 * stream without modifying the value.
 *
 * This operator is primarily used for debugging, logging, or other non-intrusive
 * actions that need to be performed on each value as it passes through the pipeline.
 * It is completely transparent to the data stream itself, as it does not transform,
 * filter, or buffer the values. The provided `tapFunction` is executed for each
 * value before the value is emitted to the next operator.
 *
 * @template T The type of the values in the source and output streams.
 * @param tapFunction The function to perform the side-effect. It receives the value
 * from the stream and can be synchronous or asynchronous.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const tap = (tapFunction) => createOperator('tap', function (source) {
    return {
        next: async () => {
            const result = await source.next();
            if (result.done)
                return result;
            const tapResult = tapFunction(result.value);
            if (isPromiseLike(tapResult)) {
                await tapResult;
            }
            return result;
        }
    };
});

/**
 * Creates a throttle operator that emits the first value immediately, then ignores subsequent
 * values for the specified duration. If new values arrive during the cooldown, the
 * last one is emitted after the cooldown expires (trailing emit).
 *
 * Values suppressed during the cooldown window are forwarded with `dropped: true` so
 * that backpressure is released without surfacing them as real emissions. Only the
 * trailing value (if any) is emitted normally after the cooldown.
 *
 * @template T The type of values emitted by the source and output.
 * @param duration The throttle duration in milliseconds.
 * @returns An Operator instance that applies throttling to the source stream.
 */
const throttle = (duration) => createPushOperator('throttle', (source, output) => {
    let lastEmit = 0;
    let pendingResult;
    let timer = null;
    let resolvedDuration = undefined;
    // Track whether the operator has been torn down so that a flushPending()
    // callback queued before cleanup fires cannot write to an
    // already-completed/aborted output.
    let aborted = false;
    const flushPending = () => {
        // Guard against firing after cleanup.
        if (aborted) {
            timer = null;
            return;
        }
        if (pendingResult !== undefined) {
            output.push(pendingResult.value);
            pendingResult = undefined;
            // Use the scheduled expiry time rather than Date.now() to avoid clock
            // drift: if the JS event loop fires the callback late, the next window
            // would start from the wrong baseline and incorrectly gate values that
            // arrived after the intended boundary.
            lastEmit = lastEmit + resolvedDuration;
        }
        timer = null;
    };
    void (async () => {
        try {
            resolvedDuration = isPromiseLike(duration) ? await duration : duration;
            while (true) {
                const result = await source.next();
                if (result.done)
                    break;
                const now = Date.now();
                if (now - lastEmit >= resolvedDuration) {
                    // A new value arrived after the cooldown. If a timer is still
                    // running it means the scheduled trailing emit hasn't fired yet
                    // (the event loop hadn't yielded). Flush it as a real trailing
                    // emission first, then emit the new value as the next leading emit.
                    if (timer) {
                        clearTimeout(timer);
                        timer = null;
                        flushPending(); // emits pendingResult and advances lastEmit
                    }
                    output.push(result.value);
                    lastEmit = now;
                }
                else {
                    pendingResult = result;
                    if (!timer) {
                        const delay = resolvedDuration - (now - lastEmit);
                        timer = setTimeout(flushPending, delay);
                    }
                }
            }
            if (pendingResult !== undefined)
                flushPending();
        }
        catch (err) {
            // Normalise to Error, consistent with every other operator.
            output.error(err instanceof Error ? err : new Error(String(err)));
        }
        finally {
            aborted = true;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (!output.completed())
                output.complete();
        }
    })();
    return () => {
        aborted = true;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };
});

/**
 * Creates a stream operator that immediately throws an error with the provided message.
 *
 * This operator is a source operator that is used to create a stream that immediately
 * fails. When a consumer requests a value by calling `next()`, the operator
 * will throw an `Error` with the given `message`, without emitting any values.
 *
 * This is useful for testing error handling logic in a stream pipeline or for
 * explicitly modeling a failed asynchronous operation.
 *
 * @template T The type of the values in the stream (this is a formality, as no values are emitted).
 * @param message The error message to be thrown.
 * @returns An `Operator` instance that creates a stream which errors upon its first request.
 */
const throwError = (message) => createOperator('throwError', function (source) {
    return {
        next: async () => {
            const result = await source.next();
            if (result.done)
                return DONE;
            throw new Error(isPromiseLike(message) ? await message : message);
        }
    };
});

/**
 * Collects all emitted values from the source stream into an array
 * and emits that array once the source completes, tracking pending state.
 *
 * @template T The type of the values in the source stream.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
const toArray = () => createOperator("toArray", function (source) {
    const collected = [];
    let completed = false;
    let emitted = false;
    return {
        next: async function () {
            if (completed && emitted) {
                return DONE;
            }
            while (true) {
                const result = await source.next();
                if (result.done) {
                    completed = true;
                    if (!emitted) {
                        emitted = true;
                        return NEXT(collected);
                    }
                    return DONE;
                }
                collected.push(result.value);
                // continue consuming values
            }
        },
    };
});

/**
 * Combines the source stream with the latest values from one or more auxiliary streams or promises.
 *
 * When the source stream emits a value, this operator emits a tuple containing that source value
 * along with the most recent values from each auxiliary input.
 *
 * @typeParam T - The type of values emitted by the source stream.
 * @typeParam R - A readonly array/tuple representing the types emitted by the auxiliary streams.
 * @param args - One or more streams, promises, or an array of streams/promises whose latest values
 * will be combined with the source value.
 * @returns A push operator function that transforms the source stream into a stream of combined tuples.
 *
 * @example
 * ```ts
 * const clicks = fromEvent(document, 'click');
 * const mouseMoves = fromEvent(document, 'mousemove');
 *
 * clicks.pipe(withLatestFrom(mouseMoves)).subscribe({
 * next: ([clickEvent, lastMouseMove]) => {
 * console.log('Clicked at:', lastMouseMove.clientX, lastMouseMove.clientY);
 * }
 * });
 * ```
 */
function withLatestFrom(...args) {
    const normalizedInputs = (args.length === 1 && Array.isArray(args[0]))
        ? args[0]
        : args;
    return createPushOperator("withLatestFrom", (source, output) => {
        const abortController = new AbortController();
        let runner = null;
        let isSettled = false;
        const completeOutput = () => {
            if (!isSettled && !output.completed()) {
                isSettled = true;
                output.complete();
            }
        };
        const errorOutput = (err) => {
            if (!isSettled) {
                isSettled = true;
                output.error(normalizeError(err));
            }
        };
        void (async () => {
            try {
                if (abortController.signal.aborted)
                    return;
                const resolvedInputs = [];
                for (const input of normalizedInputs) {
                    resolvedInputs.push(isPromiseLike(input) ? await Promise.resolve(input) : input);
                }
                if (abortController.signal.aborted)
                    return;
                const auxIterators = resolvedInputs.map((input) => fromAny(input)[Symbol.asyncIterator]());
                const latestValues = new Array(auxIterators.length).fill(undefined);
                const hasValue = new Array(auxIterators.length).fill(false);
                const sourceIndex = auxIterators.length;
                runner = createAsyncCoordinator([
                    ...auxIterators,
                    source
                ]);
                while (!abortController.signal.aborted) {
                    const nextEvent = await runner.next();
                    if (nextEvent.done || abortController.signal.aborted)
                        break;
                    const event = nextEvent.value;
                    if (event.type === "error") {
                        errorOutput(event.error);
                        return;
                    }
                    if (event.sourceIndex === sourceIndex) {
                        if (event.type === "complete") {
                            completeOutput();
                            return;
                        }
                        if (hasValue.length > 0 && hasValue.every(Boolean)) {
                            output.push([event.value, ...latestValues]);
                        }
                        continue;
                    }
                    if (event.type === "value") {
                        latestValues[event.sourceIndex] = event.value;
                        hasValue[event.sourceIndex] = true;
                    }
                }
                completeOutput();
            }
            catch (err) {
                errorOutput(err);
            }
            finally {
                abortController.abort();
                void runner?.return?.();
            }
        })();
        return () => {
            abortController.abort();
            void runner?.return?.();
        };
    });
}

/**
 * Creates a simple asynchronous lock mechanism. Only one caller can hold the lock at a time.
 * Subsequent calls will queue up and wait for the lock to be released. This is useful
 * for synchronizing access to shared resources in an asynchronous environment.
 *
 * The function returns a promise that resolves with a `ReleaseFn`. The caller must
 * invoke this function to release the lock, allowing the next queued caller to proceed.
 *
 * @returns {SimpleLock} A function that, when called, returns a promise to acquire the lock.
 * Prefer scheduler-backed or stream-based coordination utilities for most use cases.
 */
const createLock = () => {
    let locked = false;
    const queue = [];
    return () => new Promise((resolve) => {
        const acquire = () => {
            if (!locked) {
                locked = true;
                resolve(() => {
                    locked = false;
                    if (queue.length > 0) {
                        const next = queue.shift();
                        next(acquire);
                    }
                });
            }
            else {
                queue.push(acquire);
            }
        };
        acquire();
    });
};

/**
 * Creates an asynchronous queue that processes operations sequentially.
 * Operations are guaranteed to run in the order they are enqueued, one after another.
 * This is useful for preventing race conditions and ensuring that dependent
 * asynchronous tasks are executed in a specific order.
 *
 * @returns {{ enqueue: (operation: () => Promise<any>) => Promise<any>, pending: number, isEmpty: boolean }} An object representing the queue.
 * @property {(operation: () => Promise<any>) => Promise<any>} enqueue Enqueues an asynchronous operation to be executed sequentially.
 * @property {number} pending The number of operations currently in the queue (including the one running).
 * @property {boolean} isEmpty A boolean indicating whether the queue is empty.
 */
function createQueue() {
    let last = Promise.resolve();
    let pendingCount = 0;
    const enqueue = (operation) => {
        pendingCount++;
        let result;
        try {
            // Create the chained promise that will execute the operation
            result = last.then(() => operation());
        }
        catch (err) {
            result = Promise.reject(normalizeError(err));
        }
        // Ensure pendingCount decrements even if the operation throws synchronously
        result = result.finally(() => {
            pendingCount--;
        });
        // Chain the next operation (with error handling to prevent queue lock)
        // This maintains the sequential order regardless of operation success/failure
        last = result.catch(() => { });
        return result;
    };
    return {
        enqueue,
        // Utility methods for debugging/monitoring
        get pending() { return pendingCount; },
        get isEmpty() { return pendingCount === 0; }
    };
}

/**
 * Creates a semaphore for controlling access to a limited number of resources.
 *
 * A semaphore is a synchronization primitive that allows you to manage
 * concurrent access to resources by maintaining a count of available "permits."
 *
 * @param {number} initialCount The initial number of permits available. Must be a non-negative integer.
 * @returns {Semaphore} A semaphore object with `acquire`, `tryAcquire`, and `release` methods.
 * Prefer scheduler-backed or stream-based coordination utilities for most use cases.
 */
const createSemaphore = (initialCount) => {
    let count = initialCount;
    const queue = [];
    const release = () => {
        if (queue.length > 0) {
            // Resume the next waiter in a microtask so its continuation does not run
            // inline inside the current releaser's call stack.
            const nextResolver = queue.shift();
            queueMicrotask(nextResolver);
        }
        else {
            count++;
        }
    };
    const acquire = () => new Promise((resolve) => {
        const resolverFn = () => resolve(() => release());
        if (count > 0) {
            count--;
            resolverFn();
        }
        else {
            queue.push(resolverFn);
        }
    });
    const tryAcquire = () => {
        if (count > 0) {
            count--;
            return () => release();
        }
        return null;
    };
    return { acquire, tryAcquire, release };
};

/*
 * Public API Surface of streamix
 */

/**
 * Generated bundle index. Do not edit.
 */

export { AsyncIteratorState, DONE, EMPTY, NEXT, asyncPull, audit, buffer, bufferCount, bufferUntil, bufferWhile, catchError, combineLatest, commit, concat, concatMap, createAsyncCoordinator, createAsyncIterator, createAsyncPushable, createBehaviorSubject, createLock, createOperator, createPushOperator, createQueue, createReceiver, createReplaySubject, createSemaphore, createStream, createSubject, createSubscription, debounce, defaultIfEmpty, defer, delay, delayUntil, delayWhile, distinctUntilChanged, distinctUntilKeyChanged, eachValueFrom, empty, endWith, exhaustMap, expand, filter, finalize, first, firstValueFrom, fork, forkJoin, from, fromAny, fromEvent, fromPromise, getIterator, groupBy, ignoreElements, iif, interval, isOperator, isPromiseLike, isStreamLike, last, lastValueFrom, loop, map, merge, mergeMap, normalizeError, observeOn, of, partition, pipeSourceThrough, pushComplete, pushError, pushValue, race, raceNext, range, reduce, retry, sample, scan, select, share, shareReplay, skip, skipUntil, skipWhile, slidingPair, startWith, streamToArray, switchMap, syncPull, take, takeUntil, takeWhile, tap, throttle, throwError, timer, toArray, withLatestFrom, zip };
//# sourceMappingURL=epikodelabs-streamix.mjs.map
