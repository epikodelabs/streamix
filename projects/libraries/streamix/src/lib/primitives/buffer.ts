import { isPromiseLike, type MaybePromise } from "../abstractions";
import { createLock, createSemaphore } from "../primitives";

/** Unique Symbol used to identify an ErrorMarker object within the buffer. */
const ERROR_SYMBOL = Symbol('__ERROR_MARKER');

/** Represents an error value stored in the buffer. */
type ErrorMarker = { readonly [ERROR_SYMBOL]: Error };

/** Creates a sealed ErrorMarker object. */
const createErrorMarker = (err: Error): ErrorMarker => Object.freeze({ [ERROR_SYMBOL]: err });

/** Type guard to check if an object is an ErrorMarker. */
const isErrorMarker = (x: unknown): x is ErrorMarker => 
  !!x && typeof x === 'object' && ERROR_SYMBOL in x;

// --- Interface Definitions ---

/**
 * Core interface for a buffer that supports concurrent reading and writing.
 * It models an asynchronous iterable stream.
 */
export interface CyclicBuffer<T = any> {
  /** Writes a value to the buffer, making it available for readers. */
  write(value: T): Promise<void>;
  /** Writes an error to the buffer, which will be thrown by readers. */
  error(err: Error): Promise<void>;
  /** Reads the next available item, waiting if the buffer is empty. */
  read(readerId: number): Promise<IteratorResult<T | undefined, void>>;
  /** Peeks at the next available item without consuming it. */
  peek(readerId: number): Promise<IteratorResult<T | undefined, void>>;
  /** Completes the buffer, signaling readers that no more items will arrive. */
  complete(): Promise<void>;
  /** Registers a new reader and returns its unique ID. */
  attachReader(): Promise<number>;
  /** Removes a reader and may trigger buffer pruning/memory cleanup. */
  detachReader(readerId: number): Promise<void>;
  /** Checks if the buffer has completed or errored for a specific reader. */
  completed(readerId: number): boolean;
}

/** Extends CyclicBuffer for "Subject" behavior, providing access to the current value. */
export interface SubjectBuffer<T = any> extends CyclicBuffer<T> {
  /** Gets the latest non-error value written to the buffer, or undefined. */
  readonly value: T | undefined;
}

/** Extends CyclicBuffer for "Replay" behavior, providing access to the history. */
export interface ReplayBuffer<T = any> extends CyclicBuffer<T> {
  /** Gets an array containing all currently buffered values (the replay history). */
  readonly buffer: T[];
}

// --- Notifier Implementation ---

/**
 * Simple condition variable implementation based on Promises.
 * Used to signal waiting readers when new data arrives or completion/error occurs.
 */
export function createNotifier() {
  let waitingResolvers: (() => void)[] = [];
  let epoch = 0;
  
  return {
    /** Returns the current notification epoch. */
    getEpoch: () => epoch,
    /** Returns a Promise that resolves when signal() or signalAll() is called. */
    wait: (seen?: number) => {
      if (seen !== undefined && epoch !== seen) {
        return Promise.resolve();
      }
      return new Promise<void>(resolve => {
        waitingResolvers.push(resolve);
      });
    },
    /** Signals a single waiting reader. */
    signal: () => {
      epoch++;
      const resolver = waitingResolvers.shift();
      if (resolver) {
        // Schedule resolution to prevent recursion issues
        Promise.resolve().then(resolver);
      }
    },
    /** Signals all waiting readers. */
    signalAll: () => { 
      epoch++;
      const resolvers = waitingResolvers;
      waitingResolvers = [];
      if (resolvers.length > 0) {
        // Schedule resolution to prevent recursion issues
        Promise.resolve().then(() => {
          resolvers.forEach(r => r());
        });
      }
    }
  };
}

// --- Create Subject Buffer ---

/**
 * Creates a Subject Buffer. It acts as a queuing stream:
 * 1. Values are buffered only if active readers are present.
 * 2. New readers DO NOT receive past values (non-replaying).
 * 3. Multiple writes are delivered to readers in order (queued).
 */
export function createSubjectBuffer<T = any>(): CyclicBuffer<T> {
  type BufferItem = T | ErrorMarker;
  
  const buffer: BufferItem[] = [];
  const readers = new Map<number, { nextIndex: number; isActive: boolean }>();
  const notifier = createNotifier();
  const lock = createLock();
  
  let nextReaderId = 0;
  let isCompleted = false;
  let hasError = false;
  let baseIndex = 0;

  /** Removes consumed items from the buffer to reclaim memory. */
  const pruneBuffer = (): void => {
    if (readers.size === 0) {
      // No readers, clear entire buffer
      baseIndex += buffer.length;
      buffer.length = 0;
      return;
    }

    if (buffer.length === 0) return;

    // Find the oldest unread index across all active readers
    let minNext = Infinity;
    for (const reader of readers.values()) {
      if (reader.isActive && reader.nextIndex < minNext) {
        minNext = reader.nextIndex;
      }
    }

    if (minNext === Infinity) return;

    const drop = minNext - baseIndex;
    if (drop > 0) {
      buffer.splice(0, drop);
      baseIndex += drop;
    }
  };

  const write = async (value: T): Promise<void> => {
    const release = await lock();
    try {
      if (isCompleted) {
        throw new Error("Cannot write to completed buffer");
      }
      if (hasError) {
        throw new Error("Cannot write after error");
      }

      // Only buffer if we have active readers
      if (readers.size > 0) {
        buffer.push(value);
        notifier.signalAll();
      }
    } finally {
      release();
    }
  };

  const error = async (err: Error): Promise<void> => {
    const release = await lock();
    try {
      if (isCompleted) {
        throw new Error("Cannot write error to completed buffer");
      }
      
      hasError = true;
      
      if (readers.size > 0) {
        buffer.push(createErrorMarker(err));
        notifier.signalAll();
      }
    } finally {
      release();
    }
  };

  const attachReader = async (): Promise<number> => {
    const release = await lock();
    try {
      const readerId = nextReaderId++;
      // Reader starts reading from the current end (no replay)
      readers.set(readerId, {
        nextIndex: baseIndex + buffer.length,
        isActive: true
      });
      return readerId;
    } finally {
      release();
    }
  };

  const detachReader = async (readerId: number): Promise<void> => {
    const release = await lock();
    try {
      const reader = readers.get(readerId);
      if (reader) {
        reader.isActive = false;
        readers.delete(readerId);
        pruneBuffer();
        notifier.signalAll();
      }
    } finally {
      release();
    }
  };

  const read = async (readerId: number): Promise<IteratorResult<T | undefined, void>> => {
    while (true) {
      const release = await lock();
      const seen = notifier.getEpoch();
      try {
        const reader = readers.get(readerId);
        if (!reader || !reader.isActive) {
          return { done: true, value: undefined };
        }

        const availableEnd = baseIndex + buffer.length;
        if (reader.nextIndex < availableEnd) {
          const relativeIndex = reader.nextIndex - baseIndex;
          const item = buffer[relativeIndex];
          reader.nextIndex++;
          pruneBuffer();

          if (isErrorMarker(item)) {
            throw item[ERROR_SYMBOL];
          }
          
          return { value: item as T, done: false };
        }

        if (isCompleted || hasError) {
          return { done: true, value: undefined };
        }
      } finally {
        release();
      }

      // Wait for notification outside the lock
      await notifier.wait(seen);
    }
  };

  const peek = async (readerId: number): Promise<IteratorResult<T | undefined, void>> => {
    const release = await lock();
    try {
      const reader = readers.get(readerId);
      if (!reader || !reader.isActive) {
        return { done: true, value: undefined };
      }

      const availableEnd = baseIndex + buffer.length;
      if (reader.nextIndex < availableEnd) {
        const relativeIndex = reader.nextIndex - baseIndex;
        const item = buffer[relativeIndex];
        
        if (isErrorMarker(item)) {
          throw item[ERROR_SYMBOL];
        }
        
        return { value: item as T, done: false };
      }

      if ((isCompleted || hasError) && reader.nextIndex >= availableEnd) {
        return { done: true, value: undefined };
      }

      return { value: undefined, done: false };
    } finally {
      release();
    }
  };

  const complete = async (): Promise<void> => {
    const release = await lock();
    try {
      isCompleted = true;
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const completed = (readerId: number): boolean => {
    const reader = readers.get(readerId);
    if (!reader || !reader.isActive) return true;
    
    const allItemsRead = reader.nextIndex >= baseIndex + buffer.length;
    return allItemsRead && (isCompleted || hasError);
  };

  return {
    write,
    error,
    read,
    peek,
    complete,
    attachReader,
    detachReader,
    completed
  };
}

// --- Create BehaviorSubject Buffer ---

/**
 * Creates a BehaviorSubject Buffer. It extends the Subject Buffer by:
 * 1. Storing the single latest value (or error).
 * 2. Delivering the latest value to new readers upon attachment (replaying 1 item).
 * 3. Exposing the current value via the `.value` getter.
 */
export function createBehaviorSubjectBuffer<T = any>(
  initialValue?: MaybePromise<T>
): SubjectBuffer<T> {
  const subject = createSubjectBuffer<T>();
  
  type BufferItem = T | ErrorMarker;
  
  const state = {
    currentValue: undefined as BufferItem | undefined,
    hasCurrentValue: false,
    isCompleted: false,
    hasError: false,
    lastError: null as Error | null,
    initPromise: null as Promise<void> | null
  };

  const behaviorReaders = new Map<number, {
    initialPending: boolean;
    initialValue?: BufferItem;
  }>();

  const lock = createLock();

  // Handle async initialization
  if (arguments.length > 0) {
    if (isPromiseLike(initialValue)) {
      state.initPromise = (async () => {
        try {
          state.currentValue = await initialValue;
          state.hasCurrentValue = true;
        } catch (error) {
          state.hasError = true;
          state.isCompleted = true;
          state.currentValue = createErrorMarker(error as Error);
          state.hasCurrentValue = true;
        } finally {
          state.initPromise = null;
        }
      })();
    } else {
      state.currentValue = initialValue as T;
      state.hasCurrentValue = true;
    }
  }

  const ensureInit = async (): Promise<void> => {
    if (state.initPromise) await state.initPromise;
  };

  const throwIfErrored = (): void => {
    if (!state.hasError) return;
    if (isErrorMarker(state.currentValue)) {
      throw state.currentValue[ERROR_SYMBOL];
    }
    if (state.lastError) {
      throw state.lastError;
    }
  };

  const write = async (value: T): Promise<void> => {
    await ensureInit();
    const release = await lock();
    try {
      if (state.isCompleted) {
        throw new Error("Cannot write to completed buffer");
      }
      if (state.hasError) {
        throw new Error("Cannot write after error");
      }

      state.currentValue = value;
      state.hasCurrentValue = true;
      
      // Update pending initial values to latest
      for (const readerState of behaviorReaders.values()) {
        if (readerState.initialPending) {
          readerState.initialValue = value;
        }
      }
      
      if (behaviorReaders.size > 0) {
        await subject.write(value);
      }
    } finally {
      release();
    }
  };

  const error = async (err: Error): Promise<void> => {
    await ensureInit();
    const release = await lock();
    try {
      if (state.isCompleted) {
        throw new Error("Cannot error a completed buffer");
      }
      
      state.hasError = true;
      state.isCompleted = true;

      const errorItem = createErrorMarker(err);
      state.currentValue = errorItem;
      state.hasCurrentValue = true;
      state.lastError = err;
      
      for (const readerState of behaviorReaders.values()) {
        if (readerState.initialPending) {
          readerState.initialValue = errorItem;
        }
      }
      
      await subject.error(err);
    } finally {
      release();
    }
  };

  const attachReader = async (): Promise<number> => {
    await ensureInit();
    const release = await lock();
    try {
      const readerId = await subject.attachReader();

      const snapshot = state.hasCurrentValue ? state.currentValue : undefined;
      // Reader needs the initial value if we have one AND it's still valid to emit
      const initialPending = state.hasCurrentValue && (!state.isCompleted || state.hasError);

      behaviorReaders.set(readerId, {
        initialPending,
        initialValue: snapshot
      });

      return readerId;
    } finally {
      release();
    }
  };

  const detachReader = async (readerId: number): Promise<void> => {
    await ensureInit();
    const release = await lock();
    try {
      behaviorReaders.delete(readerId);
      await subject.detachReader(readerId);
    } finally {
      release();
    }
  };

  const read = async (readerId: number): Promise<IteratorResult<T | undefined, void>> => {
    await ensureInit();
    
    const release = await lock();
    let readerState: { initialPending: boolean; initialValue?: BufferItem } | undefined;
    try {
      readerState = behaviorReaders.get(readerId);
      if (readerState?.initialPending) {
        readerState.initialPending = false;

        if (readerState.initialValue !== undefined) {
          if (isErrorMarker(readerState.initialValue)) {
            throw readerState.initialValue[ERROR_SYMBOL];
          }
          return { value: readerState.initialValue as T, done: false };
        }
      }

      throwIfErrored();
    } finally {
      release();
    }
    
    // If no initial value needed, delegate to the underlying subject queue
    return await subject.read(readerId);
  };

  const peek = async (readerId: number): Promise<IteratorResult<T | undefined, void>> => {
    await ensureInit();
    
    const release = await lock();
    try {
      const readerState = behaviorReaders.get(readerId);
      if (readerState?.initialPending && readerState.initialValue !== undefined) {
        if (isErrorMarker(readerState.initialValue)) {
          throw readerState.initialValue[ERROR_SYMBOL];
        }
        return { value: readerState.initialValue as T, done: false };
      }

      throwIfErrored();
    } finally {
      release();
    }

    return await subject.peek(readerId);
  };

  const complete = async (): Promise<void> => {
    await ensureInit();
    const release = await lock();
    try {
      state.isCompleted = true;
      await subject.complete();
    } finally {
      release();
    }
  };

  const completed = (readerId: number): boolean => {
    const readerState = behaviorReaders.get(readerId);
    // A reader is NOT completed if it's still waiting to emit its initial value
    const awaitingInitial = readerState?.initialPending && readerState.initialValue !== undefined;

    if (awaitingInitial) return false;
    return subject.completed(readerId);
  };

  const getValue = (): T | undefined => {
    if (!state.hasCurrentValue) return undefined;
    if (isErrorMarker(state.currentValue)) return undefined;
    return state.currentValue as T;
  };

  return Object.freeze({
    write,
    error,
    attachReader,
    detachReader,
    read,
    peek,
    complete,
    completed,
    get value() { return getValue(); }
  });
}

// --- Create Replay Buffer ---

/**
 * Creates a Replay Buffer with a fixed capacity. It acts as a history stream:
 * 1. Buffers the last 'capacity' number of items (circular buffer).
 * 2. New readers start from the oldest available item within the capacity window (replaying).
 * 3. Supports backpressure via a Semaphore when the buffer is full.
 *
 * Backpressure applies for finite buffers regardless of readers; writes block
 * once the buffer reaches capacity until slots are released.
 */
export function createReplayBuffer<T = any>(capacity: MaybePromise<number>): ReplayBuffer<T> {
  type BufferItem = T | ErrorMarker;
  
  // State variables
  let resolvedCapacity: number = 0;
  let buffer: BufferItem[] = [];
  let isInfinite = false;
  let writeIndex = 0;
  let totalWritten = 0;
  
  const readers = new Map<number, { offset: number }>();
  const slotCounters = new Map<number, number>();
  const notifier = createNotifier();
  const lock = createLock();
  
  let nextReaderId = 0;
  let isCompleted = false;
  let hasError = false;
  let semaphore: ReturnType<typeof createSemaphore> | null = null;
  
  let isInitialized = false;
  let initPromise: Promise<void> | null = null;

  /** Ensures capacity and semaphore are set up, waiting if capacity is a promise. */
  const ensureCapacity = async (): Promise<void> => {
    if (isInitialized) return;
    if (initPromise) return initPromise;
    
    const initializer = async (capVal: number): Promise<void> => {
      if (capVal < 0) {
        throw new Error("Capacity must be non-negative");
      }
      
      resolvedCapacity = capVal;
      isInfinite = capVal === Infinity || capVal === 0;
      
      if (isInfinite) {
        buffer = [];
      } else if (capVal > 0) {
        // Safe array creation with reasonable limit
        const maxSafeCapacity = Math.min(capVal, 2 ** 32 - 1);
        buffer = new Array(maxSafeCapacity);
      } else {
        // capacity = 0 (non-infinite)
        buffer = [];
      }
      
      if (!isInfinite && resolvedCapacity > 0) {
        semaphore = createSemaphore(resolvedCapacity);
      }
      isInitialized = true;
    };

    if (isPromiseLike(capacity)) {
      initPromise = initializer(await capacity);
      await initPromise;
      initPromise = null;
    } else {
      await initializer(capacity as number);
    }
  };

  /** Converts an absolute index to the index within the circular buffer array. */
  const getIndex = (abs: number): number => {
    if (isInfinite) return abs;
    if (resolvedCapacity === 0) return 0;
    return abs % resolvedCapacity;
  };

  /** Gets the absolute index of the oldest item still in the buffer */
  const getOldestIndex = (): number => {
    if (isInfinite) return 0;
    if (resolvedCapacity === 0) return totalWritten;
    return Math.max(0, totalWritten - resolvedCapacity);
  };

  /** Decrements slot counter for a consumed item and releases semaphore if needed. */
  const releaseSlot = (abs: number): void => {
    const cnt = slotCounters.get(abs);
    if (cnt === undefined) return;
    
    if (cnt <= 1) {
      slotCounters.delete(abs);
      if (semaphore && abs >= getOldestIndex()) {
        semaphore.release();
      }
    } else {
      slotCounters.set(abs, cnt - 1);
    }
  };

  const write = async (value: T): Promise<void> => {
    await ensureCapacity();

    if (isInfinite) {
      const release = await lock();
      try {
        if (isCompleted) {
          throw new Error("Cannot write to completed buffer");
        }
        if (hasError) {
          throw new Error("Cannot write after error");
        }

        const abs = totalWritten;
        buffer.push(value);
        totalWritten++;
        
        if (readers.size > 0) {
          slotCounters.set(abs, readers.size);
        }
        
        notifier.signalAll();
      } finally {
        release();
      }
      return;
    }

    // Finite capacity
    if (resolvedCapacity === 0) {
      const release = await lock();
      try {
        if (isCompleted) {
          throw new Error("Cannot write to completed buffer");
        }
        if (hasError) {
          throw new Error("Cannot write after error");
        }
        // capacity = 0 means no buffering, but we need to notify any readers
        notifier.signalAll();
      } finally {
        release();
      }
      return;
    }

    // Finite capacity with backpressure (always enforced)
    if (semaphore) {
      await semaphore.acquire();
    }

    const release = await lock();
    try {
      if (isCompleted) {
        if (semaphore) {
          semaphore.release();
        }
        throw new Error("Cannot write to completed buffer");
      }
      if (hasError) {
        if (semaphore) {
          semaphore.release();
        }
        throw new Error("Cannot write after error");
      }

      const abs = totalWritten;
      
      // For finite buffer, overwrite oldest if needed
      if (totalWritten >= resolvedCapacity) {
        const oldestIdx = getOldestIndex();
        if (slotCounters.has(oldestIdx)) {
          // This shouldn't happen if semaphore is working correctly
          console.warn('Overwriting slot with active readers');
        }
        slotCounters.delete(oldestIdx);
      }
      
      const idx = getIndex(abs);
      buffer[idx] = value;
      writeIndex = (writeIndex + 1) % resolvedCapacity;
      totalWritten++;
      
      if (readers.size > 0) {
        slotCounters.set(abs, readers.size);
        // Keep semaphore acquired; released when slots are fully consumed.
      }
      
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const error = async (err: Error): Promise<void> => {
    await ensureCapacity();
    const release = await lock();
    try {
      if (isCompleted) {
        throw new Error("Cannot write error to completed buffer");
      }
      
      hasError = true;
      const errorItem = createErrorMarker(err);
      
      if (isInfinite) {
        buffer.push(errorItem);
        totalWritten++;
        if (readers.size > 0) {
          slotCounters.set(totalWritten - 1, readers.size);
        }
      } else if (resolvedCapacity > 0) {
        const abs = totalWritten;
        const idx = getIndex(abs);
        buffer[idx] = errorItem;
        writeIndex = (writeIndex + 1) % resolvedCapacity;
        totalWritten++;
        if (readers.size > 0) {
          slotCounters.set(abs, readers.size);
        }
      }
      // For capacity = 0, no buffering needed
      
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const attachReader = async (): Promise<number> => {
    await ensureCapacity();
    const release = await lock();
    try {
      const id = nextReaderId++;
      const start = getOldestIndex();
      
      readers.set(id, { offset: start });

      if (resolvedCapacity === 0) {
        // capacity = 0 means no buffering, just track reader
        return id;
      }

      // Initialize slot counters for existing items.
      for (let i = start; i < totalWritten; i++) {
        const cnt = slotCounters.get(i) || 0;
        slotCounters.set(i, cnt + 1);
      }
      
      return id;
    } finally {
      release();
    }
  };

  const detachReader = async (id: number): Promise<void> => {
    const release = await lock();
    try {
      const readerState = readers.get(id);
      if (!readerState) return;
      
      const { offset } = readerState;
      readers.delete(id);
      
      if (resolvedCapacity === 0) return;
      
      // Release all unconsumed slots for the detached reader
      for (let i = offset; i < totalWritten; i++) {
        releaseSlot(i);
      }
      
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const read = async (id: number): Promise<IteratorResult<T | undefined, void>> => {
    await ensureCapacity();
    
    while (true) {
      const release = await lock();
      const seen = notifier.getEpoch();
      let slotToRelease: number | undefined;
      let result: IteratorResult<T | undefined, void> | undefined;
      let pendingError: Error | undefined;
      
      try {
        const readerState = readers.get(id);
        if (!readerState) {
          return { value: undefined, done: true };
        }
        
        const offset = readerState.offset;
        
        if (offset < totalWritten) {
          const idx = getIndex(offset);
          const item = buffer[idx];
          readerState.offset++;
          slotToRelease = offset;

          if (isErrorMarker(item)) {
            pendingError = item[ERROR_SYMBOL];
          } else {
            result = { value: item as T, done: false };
          }
        } else if (isCompleted || hasError) {
          result = { value: undefined, done: true };
        }
      } finally {
        release();
      }

      if (slotToRelease !== undefined) {
        releaseSlot(slotToRelease);
      }
      
      if (pendingError) throw pendingError;
      if (result) return result;

      await notifier.wait(seen);
    }
  };

  const peek = async (id: number): Promise<IteratorResult<T | undefined, void>> => {
    await ensureCapacity();
    const release = await lock();
    try {
      const readerState = readers.get(id);
      if (!readerState) {
        return { value: undefined, done: true };
      }

      if (readerState.offset < totalWritten) {
        const idx = getIndex(readerState.offset);
        const item = buffer[idx];
        if (isErrorMarker(item)) {
          throw item[ERROR_SYMBOL];
        }
        return { value: item as T, done: false };
      }

      return (isCompleted || hasError) ? 
        { done: true, value: undefined } : 
        { done: false, value: undefined };
    } finally {
      release();
    }
  };

  const complete = async (): Promise<void> => {
    await ensureCapacity();
    const release = await lock();
    try {
      isCompleted = true;
      notifier.signalAll();
      
      // Release all semaphore permits to unblock any waiting writers
      if (semaphore && resolvedCapacity > 0) {
        // We need to release all permits (capacity - available)
        // Note: This depends on the semaphore implementation
        // If the semaphore doesn't expose available count, we'll handle it differently
        try {
          // Try to access available count (implementation dependent)
          const semaphoreAny = semaphore as any;
          if (typeof semaphoreAny.available === 'number') {
            const heldPermits = resolvedCapacity - semaphoreAny.available;
            for (let i = 0; i < heldPermits; i++) {
              semaphore.release();
            }
          } else {
            // Fallback: release all capacity permits
            for (let i = 0; i < resolvedCapacity; i++) {
              semaphore.release();
            }
          }
        } catch (e) {
          // If we can't determine, release all capacity permits
          for (let i = 0; i < resolvedCapacity; i++) {
            semaphore.release();
          }
        }
      }
    } finally {
      release();
    }
  };

  const completed = (id: number): boolean => {
    const readerState = readers.get(id);
    if (!readerState) return true;
    
    return (isCompleted || hasError) && readerState.offset >= totalWritten;
  };

  const getBuffer = (): T[] => {
    const result: T[] = [];
    const start = getOldestIndex();
    
    for (let i = start; i < totalWritten; i++) {
      const idx = getIndex(i);
      const item = buffer[idx];
      if (!isErrorMarker(item)) {
        result.push(item as T);
      }
    }
    
    return result;
  };

  return Object.freeze({
    write,
    error,
    read,
    peek,
    attachReader,
    detachReader,
    complete,
    completed,
    get buffer() { return getBuffer(); }
  });
}
