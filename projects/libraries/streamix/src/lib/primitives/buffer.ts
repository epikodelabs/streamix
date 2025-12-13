import { isPromiseLike, MaybePromise } from "../abstractions";
import { createLock, ReleaseFn } from "./lock";
import { createSemaphore } from "./semaphore";

export type CyclicBuffer<T = any> = {
  write(value: T): Promise<void>;
  error(err: Error): Promise<void>;
  read(readerId: number): Promise<IteratorResult<T, void>>;
  peek(readerId: number): Promise<IteratorResult<T, void>>;
  complete(): Promise<void>;
  attachReader(): Promise<number>;
  detachReader(readerId: number): Promise<void>;
  completed(readerId: number): boolean;
};

export type SubjectBuffer<T = any> = CyclicBuffer<T> & {
  get value(): T | undefined;
};

export type ReplayBuffer<T = any> = CyclicBuffer<T> & {
  get buffer(): T[];
};

// Use original error marker format to maintain compatibility
type ErrorMarker = { readonly __error: Error };
const createErrorMarker = (err: Error): ErrorMarker => ({ __error: err });
const isErrorMarker = (x: any): x is ErrorMarker => 
  x && typeof x === 'object' && '__error' in x;

/**
 * Simple notifier (revert to original implementation)
 */
export function createNotifier() {
  let waitingResolvers: (() => void)[] = [];
  return {
    wait: () => new Promise<void>(resolve => waitingResolvers.push(resolve)),
    signal: () => waitingResolvers.shift()?.(),
    signalAll: () => { 
      const resolvers = waitingResolvers;
      waitingResolvers = [];
      resolvers.forEach(r => r());
    }
  };
}

/**
 * Create Subject Buffer - optimized but compatible
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

  const pruneBuffer = () => {
    if (buffer.length === 0) return;

    if (readers.size === 0) {
      baseIndex += buffer.length;
      buffer.length = 0;
      return;
    }

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
      
      // No readers = no buffering needed for Subject
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
      
      // No readers = just mark error
      if (readers.size === 0) return;

      buffer.push(createErrorMarker(err));
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const attachReader = async (): Promise<number> => {
    const release = await lock();
    try {
      const readerId = nextReaderId++;
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
          reader.nextIndex++;
          pruneBuffer();

          if (isErrorMarker(item)) {
            throw item.__error;
          }
          
          return { value: item as T, done: false };
        }
        
        if (isCompleted && reader.nextIndex >= availableEnd) {
          return { done: true, value: undefined };
        }
      } finally {
        release();
      }

      await notifier.wait();
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
          throw item.__error;
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

/**
 * Create BehaviorSubject Buffer - optimized but compatible
 */
export function createBehaviorSubjectBuffer<T = any>(
  initialValue?: MaybePromise<T>
): SubjectBuffer<T> {
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
              throw readerState.initialValue.__error;
            }
            return { value: readerState.initialValue as T, done: false };
          }
        }
      } finally {
        release();
      }

      return await subject.read(readerId);
    },

    async peek(readerId: number): Promise<IteratorResult<T, void>> {
      await ensureInit();
      const release = await lock();
      
      try {
        const readerState = behaviorReaders.get(readerId);
        if (readerState?.initialPending && readerState.initialValue !== undefined) {
          if (isErrorMarker(readerState.initialValue)) {
            throw readerState.initialValue.__error;
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

/**
 * Create Replay Buffer - fixed version that works with tests
 */
export function createReplayBuffer<T = any>(capacity: MaybePromise<number>): ReplayBuffer<T> {
  type BufferItem = T | ErrorMarker;
  
  // Initialize with default values
  let resolvedCapacity: number | null = null;
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
  let semaphore: ReturnType<typeof createSemaphore> | undefined;
  
  // Track initialization state
  let isInitialized = false;
  let initPromise: Promise<void> | null = null;

  const ensureCapacity = async (): Promise<void> => {
    if (isInitialized) return;
    
    if (initPromise) {
      await initPromise;
      return;
    }
    
    if (!isPromiseLike(capacity)) {
      // Synchronous initialization
      resolvedCapacity = capacity as number;
      isInfinite = !isFinite(resolvedCapacity);
      buffer = isInfinite ? [] : new Array(resolvedCapacity);
      
      if (!isInfinite) {
        semaphore = createSemaphore(resolvedCapacity);
      }
      
      isInitialized = true;
      return;
    }
    
    // Asynchronous initialization
    initPromise = (async () => {
      const resolved = await capacity;
      resolvedCapacity = resolved;
      isInfinite = !isFinite(resolvedCapacity);
      buffer = isInfinite ? [] : new Array(resolvedCapacity);
      
      if (!isInfinite) {
        semaphore = createSemaphore(resolvedCapacity);
      }
      
      isInitialized = true;
      initPromise = null;
    })();
    
    await initPromise;
  };

  const getIndex = (abs: number): number => {
    if (isInfinite) return abs;
    if (resolvedCapacity === null || resolvedCapacity === 0) return 0;
    return abs % resolvedCapacity;
  };

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

  const writeInternal = (item: BufferItem): void => {
    const abs = totalWritten;
    const idx = getIndex(abs);
    
    // Ensure buffer has capacity
    if (isInfinite) {
      buffer.push(item);
    } else {
      // For fixed capacity, ensure array is properly sized
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
    let release: ReleaseFn | null = null;
    release = await lock();
    
    try {
      if (isCompleted) throw new Error("Cannot write to completed buffer");
      if (hasError) throw new Error("Cannot write after error");
      
      // For bounded buffers with active readers, apply backpressure
      if (!isInfinite && 
          resolvedCapacity !== null && 
          totalWritten >= resolvedCapacity && 
          readers.size > 0) {
        release();
        release = null;

        const semRelease = await semaphore!.acquire();
        const reacquire = await lock();
        try {
          writeInternal(value);
        } finally {
          reacquire();
          semRelease();
        }
        return;
      }
      
      writeInternal(value);
    } finally {
      release?.();
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
      
      // Release all unconsumed slots
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
      const release = await lock();
      
      const readerState = readers.get(id);
      if (!readerState) {
        release();
        return { value: undefined, done: true };
      }
      
      const offset = readerState.offset;
      
      if (offset < totalWritten) {
        const item = buffer[getIndex(offset)];
        readerState.offset++;
        release();
        
        if (isErrorMarker(item)) {
          throw item.__error;
        }
        
        releaseSlot(offset);
        return { value: item as T, done: false };
      }
      
      if (isCompleted) {
        release();
        return { value: undefined, done: true };
      }
      
      release();
      await notifier.wait();
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
        throw item.__error;
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
      
      // Release all semaphore permits to unblock any waiting writes
      if (semaphore) {
        const cap = resolvedCapacity!;
        // Release all permits (capacity times)
        for (let i = 0; i < cap; i++) {
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
