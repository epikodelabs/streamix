import { DONE, NEXT } from "../atoms/operator";

export type CyclicBufferMode = "discrete" | "analog";
export type CyclicBufferOverflow = "block" | "drop-oldest" | "drop-newest" | "error" | "replace-latest";

export interface CyclicBufferOptions {
  overflow?: CyclicBufferOverflow;
}

export interface CyclicBuffer<T> extends AsyncIterable<T> {
  /** Resolves on admission or drop. The error policy rejects on overflow. */
  push(value: T): Promise<void>;
  /** Attempts immediate admission. The error policy throws on overflow. */
  tryPush(value: T): boolean;
  /** Removes the next value synchronously, admitting a blocked producer if possible. */
  tryShift(): IteratorYieldResult<T> | undefined;
  /** Stops admission of new pushes and drains values and previously blocked producers. */
  complete(): void;
  /** Discards pending values and pushes. An error rejects waiting readers. */
  abort(error?: Error): void;
  /** Rejects waiting readers and discards blocked pushes, retaining admitted values. */
  close(): void;
  get length(): number;
}

type Reader<T> = {
  resolve(result: IteratorResult<T>): void;
  reject(error: Error): void;
};
type Producer<T> = {
  value: T;
  resolve(): void;
  next?: Producer<T>;
};

export function cyclicBuffer<T>(
  capacity: number,
  mode: CyclicBufferMode | CyclicBufferOptions = "discrete",
): CyclicBuffer<T> {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError("Buffer capacity must be a positive safe integer");
  }
  const overflow = typeof mode === "string" ? "block" : mode.overflow ?? "block";
  let values: (T | undefined)[] = [];
  let readIndex = 0;
  let writeIndex = 0;
  let size = 0;
  const readers = new Set<Reader<T>>();
  let producerHead: Producer<T> | undefined;
  let producerTail: Producer<T> | undefined;
  let state: "open" | "complete" | "closed" | "aborted" = "open";
  let failure: Error | undefined;

  function write(value: T): void {
    values[writeIndex] = value;
    writeIndex = (writeIndex + 1) % capacity;
    size++;
  }

  function read(): T {
    const value = values[readIndex]!;
    values[readIndex] = undefined;
    readIndex = (readIndex + 1) % capacity;
    size--;
    const producer = producerHead;
    if (producer) {
      producerHead = producer.next;
      if (!producerHead) producerTail = undefined;
      write(producer.value);
      producer.resolve();
    }
    return value;
  }

  function discardProducers(): void {
    let producer = producerHead;
    producerHead = producerTail = undefined;
    while (producer) {
      producer.resolve();
      producer = producer.next;
    }
  }

  function notify(): void {
    for (const reader of readers) {
      if (size) reader.resolve(NEXT(read()));
      else if (state !== "open") reader.resolve(DONE);
      else break;
    }
  }

  function tryPush(value: T): boolean {
    if (state !== "open") return false;
    if (size === capacity) {
      // The legacy analog mode replaces the oldest slot without moving it.
      if (mode === "analog") {
        values[readIndex] = value;
        return true;
      }
      switch (overflow) {
        case "block":
        case "drop-newest":
          return false;
        case "error":
          throw new Error("Buffer capacity exceeded");
        case "replace-latest":
          values[(writeIndex === 0 ? capacity : writeIndex) - 1] = value;
          return true;
        case "drop-oldest":
          read();
          break;
      }
    }
    write(value);
    notify();
    return true;
  }

  function tryShift(): IteratorYieldResult<T> | undefined {
    if (!size) return undefined;
    const result = NEXT(read());
    if (state === "complete") notify();
    return result;
  }

  return {
    async push(value) {
      if (tryPush(value) || state !== "open" || overflow !== "block") return;
      await new Promise<void>(resolve => {
        const producer: Producer<T> = { value, resolve };
        if (producerTail) producerTail.next = producer;
        else producerHead = producer;
        producerTail = producer;
      });
    },

    tryPush,
    tryShift,

    complete() {
      if (state !== "open") return;
      state = "complete";
      notify();
    },

    close() {
      if (state === "closed" || state === "aborted") return;
      state = "closed";
      discardProducers();
      const error = new Error("Buffer closed");
      for (const reader of readers) reader.reject(error);
    },

    abort(error) {
      if (state === "aborted") return;
      state = "aborted";
      failure = error;
      values = [];
      size = 0;
      discardProducers();
      for (const reader of readers) {
        if (error) reader.reject(error);
        else reader.resolve(DONE);
      }
    },

    get length() { return size; },

    [Symbol.asyncIterator](): AsyncIterator<T> {
      let returned = false;
      const pending = new Set<Reader<T>>();
      return {
        async next() {
          if (returned) return DONE;
          const result = tryShift();
          if (result) return result;
          if (failure) throw failure;
          if (state !== "open") return DONE;
          return new Promise<IteratorResult<T>>((resolve, reject) => {
            const reader: Reader<T> = {
              resolve: result => { pending.delete(reader); readers.delete(reader); resolve(result); },
              reject: error => { pending.delete(reader); readers.delete(reader); reject(error); },
            };
            pending.add(reader);
            readers.add(reader);
          });
        },
        async return() {
          returned = true;
          for (const reader of pending) reader.resolve(DONE);
          return DONE;
        },
      };
    },
  };
}
