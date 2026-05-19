import { createAbortError } from "./context";

/**
 * Thrown when sending to or receiving from a closed channel.
 */
export class ChannelClosedError extends Error {
  constructor(message = "channel is closed") {
    super(message);
    this.name = "ChannelClosedError";
  }
}

/**
 * Result of a channel receive operation.
 * `ok: true` when a value was available, `ok: false` when the channel is closed and empty.
 */
export type ReceiveResult<T> =
  | { ok: true; value: T }
  | { ok: false; value: undefined };

type WaitingReceiver<T> = {
  resolve: (result: ReceiveResult<T>) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

type WaitingSender<T> = {
  value: T;
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

/**
 * An async channel for passing values between concurrent operations.
 *
 * - `capacity = 0` creates an unbuffered channel (send blocks until receive is ready).
 * - `capacity > 0` creates a buffered channel (send succeeds while buffer has space).
 *
 * Channels are async iterables; use `for await...of` to consume values until closed.
 */
export type Channel<T> = AsyncIterable<T> & {
  /** Maximum number of values that can be buffered. */
  readonly capacity: number;
  /** Current number of buffered values. */
  readonly size: number;
  /** Whether the channel has been closed. */
  readonly closed: boolean;
  /** Sends a value. Blocks if the channel is unbuffered and no receiver is waiting, or if the buffer is full. Rejects if the channel is closed. */
  send(value: T, signal?: AbortSignal): Promise<void>;
  /** Receives a value. Returns `{ ok: true, value }` or `{ ok: false }` when closed. Blocks if the channel is empty. */
  receive(signal?: AbortSignal): Promise<ReceiveResult<T>>;
  /** Convenience receiver that returns the value directly, or `undefined` when closed. */
  recv(signal?: AbortSignal): Promise<T | undefined>;
  /** Non-blocking send. Returns `true` if the value was accepted immediately. */
  trySend(value: T): boolean;
  /** Non-blocking receive. Returns the result immediately, or `undefined` if nothing is available. */
  tryReceive(): ReceiveResult<T> | undefined;
  /** Closes the channel. Pending receivers resolve with `{ ok: false }`; pending senders reject. */
  close(): void;
};

/**
 * Creates a new async channel with the given buffer capacity.
 *
 * @param capacity - Buffer size. `0` means unbuffered (hand-off semantics). Must be a non-negative integer.
 * @returns A new channel.
 */
export function channel<T>(capacity = 0): Channel<T> {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError("channel capacity must be a non-negative integer");
  }

  const buffer: T[] = [];
  const receivers: WaitingReceiver<T>[] = [];
  const senders: WaitingSender<T>[] = [];
  let isClosed = false;

  const cleanupReceiver = (receiver: WaitingReceiver<T>) => {
    if (receiver.signal && receiver.abort) {
      receiver.signal.removeEventListener("abort", receiver.abort);
    }
  };

  const cleanupSender = (sender: WaitingSender<T>) => {
    if (sender.signal && sender.abort) {
      sender.signal.removeEventListener("abort", sender.abort);
    }
  };

  const removeReceiver = (receiver: WaitingReceiver<T>) => {
    const index = receivers.indexOf(receiver);
    if (index >= 0) receivers.splice(index, 1);
    cleanupReceiver(receiver);
  };

  const removeSender = (sender: WaitingSender<T>) => {
    const index = senders.indexOf(sender);
    if (index >= 0) senders.splice(index, 1);
    cleanupSender(sender);
  };

  const flushSenders = () => {
    while (senders.length > 0) {
      if (receivers.length > 0) {
        const sender = senders.shift()!;
        const receiver = receivers.shift()!;
        cleanupSender(sender);
        cleanupReceiver(receiver);
        receiver.resolve({ ok: true, value: sender.value });
        sender.resolve();
        continue;
      }

      if (capacity > 0 && buffer.length < capacity) {
        const sender = senders.shift()!;
        cleanupSender(sender);
        buffer.push(sender.value);
        sender.resolve();
        continue;
      }

      break;
    }
  };

  const send = (value: T, signal?: AbortSignal): Promise<void> => {
    if (isClosed) return Promise.reject(new ChannelClosedError());
    if (signal?.aborted) return Promise.reject(createAbortError(signal));

    if (receivers.length > 0) {
      const receiver = receivers.shift()!;
      cleanupReceiver(receiver);
      receiver.resolve({ ok: true, value });
      return Promise.resolve();
    }

    if (capacity > 0 && buffer.length < capacity) {
      buffer.push(value);
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const sender: WaitingSender<T> = { value, resolve, reject, signal };
      if (signal) {
        sender.abort = () => {
          removeSender(sender);
          reject(createAbortError(signal));
        };
        signal.addEventListener("abort", sender.abort, { once: true });
      }
      senders.push(sender);
    });
  };

  const receive = (signal?: AbortSignal): Promise<ReceiveResult<T>> => {
    if (buffer.length > 0) {
      const value = buffer.shift()!;
      flushSenders();
      return Promise.resolve({ ok: true, value });
    }

    if (senders.length > 0) {
      const sender = senders.shift()!;
      cleanupSender(sender);
      sender.resolve();
      return Promise.resolve({ ok: true, value: sender.value });
    }

    if (isClosed) {
      return Promise.resolve({ ok: false, value: undefined });
    }

    if (signal?.aborted) return Promise.reject(createAbortError(signal));

    return new Promise<ReceiveResult<T>>((resolve, reject) => {
      const receiver: WaitingReceiver<T> = { resolve, reject, signal };
      if (signal) {
        receiver.abort = () => {
          removeReceiver(receiver);
          reject(createAbortError(signal));
        };
        signal.addEventListener("abort", receiver.abort, { once: true });
      }
      receivers.push(receiver);
    });
  };

  return {
    get capacity() {
      return capacity;
    },
    get size() {
      return buffer.length;
    },
    get closed() {
      return isClosed;
    },
    send,
    receive,
    async recv(signal?: AbortSignal) {
      const result = await receive(signal);
      return result.ok ? result.value : undefined;
    },
    trySend(value: T) {
      if (isClosed) return false;
      if (receivers.length > 0) {
        const receiver = receivers.shift()!;
        cleanupReceiver(receiver);
        receiver.resolve({ ok: true, value });
        return true;
      }
      if (capacity > 0 && buffer.length < capacity) {
        buffer.push(value);
        return true;
      }
      return false;
    },
    tryReceive() {
      if (buffer.length > 0) {
        const value = buffer.shift()!;
        flushSenders();
        return { ok: true, value };
      }
      if (senders.length > 0) {
        const sender = senders.shift()!;
        cleanupSender(sender);
        sender.resolve();
        return { ok: true, value: sender.value };
      }
      if (isClosed) return { ok: false, value: undefined };
      return undefined;
    },
    close() {
      if (isClosed) return;
      isClosed = true;

      while (receivers.length > 0) {
        const receiver = receivers.shift()!;
        cleanupReceiver(receiver);
        receiver.resolve({ ok: false, value: undefined });
      }

      while (senders.length > 0) {
        const sender = senders.shift()!;
        cleanupSender(sender);
        sender.reject(new ChannelClosedError());
      }
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const item = await receive();
        if (!item.ok) return;
        yield item.value;
      }
    },
  };
}
