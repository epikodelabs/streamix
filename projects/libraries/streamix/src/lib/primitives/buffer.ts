// Assuming these imports are available from your project structure
import { isPromiseLike, MaybePromise } from "../abstractions";
import { createLock, createSemaphore, ReleaseFn } from "../primitives";

/** Unique Symbol used to identify an ErrorMarker object within the buffer. */
const ERROR_SYMBOL = Symbol('__ERROR_MARKER');

/** Represents an error value stored in the buffer. */
type ErrorMarker = { readonly [ERROR_SYMBOL]: Error };

/** Creates a sealed ErrorMarker object. */
const createErrorMarker = (err: Error): ErrorMarker => ({ [ERROR_SYMBOL]: err });

/** Type guard to check if an object is an ErrorMarker. */
const isErrorMarker = (x: any): x is ErrorMarker => 
  x && typeof x === 'object' && ERROR_SYMBOL in x;

// --- Interface Definitions ---

/**
 * Core interface for a buffer that supports concurrent reading and writing.
 * It models an asynchronous iterable stream.
 */
export type CyclicBuffer<T = any> = {
  /** Writes a value to the buffer, making it available for readers. */
  write(value: T): Promise<void>;
  /** Writes an error to the buffer, which will be thrown by readers. */
  error(err: Error): Promise<void>;
  /** Reads the next available item, waiting if the buffer is empty. */
  read(readerId: number): Promise<IteratorResult<T, void>>;
  /** Peeks at the next available item without consuming it. */
  peek(readerId: number): Promise<IteratorResult<T, void>>;
  /** Completes the buffer, signaling readers that no more items will arrive. */
  complete(): Promise<void>;
  /** Registers a new reader and returns its unique ID. */
  attachReader(): Promise<number>;
  /** Removes a reader and may trigger buffer pruning/memory cleanup. */
  detachReader(readerId: number): Promise<void>;
  /** Checks if the buffer has completed or errored for a specific reader. */
  completed(readerId: number): boolean;
};

/** Extends CyclicBuffer for "Subject" behavior, providing access to the current value. */
export type SubjectBuffer<T = any> = CyclicBuffer<T> & {
  /** Gets the latest non-error value written to the buffer, or undefined. */
  get value(): T | undefined;
};

/** Extends CyclicBuffer for "Replay" behavior, providing access to the history. */
export type ReplayBuffer<T = any> = CyclicBuffer<T> & {
  /** Gets an array containing all currently buffered values (the replay history). */
  get buffer(): T[];
};

// --- Notifier Implementation ---

/**
 * Simple condition variable implementation based on Promises.
 * Used to signal waiting readers when new data arrives or completion/error occurs.
 */
export function createNotifier() {
  let waitingResolvers: (() => void)[] = [];
  return {
    /** Returns a Promise that resolves when signal() or signalAll() is called. */
    wait: () => new Promise<void>(resolve => waitingResolvers.push(resolve)),
    /** Signals a single waiting reader. */
    signal: () => waitingResolvers.shift()?.(),
    /** Signals all waiting readers. */
    signalAll: () => { 
      const resolvers = waitingResolvers;
      waitingResolvers = [];
      resolvers.forEach(r => r());
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
  const pruneBuffer = () => {
    if (buffer.length === 0) return;

    // If no readers, reset state
    if (readers.size === 0) {
      baseIndex += buffer.length;
      buffer.length = 0;
      return;
    }

    // Find the oldest unread index across all active readers
    let minNext = Infinity;
    for (const reader of readers.values()) {
      if (!reader.isActive) continue;
      if (reader.nextIndex < minNext) {
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

  const write = async (item: T): Promise<void> => {
    const release = await lock();
    try {
      if (isCompleted) throw new Error("Cannot write to completed buffer");
      if (hasError) throw new Error("Cannot write after error");
      
      if (readers.size === 0) return;

      buffer.push(item);
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const writeError = async (err: Error): Promise<void> => {
    const release = await lock();
    try {
      if (isCompleted) throw new Error("Cannot write error to completed buffer");
      
      hasError = true;
      
      if (readers.size > 0) {
        buffer.push(createErrorMarker(err));
      }
      notifier.signalAll();
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
      }
    } finally {
      release();
    }
  };

  const read = async (readerId: number): Promise<IteratorResult<T, void>> => {
    while (true) {
      let release: ReleaseFn | undefined;
      let result: IteratorResult<T, void> | undefined;
      let shouldWait = false;
      
      release = await lock();
      
      try {
        const reader = readers.get(readerId);
        if (!reader || !reader.isActive) {
          result = { done: true, value: undefined };
          return result;
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
          
          result = { value: item as T, done: false };
        } else if (isCompleted) {
          result = { done: true, value: undefined };
        } else {
          shouldWait = true;
        }
      } finally {
        release();
      }
      
      if (result) return result;
      // Optimization: release lock before awaiting signal
      if (shouldWait) await notifier.wait();
    }
  };

  const peek = async (readerId: number): Promise<IteratorResult<T, void>> => {
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

      if (isCompleted && reader.nextIndex >= availableEnd) {
        return { done: true, value: undefined };
      }

      return { value: undefined as T, done: false };
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
    error: writeError,
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
  // Uses the fixed Subject buffer for handling subsequent writes
  const subject = createSubjectBuffer<T>();
  const hasInitial = arguments.length > 0;
  
  type BufferItem = T | ErrorMarker;
  
  const state = {
    currentValue: undefined as BufferItem | undefined,
    hasCurrentValue: false,
    isCompleted: false,
    hasError: false,
    initPromise: null as Promise<void> | null
  };

  type ReaderState = {
    // True if the reader still needs to read the initial snapshot value
    initialPending: boolean; 
    initialValue?: BufferItem;
  };

  const behaviorReaders = new Map<number, ReaderState>();
  const lock = createLock();

  // Handle async initialization
  if (hasInitial && isPromiseLike(initialValue)) {
    state.initPromise = initialValue.then(
      (resolved) => {
        state.currentValue = resolved as T;
        state.hasCurrentValue = true;
      },
      (error) => {
        state.hasError = true;
        state.isCompleted = true;
        state.currentValue = createErrorMarker(error as Error);
        state.hasCurrentValue = true;
      }
    ).finally(() => {
      state.initPromise = null;
    });
  } else if (hasInitial) {
    state.currentValue = initialValue as T;
    state.hasCurrentValue = true;
  }

  const ensureInit = async () => {
    if (state.initPromise) await state.initPromise;
  };

  return {
    async write(value: T): Promise<void> {
      await ensureInit();
      const release = await lock();
      try {
        if (state.isCompleted) throw new Error("Cannot write to completed buffer");
        if (state.hasError) throw new Error("Cannot write after error");

        state.currentValue = value;
        state.hasCurrentValue = true;
        
        // Update pending initial values to latest
        behaviorReaders.forEach(readerState => {
          if (readerState.initialPending) {
            readerState.initialValue = value;
          }
        });
        
        if (behaviorReaders.size > 0) {
          await subject.write(value);
        }
      } finally {
        release();
      }
    },

    async error(err: Error): Promise<void> {
      await ensureInit();
      const release = await lock();
      try {
        if (state.isCompleted) throw new Error("Cannot error a completed buffer");
        
        state.hasError = true;
        state.isCompleted = true;

        const errorItem = createErrorMarker(err);
        state.currentValue = errorItem;
        state.hasCurrentValue = true;
        
        behaviorReaders.forEach(readerState => {
          if (readerState.initialPending) {
            readerState.initialValue = errorItem;
          }
        });
        
        await subject.error(err);
      } finally {
        release();
      }
    },

    async attachReader(): Promise<number> {
      await ensureInit();
      const release = await lock();
      try {
        const readerId = await subject.attachReader();

        const snapshot = state.hasCurrentValue ? state.currentValue : undefined;
        // Reader needs the initial value if we have one AND the stream hasn't already errored/completed
        const initialPending = state.hasCurrentValue && (!state.isCompleted || state.hasError); 

        behaviorReaders.set(readerId, {
          initialPending,
          initialValue: snapshot
        });

        return readerId;
      } finally {
        release();
      }
    },

    async detachReader(readerId: number): Promise<void> {
      await ensureInit();
      const release = await lock();
      try {
        behaviorReaders.delete(readerId);
        await subject.detachReader(readerId);
      } finally {
        release();
      }
    },

    async read(readerId: number): Promise<IteratorResult<T, void>> {
      await ensureInit();
      const release = await lock();
      
      try {
        const readerState = behaviorReaders.get(readerId);
        if (readerState?.initialPending) {
          readerState.initialPending = false;

          if (readerState.initialValue !== undefined) {
            if (isErrorMarker(readerState.initialValue)) {
              throw readerState.initialValue[ERROR_SYMBOL];
            }
            return { value: readerState.initialValue as T, done: false };
          }
        }
      } finally {
        release();
      }

      // If no initial value needed, delegate to the underlying subject queue
      return await subject.read(readerId);
    },

    async peek(readerId: number): Promise<IteratorResult<T, void>> {
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
      } finally {
        release();
      }

      return await subject.peek(readerId);
    },

    async complete(): Promise<void> {
      await ensureInit();
      const release = await lock();
      try {
        state.isCompleted = true;
        await subject.complete();
      } finally {
        release();
      }
    },

    completed(readerId: number): boolean {
      const readerState = behaviorReaders.get(readerId);
      // A reader is NOT completed if it's still waiting to emit its initial value
      const awaitingInitial = readerState?.initialPending && readerState.initialValue !== undefined;

      if (awaitingInitial) return false;
      return subject.completed(readerId);
    },

    get value(): T | undefined {
      if (!state.hasCurrentValue) return undefined;
      if (isErrorMarker(state.currentValue)) return undefined;
      return state.currentValue as T;
    }
  };
}

// --- Create Replay Buffer ---

/**
 * Creates a Replay Buffer with a fixed capacity. It acts as a history stream:
 * 1. Buffers the last 'capacity' number of items (circular buffer).
 * 2. New readers start from the oldest available item within the capacity window (replaying).
 * 3. Supports backpressure via a Semaphore when the buffer is full.
 */
export function createReplayBuffer<T = any>(capacity: MaybePromise<number>): ReplayBuffer<T> {
  type BufferItem = T | ErrorMarker;
  
  // State variables
  let resolvedCapacity: number | null = null;
  let buffer: BufferItem[] = [];
  let isInfinite = false;
  let writeIndex = 0; // The index in the circular buffer for the next write
  let totalWritten = 0; // Absolute count of all items ever written
  
  const readers = new Map<number, { offset: number }>();
  // Counts how many readers still need to read an item at absolute index 'abs'
  const slotCounters = new Map<number, number>(); 
  const notifier = createNotifier();
  const lock = createLock();
  
  let nextReaderId = 0;
  let isCompleted = false;
  let hasError = false;
  let semaphore: ReturnType<typeof createSemaphore> | undefined; // Used for backpressure
  
  let isInitialized = false;
  let initPromise: Promise<void> | null = null;

  /** Ensures capacity and semaphore are set up, waiting if capacity is a promise. */
  const ensureCapacity = async (): Promise<void> => {
    if (isInitialized) return;
    if (initPromise) {
      await initPromise;
      return;
    }
    
    // Logic for synchronous and asynchronous capacity resolution...
    const initializer = async (capVal: number) => {
      resolvedCapacity = capVal;
      isInfinite = !isFinite(resolvedCapacity);
      buffer = isInfinite ? [] : new Array(resolvedCapacity);
      
      if (!isInfinite) {
        semaphore = createSemaphore(resolvedCapacity);
      }
      isInitialized = true;
    };

    if (isPromiseLike(capacity)) {
      initPromise = (async () => {
        await initializer(await capacity);
        initPromise = null;
      })();
      await initPromise;
    } else {
      await initializer(capacity as number);
    }
  };

  /** Converts an absolute index to the index within the circular buffer array. */
  const getIndex = (abs: number): number => {
    if (isInfinite) return abs;
    if (resolvedCapacity === null || resolvedCapacity === 0) return 0;
    return abs % resolvedCapacity;
  };

  /** Decrements slot counter for a consumed item and releases semaphore if needed. */
  const releaseSlot = (abs: number): void => {
    const cnt = slotCounters.get(abs);
    if (!cnt) return;
    
    if (cnt <= 1) {
      slotCounters.delete(abs);
      if (semaphore) {
        semaphore.release();
      }
    } else {
      slotCounters.set(abs, cnt - 1);
    }
  };

  /** Internal function to perform the actual buffer write under the lock. */
  const writeInternal = (item: BufferItem): void => {
    const abs = totalWritten;
    const idx = getIndex(abs);
    
    if (isInfinite) {
      buffer.push(item);
    } else {
      if (idx >= buffer.length) {
        buffer.length = idx + 1;
      }
      buffer[idx] = item;
      writeIndex = (writeIndex + 1) % (resolvedCapacity!);
    }
    
    totalWritten++;
    
    if (readers.size > 0) {
      slotCounters.set(abs, readers.size);
    }
    
    notifier.signalAll();
  };

  const write = async (value: T): Promise<void> => {
    await ensureCapacity();
    
    let needsBackpressureWait = false;
    let release: ReleaseFn | null = null;
    
    release = await lock();
    
    try {
      if (isCompleted) throw new Error("Cannot write to completed buffer");
      if (hasError) throw new Error("Cannot write after error");
      
      // Check for backpressure condition (bounded buffer, full, and active readers)
      if (!isInfinite && 
          resolvedCapacity !== null && 
          totalWritten >= resolvedCapacity && 
          readers.size > 0) {
        needsBackpressureWait = true;
      } else {
        writeInternal(value);
      }
    } finally {
      release?.();
    }
    
    if (needsBackpressureWait) {
      // 1. Wait on semaphore (this is where backpressure occurs)
      const semRelease = await semaphore!.acquire();
      
      // 2. Reacquire lock to safely check state and write
      const reacquire = await lock();
      try {
        if (isCompleted) {
           semRelease(); // Immediately release permit since we won't write
           throw new Error("Cannot write to completed buffer");
        }
        writeInternal(value);
      } finally {
        reacquire();
        // 3. Release semaphore permit after writing (handled by releaseSlot on read)
        semRelease();
      }
    }
  };

  const error = async (err: Error): Promise<void> => {
    await ensureCapacity();
    const release = await lock();
    
    try {
      if (isCompleted) throw new Error("Cannot write error to completed buffer");
      
      hasError = true;
      writeInternal(createErrorMarker(err));
    } finally {
      release();
    }
  };

  const attachReader = async (): Promise<number> => {
    await ensureCapacity();
    const release = await lock();
    
    try {
      const id = nextReaderId++;
      const cap = resolvedCapacity ?? Infinity;
      // Reader starts at the oldest item in the replay window
      const start = Math.max(0, totalWritten - (isInfinite ? totalWritten : cap));
      
      readers.set(id, { offset: start });
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
      
      // Release all unconsumed slots for the detached reader
      for (let i = offset; i < totalWritten; i++) {
        releaseSlot(i);
      }
      
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const read = async (id: number): Promise<IteratorResult<T, void>> => {
    await ensureCapacity();
    
    while (true) {
      let release: ReleaseFn | undefined;
      let result: IteratorResult<T, void> | undefined;
      let shouldWait = false;
      let slotToRelease: number | undefined;

      release = await lock();
      
      try {
        const readerState = readers.get(id);
        if (!readerState) {
          result = { value: undefined, done: true };
          return result;
        }
        
        const offset = readerState.offset;
        
        if (offset < totalWritten) {
          const item = buffer[getIndex(offset)];
          readerState.offset++;
          slotToRelease = offset; // Mark slot consumed

          if (isErrorMarker(item)) {
            throw item[ERROR_SYMBOL];
          }
          
          result = { value: item as T, done: false };
        } else if (isCompleted) {
          result = { value: undefined, done: true };
        } else {
          shouldWait = true;
        }
      } finally {
        release();
      }
      
      // Release slot count/semaphore outside of the main buffer lock
      if (slotToRelease !== undefined) {
        releaseSlot(slotToRelease); 
      }
      
      if (result) return result;
      // Optimization: release lock before awaiting signal
      if (shouldWait) await notifier.wait();
    }
  };

  const peek = async (id: number): Promise<IteratorResult<T, void>> => {
    await ensureCapacity();
    const release = await lock();
    
    try {
      const readerState = readers.get(id);
      if (!readerState) {
        return { value: undefined, done: true };
      }

      if (totalWritten === 0 || readerState.offset >= totalWritten) {
        return { value: undefined, done: true };
      }

      const item = buffer[getIndex(readerState.offset)];
      
      if (isErrorMarker(item)) {
        throw item[ERROR_SYMBOL];
      }

      return { value: item as T, done: false };
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
      if (semaphore && resolvedCapacity) {
        for (let i = 0; i < resolvedCapacity; i++) {
          semaphore.release();
        }
      }
    } finally {
      release();
    }
  };

  const completed = (id: number): boolean => {
    const readerState = readers.get(id);
    return !readerState || (isCompleted && readerState.offset >= totalWritten);
  };

  const getBuffer = (): T[] => {
    const result: T[] = [];
    const cap = resolvedCapacity ?? Infinity;
    // Calculate the absolute index of the start of the replay window
    const start = Math.max(0, totalWritten - (isInfinite ? totalWritten : cap));
    
    for (let i = start; i < totalWritten; i++) {
      const item = buffer[getIndex(i)];
      if (!isErrorMarker(item)) {
        result.push(item as T);
      }
    }
    
    return result;
  };

  return {
    write,
    error,
    read,
    peek,
    attachReader,
    detachReader,
    complete,
    completed,
    get buffer() { return getBuffer(); }
  };
}