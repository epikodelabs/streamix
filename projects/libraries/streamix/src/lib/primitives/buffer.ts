import { isPromiseLike, type MaybePromise } from "../abstractions";
import { createLock } from "../primitives";

/** Unique Symbol used to identify an ErrorMarker object within the buffer. */
const ERROR_SYMBOL = Symbol('__ERROR_MARKER');
type ErrorMarker = { readonly [ERROR_SYMBOL]: Error };

const createErrorMarker = (err: Error): ErrorMarker => ({ [ERROR_SYMBOL]: err });
const isErrorMarker = (x: any): x is ErrorMarker => 
  x && typeof x === 'object' && ERROR_SYMBOL in x;

// --- Interfaces ---

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
  readonly value: T | undefined;
};

export type ReplayBuffer<T = any> = CyclicBuffer<T> & {
  readonly buffer: T[];
};

// --- Utilities ---

function createNotifier() {
  let waiters: Array<() => void> = [];
  return {
    wait: () => new Promise<void>(resolve => { waiters.push(resolve); }),
    signalAll: () => {
      const current = waiters;
      waiters = [];
      // Use microtask to prevent synchronous recursion/stack issues
      queueMicrotask(() => {
        for (const resolve of current) resolve();
      });
    }
  };
}

type BufferNode<T> = {
  value: T | null; 
  next: BufferNode<T> | null;
  refCount: number;
};

const createNode = <T>(value: T | null): BufferNode<T> => ({
  value,
  next: null,
  refCount: 0
});

// --- Subject Buffer Implementation ---

export function createSubjectBuffer<T = any>(): CyclicBuffer<T> {
  type Item = T | ErrorMarker;
  
  // Sentinel node pattern: head always points to the last node read or the current tail
  let tail = createNode<Item>(null);
  let head = tail;
  
  const readers = new Map<number, BufferNode<Item>>();
  const notifier = createNotifier();
  const lock = createLock();
  
  let nextReaderId = 0;
  let state: 0 | 1 | 2 = 0; // 0: active, 1: done, 2: error

  const tryCleanup = () => {
    while (head !== tail && head.refCount === 0) {
      const oldHead = head;
      head = head.next!;
      oldHead.next = null; // GC
    }
  };

  return {
    async write(value: T): Promise<void> {
      const release = await lock();
      try {
        if (state !== 0) throw new Error("Buffer closed");
        const node = createNode<Item>(value);
        tail.next = node;
        tail = node;
        notifier.signalAll();
      } finally {
        release();
      }
    },

    async error(err: Error): Promise<void> {
      const release = await lock();
      try {
        if (state !== 0) return;
        state = 2;
        const node = createNode<Item>(createErrorMarker(err));
        tail.next = node;
        tail = node;
        notifier.signalAll();
      } finally {
        release();
      }
    },

    async complete(): Promise<void> {
      const release = await lock();
      try {
        state = 1;
        notifier.signalAll();
      } finally {
        release();
      }
    },

    async attachReader(): Promise<number> {
      const release = await lock();
      try {
        const id = nextReaderId++;
        // Readers start at current tail (Subject behavior: no replay)
        tail.refCount++;
        readers.set(id, tail);
        return id;
      } finally {
        release();
      }
    },

    async detachReader(id: number): Promise<void> {
      const release = await lock();
      try {
        const node = readers.get(id);
        if (node) {
          node.refCount--;
          readers.delete(id);
          tryCleanup();
        }
        notifier.signalAll();
      } finally {
        release();
      }
    },

    async read(id: number): Promise<IteratorResult<T, void>> {
      while (true) {
        const release = await lock();
        try {
          const currentNode = readers.get(id);
          if (!currentNode) return { done: true, value: undefined };

          if (currentNode.next) {
            currentNode.refCount--;
            const nextNode = currentNode.next;
            nextNode.refCount++;
            readers.set(id, nextNode);
            tryCleanup();

            if (isErrorMarker(nextNode.value)) throw nextNode.value[ERROR_SYMBOL];
            return { done: false, value: nextNode.value as T };
          }

          if (state !== 0) return { done: true, value: undefined };
        } finally {
          release();
        }
        await notifier.wait();
      }
    },

    async peek(id: number): Promise<IteratorResult<T, void>> {
      const release = await lock();
      try {
        const currentNode = readers.get(id);
        if (!currentNode) return { done: true, value: undefined };
        if (currentNode.next) {
          const val = currentNode.next.value;
          if (isErrorMarker(val)) throw val[ERROR_SYMBOL];
          return { done: false, value: val as T };
        }
        return { done: state !== 0, value: undefined as any };
      } finally {
        release();
      }
    },

    completed: (id: number) => {
      const node = readers.get(id);
      return !node || (state !== 0 && !node.next);
    }
  };
}

// --- BehaviorSubject Buffer ---

export function createBehaviorSubjectBuffer<T = any>(
  initialValue?: MaybePromise<T>
): SubjectBuffer<T> {
  const inner = createSubjectBuffer<T>();
  let currentVal: T | ErrorMarker | undefined;
  let hasVal = arguments.length > 0;
  let initPromise: Promise<void> | null = null;
  let state: 0 | 1 | 2 = 0;
  const pendingInitial = new Set<number>();

  if (hasVal && isPromiseLike(initialValue)) {
    initPromise = (initialValue as Promise<T>).then(
      v => { currentVal = v; hasVal = true; },
      e => { currentVal = createErrorMarker(e); hasVal = true; state = 2; }
    ).finally(() => { initPromise = null; });
  } else if (hasVal) {
    currentVal = initialValue as T;
  }

  const ensure = async () => { if (initPromise) await initPromise; };

  return {
    ...inner,
    async write(v: T) { 
      await ensure(); 
      if (state !== 0) throw new Error("Cannot write to completed buffer");
      currentVal = v; 
      hasVal = true; 
      return inner.write(v); 
    },
    async error(e: Error) { 
      await ensure(); 
      if (state !== 0) throw new Error("Cannot error a completed buffer");
      state = 2;
      currentVal = createErrorMarker(e); 
      hasVal = true; 
      return inner.error(e); 
    },
    async complete() {
      await ensure();
      if (state !== 0) return;
      state = 1;
      return inner.complete();
    },
    async attachReader() {
      await ensure();
      const id = await inner.attachReader();
      if (hasVal && state !== 1) pendingInitial.add(id);
      return id;
    },
    async read(id: number) {
      await ensure();
      if (pendingInitial.has(id)) {
        pendingInitial.delete(id);
        if (isErrorMarker(currentVal)) throw currentVal[ERROR_SYMBOL];
        return { done: false, value: currentVal as T };
      }
      return inner.read(id);
    },
    async peek(id: number) {
      await ensure();
      if (pendingInitial.has(id)) {
        if (isErrorMarker(currentVal)) throw currentVal[ERROR_SYMBOL];
        return { done: false, value: currentVal as T };
      }
      return inner.peek(id);
    },
    completed(id: number) {
      if (pendingInitial.has(id)) return false;
      return inner.completed(id);
    },
    get value() {
      return (hasVal && !isErrorMarker(currentVal)) ? currentVal as T : undefined;
    }
  };
}

// --- Replay Buffer ---

export function createReplayBuffer<T = any>(capacity: MaybePromise<number>): ReplayBuffer<T> {
  type Item = T | ErrorMarker;
  let sentinel = createNode<Item>(null);
  let head = sentinel;
  let tail = sentinel;
  let size = 0;

  const readers = new Map<number, BufferNode<Item>>();
  const notifier = createNotifier();
  const lock = createLock();
  
  let cap = 0;
  let isInf = false;
  let initialized = false;
  let state = 0;
  let nextReaderId = 0;

  const init = async () => {
    if (initialized) return;
    const raw = isPromiseLike(capacity) ? await capacity : capacity as number;
    cap = raw;
    isInf = !isFinite(raw);
    initialized = true;
  };

  const prune = () => {
    // In ReplayBuffer, we only prune if we exceed capacity.
    // Unlike SubjectBuffer, we DON'T prune just because refCount is 0,
    // because future readers need to replay the history.
    while (!isInf && size > cap && head.next) {
      const oldHead = head;
      head = head.next;
      oldHead.next = null;
      size--;
    }
  };

  return {
    async write(value: T) {
      await init();
      const release = await lock();
      try {
        if (state !== 0) throw new Error("Closed");
        const node = createNode<Item>(value);
        tail.next = node;
        tail = node;
        size++;
        prune();
        notifier.signalAll();
      } finally {
        release();
      }
    },
    async error(err: Error) {
      await init();
      const release = await lock();
      try {
        state = 2;
        const node = createNode<Item>(createErrorMarker(err));
        tail.next = node;
        tail = node;
        notifier.signalAll();
      } finally {
        release();
      }
    },
    async complete() {
      await init();
      const release = await lock();
      state = 1;
      notifier.signalAll();
      release();
    },
    async attachReader() {
      await init();
      const release = await lock();
      const id = nextReaderId++;
      head.refCount++;
      readers.set(id, head);
      release();
      return id;
    },
    async detachReader(id: number) {
      const release = await lock();
      const node = readers.get(id);
      if (node) { node.refCount--; readers.delete(id); }
      notifier.signalAll();
      release();
    },
    async read(id: number): Promise<IteratorResult<T, void>> {
      await init();
      while (true) {
        const release = await lock();
        const node = readers.get(id);
        if (!node) { release(); return { done: true, value: undefined }; }
        
        if (node.next) {
          node.refCount--;
          const nextNode = node.next;
          nextNode.refCount++;
          readers.set(id, nextNode);
          release();
          if (isErrorMarker(nextNode.value)) throw nextNode.value[ERROR_SYMBOL];
          return { done: false, value: nextNode.value as T };
        }
        
        if (state !== 0) { release(); return { done: true, value: undefined }; }
        release();
        await notifier.wait();
      }
    },
    async peek(id: number) {
      await init();
      const release = await lock();
      const node = readers.get(id);
      try {
        if (!node || (state !== 0 && !node.next)) return { done: true, value: undefined };
        if (node.next) {
          if (isErrorMarker(node.next.value)) throw node.next.value[ERROR_SYMBOL];
          return { done: false, value: node.next.value as T };
        }
        return { done: false, value: undefined as any };
      } finally { release(); }
    },
    completed: (id) => {
      const node = readers.get(id);
      return !node || (state !== 0 && !node.next);
    },
    get buffer() {
      const items: T[] = [];
      let curr = head.next;
      while (curr) {
        if (!isErrorMarker(curr.value)) items.push(curr.value as T);
        curr = curr.next;
      }
      return items;
    }
  };
}
