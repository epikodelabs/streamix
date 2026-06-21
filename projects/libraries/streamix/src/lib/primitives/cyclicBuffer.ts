import { createSemaphore, type Semaphore } from "./semaphore";

export type CyclicBufferMode = "discrete" | "analog";

export interface CyclicBuffer<T> extends AsyncIterable<T> {
  push(value: T): void;
  close(): void;
  get length(): number;
  [Symbol.iterator](): Iterator<Promise<T>>;
}

export function cyclicBuffer<T>(capacity: number, mode: CyclicBufferMode = "discrete"): CyclicBuffer<T> {
  const lock: Semaphore = createSemaphore(capacity);
  const buffer: (T | undefined)[] = new Array(capacity);
  let readIdx = 0;
  let writeIdx = 0;
  let size = 0;
  const waiters: Array<{ resolve: (v: T) => void; reject: (e: Error) => void }> = [];
  const writeQueue: T[] = [];
  let closed = false;

  function write(value: T): void {
    buffer[writeIdx] = value;
    writeIdx = (writeIdx + 1) % capacity;
    size++;
  }

  function dequeue(): T {
    const value = buffer[readIdx]!;
    buffer[readIdx] = undefined;
    readIdx = (readIdx + 1) % capacity;
    size--;
    if (writeQueue.length > 0) {
      write(writeQueue.shift()!);
    }
    return value;
  }

  function notify(): void {
    while (waiters.length > 0 && size > 0) {
      waiters.shift()!.resolve(dequeue());
    }
  }

  return {
    push(value: T): void {
      if (closed) return;
      if (size < capacity) {
        write(value);
        notify();
      } else if (mode === "analog") {
        // Skip intermittent values: keep only the latest one.
        buffer[readIdx] = value;
      } else {
        // Discrete mode: preserve every value in the overflow queue.
        writeQueue.push(value);
      }
    },

    close(): void {
      closed = true;
      for (const w of waiters) w.reject(new Error("Buffer closed"));
      waiters.length = 0;
      writeQueue.length = 0;
    },

    get length(): number {
      return size;
    },

    [Symbol.iterator](): Iterator<Promise<T>> {
      return {
        next(): IteratorResult<Promise<T>> {
          if (size > 0) {
            return { value: Promise.resolve(dequeue()), done: false };
          }
          if (closed) return { value: undefined!, done: true };
          const p = new Promise<T>((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
          return { value: p, done: false };
        },
        return() {
          return { value: undefined!, done: true };
        },
      };
    },

    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: async (): Promise<IteratorResult<T>> => {
          const release = await lock.acquire();
          try {
            if (size > 0) {
              return { value: dequeue(), done: false };
            }
            if (closed) {
              return { value: undefined as any, done: true };
            }
          } finally {
            release();
          }

          return new Promise<T>((resolve, reject) => {
            waiters.push({ resolve, reject });
          }).then((value) => ({ value, done: false }));
        },
        return: async () => ({ value: undefined as any, done: true }),
      };
    },
  };
}
