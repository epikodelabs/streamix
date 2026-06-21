import { createSemaphore, type Semaphore } from "./semaphore";

export type CyclicBufferMode = "discrete" | "analog";

export interface CyclicBuffer<T> extends AsyncIterable<T> {
  push(value: T): Promise<void>;
  tryPush(value: T): boolean;
  close(): void;
  get length(): number;
}

export function cyclicBuffer<T>(capacity: number, mode: CyclicBufferMode = "discrete"): CyclicBuffer<T> {
  const semaphore: Semaphore = createSemaphore(capacity);
  const buffer: (T | undefined)[] = new Array(capacity);
  let readIdx = 0;
  let writeIdx = 0;
  let size = 0;
  const waiters: Array<{ resolve: (v: T) => void; reject: (e: Error) => void }> = [];
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
    semaphore.release();
    return value;
  }

  function notify(): void {
    while (waiters.length > 0 && size > 0) {
      waiters.shift()!.resolve(dequeue());
    }
  }

  function tryPush(value: T): boolean {
    if (closed) return false;

    const release = semaphore.tryAcquire();
    if (release) {
      write(value);
      notify();
      return true;
    }

    if (mode === "analog") {
      // Skip intermittent values: keep only the latest one.
      buffer[readIdx] = value;
      return true;
    }

    // Discrete mode: preserve every value, so drop the overflow.
    return false;
  }

  return {
    async push(value: T): Promise<void> {
      if (closed) return;

      let release = semaphore.tryAcquire();
      if (release) {
        write(value);
        notify();
        return;
      }

      if (mode === "analog") {
        buffer[readIdx] = value;
        return;
      }

      release = await semaphore.acquire();
      if (closed) {
        release();
        return;
      }

      write(value);
      notify();
    },

    tryPush,

    close(): void {
      closed = true;
      for (const w of waiters) w.reject(new Error("Buffer closed"));
      waiters.length = 0;
    },

    get length(): number {
      return size;
    },

    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: async (): Promise<IteratorResult<T>> => {
          if (size > 0) {
            return { value: dequeue(), done: false };
          }
          if (closed) {
            return { value: undefined as any, done: true };
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
