// Assuming these imports are available from your project structure
import { isPromiseLike, type MaybePromise } from "../abstractions";
import { createLock, createSemaphore } from "../primitives";

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

// --- Notifier ---

export function createNotifier() {
  let waiters: Array<() => void> = [];
  
  return {
    wait: () => new Promise<void>(resolve => { waiters.push(resolve); }),
    signal: () => { 
      const resolve = waiters.shift();
      if (resolve) resolve();
    },
    signalAll: () => { 
      if (waiters.length === 0) return;
      const current = waiters;
      waiters = [];
      for (let i = 0; i < current.length; i++) current[i]();
    }
  };
}

// --- Linked List Node (Functional Style) ---

type BufferNode<T> = {
  value: T;
  next: BufferNode<T> | null;
  refCount: number;
  index: number; // Absolute index for tracking
};

/** Creates a new node in the linked list */
const createNode = <T>(value: T, index: number): BufferNode<T> => ({
  value,
  next: null,
  refCount: 0,
  index
});

/** Increments the reference count of a node */
const retainNode = <T>(node: BufferNode<T> | null): BufferNode<T> | null => {
  if (node) node.refCount++;
  return node;
};

/** Decrements the reference count and returns true if node can be collected */
const releaseNode = <T>(node: BufferNode<T> | null): boolean => {
  if (!node) return false;
  node.refCount--;
  return node.refCount === 0;
};

/** Walks the list from a node, releasing references until we hit a retained node */
const releaseChain = <T>(node: BufferNode<T> | null): BufferNode<T> | null => {
  let current = node;
  
  while (current && releaseNode(current)) {
    const next = current.next;
    // Help GC by clearing references
    current.next = null;
    current = next;
  }
  
  return current; // Return first node that's still retained (or null)
};

// --- Reader Cursor (Functional Style) ---

type ReaderCursor<T> = {
  node: BufferNode<T> | null;
  isActive: boolean;
};

const createCursor = <T>(node: BufferNode<T> | null): ReaderCursor<T> => ({
  node: retainNode(node),
  isActive: true
});

const advanceCursor = <T>(cursor: ReaderCursor<T>): BufferNode<T> | null => {
  const oldNode = cursor.node;
  cursor.node = oldNode?.next ? retainNode(oldNode.next) : null;
  releaseChain(oldNode);
  return cursor.node;
};

const destroyCursor = <T>(cursor: ReaderCursor<T>): void => {
  if (cursor.node) {
    releaseChain(cursor.node);
    cursor.node = null;
  }
  cursor.isActive = false;
};

// --- Subject Buffer (Cursor-Based) ---

export function createSubjectBuffer<T = any>(): CyclicBuffer<T> {
  type BufferItem = T | ErrorMarker;
  
  let head: BufferNode<BufferItem> | null = null;
  let tail: BufferNode<BufferItem> | null = null;
  let nextIndex = 0;
  
  const readers = new Map<number, ReaderCursor<BufferItem>>();
  const notifier = createNotifier();
  const lock = createLock();
  
  let nextReaderId = 0;
  let state: 0 | 1 | 2 = 0; // 0=active, 1=completed, 2=errored

  const write = async (value: T): Promise<void> => {
    const release = await lock();
    try {
      if (state !== 0) {
        throw new Error(state === 1 ? "Cannot write to completed buffer" : "Cannot write after error");
      }
      
      if (readers.size === 0) return;

      const node = createNode<BufferItem>(value, nextIndex++);
      
      if (!tail) {
        head = tail = node;
      } else {
        tail.next = node;
        tail = node;
      }
      
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const error = async (err: Error): Promise<void> => {
    const release = await lock();
    try {
      if (state === 1) throw new Error("Cannot write error to completed buffer");
      
      state = 2;
      
      if (readers.size > 0) {
        const node = createNode<BufferItem>(createErrorMarker(err), nextIndex++);
        
        if (!tail) {
          head = tail = node;
        } else {
          tail.next = node;
          tail = node;
        }
      }
      
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const attachReader = async (): Promise<number> => {
    const release = await lock();
    try {
      const id = nextReaderId++;
      // New readers start at the current tail (no replay)
      readers.set(id, createCursor(tail));
      return id;
    } finally {
      release();
    }
  };

  const detachReader = async (id: number): Promise<void> => {
    const release = await lock();
    try {
      const cursor = readers.get(id);
      if (cursor) {
        destroyCursor(cursor);
        readers.delete(id);
        
        // Check if head can be collected
        if (head && head.refCount === 0) {
          head = releaseChain(head);
          if (!head) tail = null;
        }
      }
    } finally {
      release();
    }
  };

  const read = async (id: number): Promise<IteratorResult<T, void>> => {
    while (true) {
      const release = await lock();
      
      let shouldWait = false;
      let result: IteratorResult<T, void> | undefined;
      
      try {
        const cursor = readers.get(id);
        if (!cursor || !cursor.isActive) {
          return { done: true, value: undefined };
        }

        // Check if there's a next node to read
        const nextNode = cursor.node?.next;
        
        if (nextNode) {
          advanceCursor(cursor);
          
          if (isErrorMarker(nextNode.value)) {
            throw nextNode.value[ERROR_SYMBOL];
          }
          
          result = { value: nextNode.value as T, done: false };
          
          // Auto-cleanup head if no longer referenced
          if (head && head.refCount === 0) {
            head = releaseChain(head);
            if (!head) tail = null;
          }
        } else if (state === 1) {
          result = { done: true, value: undefined };
        } else {
          shouldWait = true;
        }
      } finally {
        release();
      }
      
      if (result) return result;
      if (shouldWait) await notifier.wait();
    }
  };

  const peek = async (id: number): Promise<IteratorResult<T, void>> => {
    const release = await lock();
    try {
      const cursor = readers.get(id);
      if (!cursor || !cursor.isActive) {
        return { done: true, value: undefined };
      }

      const nextNode = cursor.node?.next;
      
      if (nextNode) {
        if (isErrorMarker(nextNode.value)) {
          throw nextNode.value[ERROR_SYMBOL];
        }
        return { value: nextNode.value as T, done: false };
      }

      return state === 1 ? { done: true, value: undefined } : { value: undefined as T, done: false };
    } finally {
      release();
    }
  };

  const complete = async (): Promise<void> => {
    const release = await lock();
    try {
      state = 1;
      notifier.signalAll();
    } finally {
      release();
    }
  };

  const completed = (id: number): boolean => {
    const cursor = readers.get(id);
    if (!cursor || !cursor.isActive) return true;
    
    const hasMoreData = cursor.node?.next !== null;
    return !hasMoreData && state !== 0;
  };

  return { write, error, read, peek, complete, attachReader, detachReader, completed };
}

// --- BehaviorSubject Buffer (Cursor-Based) ---

export function createBehaviorSubjectBuffer<T = any>(
  initialValue?: MaybePromise<T>
): SubjectBuffer<T> {
  const subject = createSubjectBuffer<T>();
  const hasInitial = arguments.length > 0;
  
  type BufferItem = T | ErrorMarker;
  
  let currentValue: BufferItem | undefined;
  let hasValue = false;
  let state: 0 | 1 | 2 = 0; // 0=active, 1=completed, 2=errored
  let initPromise: Promise<void> | null = null;
  
  const pendingReaders = new Set<number>();
  const lock = createLock();

  if (hasInitial && isPromiseLike(initialValue)) {
    initPromise = (initialValue as Promise<T>).then(
      (resolved) => {
        currentValue = resolved;
        hasValue = true;
      },
      (error) => {
        state = 2;
        currentValue = createErrorMarker(error as Error);
        hasValue = true;
      }
    ).finally(() => {
      initPromise = null;
    });
  } else if (hasInitial) {
    currentValue = initialValue as T;
    hasValue = true;
  }

  const ensureInit = async (): Promise<void> => {
    if (initPromise) await initPromise;
  };

  return {
    async write(value: T): Promise<void> {
      await ensureInit();
      const release = await lock();
      try {
        if (state === 1) throw new Error("Cannot write to completed buffer");
        if (state === 2) throw new Error("Cannot write after error");

        currentValue = value;
        hasValue = true;
        
        await subject.write(value);
      } finally {
        release();
      }
    },

    async error(err: Error): Promise<void> {
      await ensureInit();
      const release = await lock();
      try {
        if (state === 1) throw new Error("Cannot error a completed buffer");
        
        state = 2;
        const errorItem = createErrorMarker(err);
        currentValue = errorItem;
        hasValue = true;
        
        await subject.error(err);
      } finally {
        release();
      }
    },

    async attachReader(): Promise<number> {
      await ensureInit();
      const release = await lock();
      try {
        const id = await subject.attachReader();
        
        if (hasValue && state !== 1) {
          pendingReaders.add(id);
        }
        
        return id;
      } finally {
        release();
      }
    },

    async detachReader(id: number): Promise<void> {
      await ensureInit();
      const release = await lock();
      try {
        pendingReaders.delete(id);
        await subject.detachReader(id);
      } finally {
        release();
      }
    },

    async read(id: number): Promise<IteratorResult<T, void>> {
      await ensureInit();
      
      const release = await lock();
      let hasPending = false;
      let snapshot: BufferItem | undefined;
      
      try {
        if (pendingReaders.has(id)) {
          pendingReaders.delete(id);
          hasPending = true;
          snapshot = currentValue;
        }
      } finally {
        release();
      }
      
      if (hasPending && snapshot !== undefined) {
        if (isErrorMarker(snapshot)) {
          throw snapshot[ERROR_SYMBOL];
        }
        return { value: snapshot as T, done: false };
      }

      return await subject.read(id);
    },

    async peek(id: number): Promise<IteratorResult<T, void>> {
      await ensureInit();
      const release = await lock();
      
      try {
        if (pendingReaders.has(id) && currentValue !== undefined) {
          if (isErrorMarker(currentValue)) {
            throw currentValue[ERROR_SYMBOL];
          }
          return { value: currentValue as T, done: false };
        }
      } finally {
        release();
      }

      return await subject.peek(id);
    },

    async complete(): Promise<void> {
      await ensureInit();
      const release = await lock();
      try {
        state = 1;
        await subject.complete();
      } finally {
        release();
      }
    },

    completed(id: number): boolean {
      const awaitingInitial = pendingReaders.has(id) && currentValue !== undefined;
      if (awaitingInitial) return false;
      return subject.completed(id);
    },

    get value(): T | undefined {
      if (!hasValue || isErrorMarker(currentValue)) return undefined;
      return currentValue as T;
    }
  };
}

// --- Replay Buffer (Cursor-Based with Circular Tracking) ---

export function createReplayBuffer<T = any>(capacity: MaybePromise<number>): ReplayBuffer<T> {
  type BufferItem = T | ErrorMarker;
  
  let head: BufferNode<BufferItem> | null = null;
  let tail: BufferNode<BufferItem> | null = null;
  let bufferSize = 0;
  let nextIndex = 0;
  
  const readers = new Map<number, ReaderCursor<BufferItem>>();
  const notifier = createNotifier();
  const lock = createLock();
  
  let nextReaderId = 0;
  let state: 0 | 1 | 2 = 0;
  let semaphore: ReturnType<typeof createSemaphore> | undefined;
  
  let isInitialized = false;
  let initPromise: Promise<void> | null = null;
  let resolvedCapacity = 0;
  let isInfinite = false;

  const ensureCapacity = async (): Promise<void> => {
    if (isInitialized) return;
    if (initPromise) {
      await initPromise;
      return;
    }
    
    const initializer = (cap: number) => {
      resolvedCapacity = cap;
      isInfinite = !isFinite(cap);
      
      if (!isInfinite) {
        semaphore = createSemaphore(cap);
      }
      
      isInitialized = true;
    };

    if (isPromiseLike(capacity)) {
      initPromise = (async () => {
        initializer(await capacity);
        initPromise = null;
      })();
      await initPromise;
    } else {
      initializer(capacity as number);
    }
  };

  const pruneOldest = (): void => {
    if (!head || bufferSize <= resolvedCapacity) return;
    
    const nodeToRemove = head;
    head = head.next;
    
    if (releaseNode(nodeToRemove)) {
      nodeToRemove.next = null;
      bufferSize--;
      semaphore?.release();
    }
  };

  const write = async (value: T): Promise<void> => {
    await ensureCapacity();
    
    let needsBackpressure = false;
    
    const release = await lock();
    
    try {
      if (state !== 0) {
        throw new Error(state === 1 ? "Cannot write to completed buffer" : "Cannot write after error");
      }
      
      // Check if we need backpressure (bounded buffer at capacity with readers)
      if (!isInfinite && bufferSize >= resolvedCapacity && readers.size > 0) {
        needsBackpressure = true;
      } else {
        const node = createNode<BufferItem>(value, nextIndex++);
        
        if (!tail) {
          head = tail = node;
        } else {
          tail.next = node;
          tail = node;
        }
        
        bufferSize++;
        
        if (!isInfinite) {
          pruneOldest();
        }
        
        notifier.signalAll();
      }
    } finally {
      release();
    }
    
    if (needsBackpressure) {
      const semRelease = await semaphore!.acquire();
      const reacquire = await lock();
      
      try {
        if (state !== 0) {
          throw new Error(state === 1 ? "Cannot write to completed buffer" : "Cannot write after error");
        }
        
        const node = createNode<BufferItem>(value, nextIndex++);
        
        if (!tail) {
          head = tail = node;
        } else {
          tail.next = node;
          tail = node;
        }
        
        bufferSize++;
        pruneOldest();
        notifier.signalAll();
      } finally {
        reacquire();
        semRelease();
      }
    }
  };

  const error = async (err: Error): Promise<void> => {
    await ensureCapacity();
    const release = await lock();
    
    try {
      if (state === 1) throw new Error("Cannot write error to completed buffer");
      
      state = 2;
      
      const node = createNode<BufferItem>(createErrorMarker(err), nextIndex++);
      
      if (!tail) {
        head = tail = node;
      } else {
        tail.next = node;
        tail = node;
      }
      
      bufferSize++;
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
      // New readers start at head to replay all buffered items
      readers.set(id, createCursor(head));
      return id;
    } finally {
      release();
    }
  };

  const detachReader = async (id: number): Promise<void> => {
    const release = await lock();
    
    try {
      const cursor = readers.get(id);
      if (!cursor) return;
      
      // Release all nodes this reader was holding
      destroyCursor(cursor);
      readers.delete(id);
      
      // Clean up head if no longer referenced
      if (head && head.refCount === 0) {
        head = releaseChain(head);
        if (!head) {
          tail = null;
          bufferSize = 0;
        }
      }
    } finally {
      release();
    }
  };

  const read = async (id: number): Promise<IteratorResult<T, void>> => {
    await ensureCapacity();
    
    while (true) {
      const release = await lock();
      
      let shouldWait = false;
      let result: IteratorResult<T, void> | undefined;
      
      try {
        const cursor = readers.get(id);
        if (!cursor || !cursor.isActive) {
          return { value: undefined, done: true };
        }
        
        if (cursor.node) {
          const item = cursor.node.value;
          advanceCursor(cursor);
          
          // Cleanup head if possible
          if (head && head.refCount === 0) {
            head = releaseChain(head);
            if (!head) {
              tail = null;
              bufferSize = 0;
            }
          }
          
          if (isErrorMarker(item)) {
            throw item[ERROR_SYMBOL];
          }
          
          result = { value: item as T, done: false };
        } else if (state === 1) {
          result = { value: undefined, done: true };
        } else {
          shouldWait = true;
        }
      } finally {
        release();
      }
      
      if (result) return result;
      if (shouldWait) await notifier.wait();
    }
  };

  const peek = async (id: number): Promise<IteratorResult<T, void>> => {
    await ensureCapacity();
    const release = await lock();
    
    try {
      const cursor = readers.get(id);
      if (!cursor || !cursor.isActive) {
        return { value: undefined, done: true };
      }

      if (cursor.node) {
        const item = cursor.node.value;
        
        if (isErrorMarker(item)) {
          throw item[ERROR_SYMBOL];
        }
        
        return { value: item as T, done: false };
      }

      return { value: undefined, done: true };
    } finally {
      release();
    }
  };

  const complete = async (): Promise<void> => {
    await ensureCapacity();
    const release = await lock();
    
    try {
      state = 1;
      notifier.signalAll();
      
      if (semaphore) {
        for (let i = 0; i < resolvedCapacity; i++) {
          semaphore.release();
        }
      }
    } finally {
      release();
    }
  };

  const completed = (id: number): boolean => {
    const cursor = readers.get(id);
    if (!cursor || !cursor.isActive) return true;
    return state === 1 && cursor.node === null;
  };

  const getBuffer = (): T[] => {
    const result: T[] = [];
    let current = head;
    
    while (current) {
      if (!isErrorMarker(current.value)) {
        result.push(current.value as T);
      }
      current = current.next;
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