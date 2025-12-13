import { isPromiseLike, MaybePromise } from "../abstractions";
import { createLock } from "./lock";
import { createSemaphore } from "./semaphore";

/**
 * A concurrent async buffer allowing multiple readers to consume values independently.
 * Each reader sees only new values written after attachment.
 * @template T The type of the values in the buffer.
 */
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

// Shared error marker type
type ErrorMarker = { readonly __error: Error };
const createErrorMarker = (err: Error): ErrorMarker => ({ __error: err });
const isErrorMarker = (x: any): x is ErrorMarker => 
  x && typeof x === 'object' && '__error' in x;

/**
 * Simple notifier for coordinating async operations
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
 * Creates a Subject buffer - emits values only to currently attached readers
 */
export function createSubjectBuffer<T = any>(): CyclicBuffer<T> {
  type BufferItem = T | ErrorMarker;
  
  const state = {
    isCompleted: false,
    hasError: false,
    buffer: [] as BufferItem[],
    nextReaderId: 0
  };

  const readers = new Map<number, { readIndex: number; isActive: boolean }>();
  const notifier = createNotifier();
  const lock = createLock();

  const write = async (item: T): Promise<void> => {
    const release = await lock();
    try {
      if (state.isCompleted) throw new Error("Cannot write to completed buffer");
      if (state.hasError) throw new Error("Cannot write after error");
      
      // No readers = no buffering needed for Subject
      if (readers.size === 0) return;

      state.buffer.push(item);
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const writeError = async (err: Error): Promise<void> => {
    const release = await lock();
    try {
      if (state.isCompleted) throw new Error("Cannot write error to completed buffer");
      
      state.hasError = true;
      
      // No readers = just mark error
      if (readers.size === 0) return;

      state.buffer.push(createErrorMarker(err));
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const attachReader = async (): Promise<number> => {
    const release = await lock();
    try {
      const readerId = state.nextReaderId++;
      // Start from current position (Subject semantics)
      readers.set(readerId, {
        readIndex: state.buffer.length,
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
      readers.delete(readerId);
    } finally {
      release();
    }
  };

  const read = async (readerId: number): Promise<IteratorResult<T, void>> => {
    while (true) {
      const release = await lock();
      
      try {
        const reader = readers.get(readerId);
        if (!reader?.isActive) {
          return { done: true, value: undefined };
        }

        // Check for available item
        if (reader.readIndex < state.buffer.length) {
          const item = state.buffer[reader.readIndex++];
          
          if (isErrorMarker(item)) {
            throw item.__error;
          }
          
          return { value: item as T, done: false };
        }
        
        // Check completion
        if (state.isCompleted && reader.readIndex >= state.buffer.length) {
          return { done: true, value: undefined };
        }
      } finally {
        release();
      }

      // Wait for next item
      await notifier.wait();
    }
  };

  const peek = async (readerId: number): Promise<IteratorResult<T, void>> => {
    const release = await lock();
    try {
      const reader = readers.get(readerId);
      if (!reader?.isActive) {
        return { done: true, value: undefined };
      }

      if (reader.readIndex < state.buffer.length) {
        const item = state.buffer[reader.readIndex];
        
        if (isErrorMarker(item)) {
          throw item.__error;
        }
        
        return { value: item as T, done: false };
      }

      if (state.isCompleted && reader.readIndex >= state.buffer.length) {
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
      state.isCompleted = true;
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const completed = (readerId: number): boolean => {
    const reader = readers.get(readerId);
    if (!reader?.isActive) return true;
    
    const allItemsRead = reader.readIndex >= state.buffer.length;
    return allItemsRead && (state.isCompleted || state.hasError);
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
 * Creates a BehaviorSubject buffer - holds current value and emits to new readers
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
    state.initPromise = initialValue.then((resolved) => {
      state.currentValue = resolved as T;
      state.hasCurrentValue = true;
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
        
        // Only write to subject if there are readers
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
      if (state.isCompleted || state.hasError) {
        return subject.completed(readerId);
      }
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
 * Creates a Replay buffer - stores history and replays to new readers
 */
export function createReplayBuffer<T = any>(capacity: MaybePromise<number>): ReplayBuffer<T> {
  type BufferItem = T | ErrorMarker;
  
  const state = {
    resolvedCapacity: isPromiseLike(capacity) ? null : (capacity as number),
    isInfinite: false,
    writeIndex: 0,
    totalWritten: 0,
    nextReaderId: 0,
    isCompleted: false,
    hasError: false
  };

  const buffer: BufferItem[] = [];
  const readers = new Map<number, { offset: number }>();
  const slotCounters = new Map<number, number>();
  const notifier = createNotifier();
  const lock = createLock();
  
  let semaphore: ReturnType<typeof createSemaphore> | undefined;

  // Initialize capacity-dependent state
  if (state.resolvedCapacity !== null) {
    state.isInfinite = !isFinite(state.resolvedCapacity);
    semaphore = state.isInfinite ? undefined : createSemaphore(state.resolvedCapacity);
  }

  const ensureCapacity = async () => {
    if (state.resolvedCapacity !== null) return;
    
    const resolved = isPromiseLike(capacity) ? await capacity : (capacity as number);
    state.resolvedCapacity = resolved;
    state.isInfinite = !isFinite(resolved);
    semaphore = state.isInfinite ? undefined : createSemaphore(resolved);
  };

  const getIndex = (abs: number) => 
    state.isInfinite ? abs : abs % (state.resolvedCapacity ?? Infinity);

  const releaseSlot = (abs: number) => {
    const cnt = slotCounters.get(abs);
    if (!cnt) return;
    
    if (cnt <= 1) {
      slotCounters.delete(abs);
      semaphore?.release();
    } else {
      slotCounters.set(abs, cnt - 1);
    }
  };

  const writeInternal = (item: BufferItem) => {
    const abs = state.totalWritten;
    buffer[getIndex(abs)] = item;
    
    if (!state.isInfinite && state.resolvedCapacity !== null) {
      state.writeIndex = (state.writeIndex + 1) % state.resolvedCapacity;
    }
    
    state.totalWritten++;
    
    if (readers.size > 0) {
      slotCounters.set(abs, readers.size);
    }
    
    notifier.signalAll();
  };

  const write = async (value: T): Promise<void> => {
    const release = await lock();
    try {
      await ensureCapacity();
      
      if (state.isCompleted) throw new Error("Cannot write to completed buffer");
      if (state.hasError) throw new Error("Cannot write after error");
      
      // Apply backpressure for bounded buffers with readers
      if (!state.isInfinite && 
          state.resolvedCapacity !== null && 
          state.totalWritten >= state.resolvedCapacity && 
          readers.size > 0) {
        await semaphore!.acquire();
      }
      
      writeInternal(value);
    } finally {
      release();
    }
  };

  const error = async (err: Error): Promise<void> => {
    const release = await lock();
    try {
      await ensureCapacity();
      
      if (state.isCompleted) throw new Error("Cannot write error to completed buffer");
      
      state.hasError = true;
      writeInternal(createErrorMarker(err));
    } finally {
      release();
    }
  };

  const attachReader = async (): Promise<number> => {
    const release = await lock();
    try {
      await ensureCapacity();
      
      const id = state.nextReaderId++;
      const cap = state.resolvedCapacity ?? state.totalWritten;
      const start = Math.max(0, state.totalWritten - (state.isInfinite ? state.totalWritten : cap));
      
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
      for (let i = offset; i < state.totalWritten; i++) {
        releaseSlot(i);
      }
      
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const read = async (id: number): Promise<IteratorResult<T, void>> => {
    while (true) {
      const release = await lock();
      
      const readerState = readers.get(id);
      if (!readerState) {
        release();
        return { value: undefined, done: true };
      }
      
      const offset = readerState.offset;
      
      if (offset < state.totalWritten) {
        const item = buffer[getIndex(offset)];
        readerState.offset++;
        release();
        
        if (isErrorMarker(item)) {
          throw item.__error;
        }
        
        releaseSlot(offset);
        return { value: item as T, done: false };
      }
      
      if (state.isCompleted) {
        release();
        return { value: undefined, done: true };
      }
      
      release();
      await notifier.wait();
    }
  };

  const peek = async (id: number): Promise<IteratorResult<T, void>> => {
    const release = await lock();
    try {
      await ensureCapacity();
      
      const readerState = readers.get(id);
      if (!readerState) {
        return { value: undefined, done: true };
      }

      if (state.totalWritten === 0 || readerState.offset >= state.totalWritten) {
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
    const release = await lock();
    try {
      await ensureCapacity();
      state.isCompleted = true;
      notifier.signalAll();
      semaphore?.release();
    } finally {
      release();
    }
  };

  const completed = (id: number): boolean => {
    const readerState = readers.get(id);
    return !readerState || (state.isCompleted && readerState.offset >= state.totalWritten);
  };

  const getBuffer = (): T[] => {
    const result: T[] = [];
    const cap = state.resolvedCapacity ?? Infinity;
    const start = Math.max(0, state.totalWritten - (state.isInfinite ? state.totalWritten : cap));
    
    for (let i = start; i < state.totalWritten; i++) {
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