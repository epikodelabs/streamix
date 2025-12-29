import { type MaybePromise, isPromiseLike } from "../abstractions";

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

export interface CyclicBuffer<T = any> {
  write(value: T): Promise<void>;
  error(err: Error): Promise<void>;
  read(readerId: number): Promise<IteratorResult<T | undefined, void>>;
  peek(readerId: number): Promise<IteratorResult<T | undefined, void>>;
  complete(): Promise<void>;
  attachReader(): Promise<number>;
  detachReader(readerId: number): Promise<void>;
  completed(readerId: number): boolean;
}

export interface SubjectBuffer<T = any> extends CyclicBuffer<T> {
  readonly value: T | undefined;
}

export interface ReplayBuffer<T = any> extends CyclicBuffer<T> {
  readonly buffer: T[];
}

// --- Helper: Wait for condition ---

/**
 * Simple promise-based waiter that resolves when a condition is met.
 * Uses the global scheduler to check periodically.
 */
function createWaiter() {
  const waiters: Array<{ check: () => boolean; resolve: () => void }> = [];
  
  const checkWaiters = () => {
    const remaining = [];
    for (const waiter of waiters) {
      if (waiter.check()) {
        waiter.resolve();
      } else {
        remaining.push(waiter);
      }
    }
    waiters.length = 0;
    waiters.push(...remaining);
  };
  
  return {
    wait: (check: () => boolean): Promise<void> => {
      if (check()) return Promise.resolve();
      return new Promise<void>(resolve => {
        waiters.push({ check, resolve });
      });
    },
    notify: () => {
      queueMicrotask(checkWaiters);
    }
  };
}

// --- Create Subject Buffer ---

export function createSubjectBuffer<T = any>(): CyclicBuffer<T> {
  type BufferItem = T | ErrorMarker;
  
  const buffer: BufferItem[] = [];
  const readers = new Map<number, { nextIndex: number; isActive: boolean; hasSeenTerminalError: boolean }>();
  const waiter = createWaiter();
  
  let nextReaderId = 0;
  let isCompleted = false;
  let hasError = false;
  let terminalError: Error | null = null;
  let baseIndex = 0;

  const pruneBuffer = (): void => {
    if (readers.size === 0) {
      baseIndex += buffer.length;
      buffer.length = 0;
      return;
    }

    if (buffer.length === 0) return;

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

  const write = (value: T): Promise<void> => {
    if (isCompleted) return Promise.reject(new Error("Cannot write to completed buffer"));
    if (hasError) return Promise.reject(new Error("Cannot write after error"));

    if (readers.size > 0) {
      buffer.push(value);
      waiter.notify();
    }
    return Promise.resolve();
  };

  const error = (err: Error): Promise<void> => {
    if (isCompleted) return Promise.reject(new Error("Cannot write error to completed buffer"));
      
    hasError = true;
    terminalError = err;
    
    if (readers.size > 0) {
      buffer.push(createErrorMarker(err));
      waiter.notify();
    }
    return Promise.resolve();
  };

  const attachReader = (): Promise<number> => {
    const readerId = nextReaderId++;
    readers.set(readerId, {
      nextIndex: baseIndex + buffer.length,
      isActive: true,
      hasSeenTerminalError: false
    });
    return Promise.resolve(readerId);
  };

  const detachReader = (readerId: number): Promise<void> => {
    const reader = readers.get(readerId);
    if (reader) {
      reader.isActive = false;
      readers.delete(readerId);
      pruneBuffer();
      waiter.notify();
    }
    return Promise.resolve();
  };

  const read = async (readerId: number): Promise<IteratorResult<T | undefined, void>> => {
    while (true) {
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
          reader.hasSeenTerminalError = true;
          throw item[ERROR_SYMBOL];
        }
        
        return { value: item as T, done: false };
      }

      if (hasError && terminalError && !reader.hasSeenTerminalError) {
        reader.hasSeenTerminalError = true;
        throw terminalError;
      }

      if (isCompleted || hasError) {
        return { done: true, value: undefined };
      }

      // Wait for new data
      await waiter.wait(() => {
        const reader = readers.get(readerId);
        if (!reader || !reader.isActive) return true;
        const availableEnd = baseIndex + buffer.length;
        return reader.nextIndex < availableEnd || isCompleted || hasError;
      });
    }
  };

  const peek = (readerId: number): Promise<IteratorResult<T | undefined, void>> => {
    const reader = readers.get(readerId);
    if (!reader || !reader.isActive) {
      return Promise.resolve({ done: true, value: undefined });
    }

    const availableEnd = baseIndex + buffer.length;
    if (reader.nextIndex < availableEnd) {
      const relativeIndex = reader.nextIndex - baseIndex;
      const item = buffer[relativeIndex];
      
      if (isErrorMarker(item)) {
        return Promise.reject(item[ERROR_SYMBOL]);
      }
      
      return Promise.resolve({ value: item as T, done: false });
    }

    if (hasError && terminalError && !reader.hasSeenTerminalError) {
      return Promise.reject(terminalError);
    }

    if ((isCompleted || hasError) && reader.nextIndex >= availableEnd) {
      return Promise.resolve({ done: true, value: undefined });
    }

    return Promise.resolve({ value: undefined, done: false });
  };

  const complete = (): Promise<void> => {
    isCompleted = true;
    waiter.notify();
    return Promise.resolve();
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
    initPromise: null as Promise<void> | null
  };

  const behaviorReaders = new Map<number, {
    initialPending: boolean;
    initialValue?: BufferItem;
  }>();

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

  const write = async (value: T): Promise<void> => {
    await ensureInit();
    if (state.isCompleted) throw new Error("Cannot write to completed buffer");
    if (state.hasError) throw new Error("Cannot write after error");

    state.currentValue = value;
    state.hasCurrentValue = true;
    
    for (const readerState of behaviorReaders.values()) {
      if (readerState.initialPending) {
        readerState.initialValue = value;
      }
    }
    
    if (behaviorReaders.size > 0) {
      await subject.write(value);
    }
  };

  const error = async (err: Error): Promise<void> => {
    await ensureInit();
    if (state.isCompleted) throw new Error("Cannot error a completed buffer");
    
    state.hasError = true;
    state.isCompleted = true;

    const errorItem = createErrorMarker(err);
    state.currentValue = errorItem;
    state.hasCurrentValue = true;
    
    for (const readerState of behaviorReaders.values()) {
      if (readerState.initialPending) {
        readerState.initialValue = errorItem;
      }
    }
    
    await subject.error(err);
  };

  const attachReader = async (): Promise<number> => {
    await ensureInit();
    const readerId = await subject.attachReader();

    const snapshot = state.hasCurrentValue ? state.currentValue : undefined;
    const initialPending = state.hasCurrentValue && (!state.isCompleted || state.hasError);

    behaviorReaders.set(readerId, {
      initialPending,
      initialValue: snapshot
    });

    return readerId;
  };

  const detachReader = async (readerId: number): Promise<void> => {
    await ensureInit();
    behaviorReaders.delete(readerId);
    await subject.detachReader(readerId);
  };

  const read = async (readerId: number): Promise<IteratorResult<T | undefined, void>> => {
    await ensureInit();
    
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

    if (state.hasError && isErrorMarker(state.currentValue)) {
      throw state.currentValue[ERROR_SYMBOL];
    }

    return await subject.read(readerId);
  };

  const peek = async (readerId: number): Promise<IteratorResult<T | undefined, void>> => {
    await ensureInit();
    
    const readerState = behaviorReaders.get(readerId);
    if (readerState?.initialPending && readerState.initialValue !== undefined) {
      if (isErrorMarker(readerState.initialValue)) {
        throw readerState.initialValue[ERROR_SYMBOL];
      }
      return { value: readerState.initialValue as T, done: false };
    }

    if (state.hasError && isErrorMarker(state.currentValue)) {
      throw state.currentValue[ERROR_SYMBOL];
    }

    return await subject.peek(readerId);
  };

  const complete = async (): Promise<void> => {
    await ensureInit();
    state.isCompleted = true;
    await subject.complete();
  };

  const completed = (readerId: number): boolean => {
    const readerState = behaviorReaders.get(readerId);
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

export function createReplayBuffer<T = any>(capacity: MaybePromise<number>): ReplayBuffer<T> {
  type BufferItem = T | ErrorMarker;
  
  let resolvedCapacity: number = 0;
  let buffer: BufferItem[] = [];
  let isInfinite = false;
  let writeIndex = 0;
  let totalWritten = 0;
  
  const readers = new Map<number, { offset: number; hasSeenTerminalError: boolean }>();
  const waiter = createWaiter();
  
  let nextReaderId = 0;
  let isCompleted = false;
  let hasError = false;
  let terminalError: Error | null = null;
  
  let isInitialized = false;
  let initPromise: Promise<void> | null = null;

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
        const maxSafeCapacity = Math.min(capVal, 2 ** 32 - 1);
        buffer = new Array(maxSafeCapacity);
      } else {
        buffer = [];
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

  const getIndex = (abs: number): number => {
    if (isInfinite) return abs;
    if (resolvedCapacity === 0) return 0;
    return abs % resolvedCapacity;
  };

  const getOldestIndex = (): number => {
    if (isInfinite) return 0;
    if (resolvedCapacity === 0) return totalWritten;
    return Math.max(0, totalWritten - resolvedCapacity);
  };

  const write = async (value: T): Promise<void> => {
    await ensureCapacity();

    if (isCompleted) throw new Error("Cannot write to completed buffer");
    if (hasError) throw new Error("Cannot write after error");

    if (isInfinite) {
      buffer.push(value);
      totalWritten++;
      waiter.notify();
      return;
    }

    if (resolvedCapacity === 0) {
      waiter.notify();
      return;
    }

    const idx = getIndex(totalWritten);
    buffer[idx] = value;
    writeIndex = (writeIndex + 1) % resolvedCapacity;
    totalWritten++;
    
    waiter.notify();
  };

  const error = async (err: Error): Promise<void> => {
    await ensureCapacity();
    if (isCompleted) throw new Error("Cannot write error to completed buffer");
    
    hasError = true;
    terminalError = err;
    
    waiter.notify();
  };

  const attachReader = async (): Promise<number> => {
    await ensureCapacity();
    const id = nextReaderId++;
    const start = getOldestIndex();
    readers.set(id, { offset: start, hasSeenTerminalError: false });
    return id;
  };

  const detachReader = async (id: number): Promise<void> => {
    readers.delete(id);
    waiter.notify();
  };

  const read = async (id: number): Promise<IteratorResult<T | undefined, void>> => {
    await ensureCapacity();
    
    while (true) {
      const readerState = readers.get(id);
      if (!readerState) {
        return { value: undefined, done: true };
      }
      
      const offset = readerState.offset;
      
      if (offset < totalWritten) {
        const idx = getIndex(offset);
        const item = buffer[idx];
        readerState.offset++;

        if (isErrorMarker(item)) {
          readerState.hasSeenTerminalError = true;
          throw item[ERROR_SYMBOL];
        }
        
        return { value: item as T, done: false };
      }
      
      if (hasError && terminalError && !readerState.hasSeenTerminalError) {
        readerState.hasSeenTerminalError = true;
        throw terminalError;
      }

      if (isCompleted || hasError) {
        return { value: undefined, done: true };
      }

      await waiter.wait(() => {
        const readerState = readers.get(id);
        if (!readerState) return true;
        return readerState.offset < totalWritten || isCompleted || hasError;
      });
    }
  };

  const peek = async (id: number): Promise<IteratorResult<T | undefined, void>> => {
    await ensureCapacity();
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

    if (hasError && terminalError && !readerState.hasSeenTerminalError) {
      readerState.hasSeenTerminalError = true;
      throw terminalError;
    }

    return (isCompleted || hasError) ? 
      { done: true, value: undefined } : 
      { done: false, value: undefined };
  };

  const complete = async (): Promise<void> => {
    await ensureCapacity();
    isCompleted = true;
    waiter.notify();
  };

  const completed = (id: number): boolean => {
    const readerState = readers.get(id);
    if (!readerState) return true;
    
    if (readerState.offset < totalWritten) return false;
    if (hasError) return readerState.hasSeenTerminalError;
    return isCompleted;
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
