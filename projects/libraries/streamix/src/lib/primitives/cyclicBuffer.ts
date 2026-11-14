export type CyclicBufferMode = "discrete" | "analog";

export interface CyclicBuffer<T> extends AsyncIterable<T> {
  /** Resolves when admitted, or without admission if the buffer closes. */
  push(value: T): Promise<void>;
  tryPush(value: T): boolean;
  /** Discards blocked pushes, rejects pending readers, and leaves buffered values available to drain. */
  close(): void;
  get length(): number;
}

export function cyclicBuffer<T>(capacity: number, mode: CyclicBufferMode = "discrete"): CyclicBuffer<T> {
  const buffer: (T | undefined)[] = new Array(capacity);
  let readIdx = 0;
  let writeIdx = 0;
  let size = 0;
  type Reader = { resolve: (v: IteratorResult<T>) => void; reject: (e: Error) => void };
  const waiters: Reader[] = [];
  const producers: Array<{ value: T; resolve: () => void }> = [];
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
    const producer = producers.shift();
    if (producer) {
      write(producer.value);
      producer.resolve();
    }
    return value;
  }

  function notify(): void {
    while (waiters.length > 0 && size > 0) {
      waiters.shift()!.resolve({ value: dequeue(), done: false });
    }
  }

  function tryPush(value: T): boolean {
    if (closed) return false;

    if (size < capacity) {
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

      if (size < capacity) {
        write(value);
        notify();
        return;
      }

      if (mode === "analog") {
        buffer[readIdx] = value;
        return;
      }

      // A blocked push resolves on admission, or when close discards it.
      await new Promise<void>((resolve) => producers.push({ value, resolve }));
    },

    tryPush,

    close(): void {
      closed = true;
      for (const producer of producers) producer.resolve();
      producers.length = 0;
      for (const w of waiters) w.reject(new Error("Buffer closed"));
      waiters.length = 0;
    },

    get length(): number {
      return size;
    },

    [Symbol.asyncIterator](): AsyncIterator<T> {
      let returned = false;
      const pending = new Set<Reader>();
      return {
        next: async (): Promise<IteratorResult<T>> => {
          if (returned) return { value: undefined as any, done: true };
          if (size > 0) {
            return { value: dequeue(), done: false };
          }
          if (closed) {
            return { value: undefined as any, done: true };
          }

          return new Promise<IteratorResult<T>>((resolve, reject) => {
            const reader: Reader = {
              resolve: (result) => { pending.delete(reader); resolve(result); },
              reject: (error) => { pending.delete(reader); reject(error); },
            };
            pending.add(reader);
            waiters.push(reader);
          });
        },
        return: async () => {
          returned = true;
          for (const reader of pending) {
            const index = waiters.indexOf(reader);
            if (index >= 0) waiters.splice(index, 1);
            reader.resolve({ value: undefined as any, done: true });
          }
          return { value: undefined as any, done: true };
        },
      };
    },
  };
}
