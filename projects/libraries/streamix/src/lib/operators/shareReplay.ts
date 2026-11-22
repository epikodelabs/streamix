import { createOperator, DONE, NEXT, type Operator } from "../atoms";
import { normalizeError } from "../atoms";
import { COMPLETED_REPLAY } from '../atoms/replay';

/**
 * Creates a stream operator that shares a single subscription to the source stream
 * and replays a specified number of past values to new subscribers.
 *
 * This operator multicasts the source stream, ensuring that multiple downstream
 * consumers can receive values from a single source connection. Late subscribers
 * receive the retained replay values before continuing with live emissions.
 * Overlapping reads on the same iterator are fulfilled in request order.
 * The cache survives natural completion, including subsequent iteration of a
 * completed `pipe()`. If all consumers cancel before completion, the upstream
 * disconnects; a later `apply(source)` replays the cache and reconnects.
 *
 * This is useful for:
 * - Preventing redundant execution of a source stream (e.g. a network request).
 * - Providing a "state history" to late subscribers.
 *
 * @template T The type of the values in the stream.
 * @param bufferSize A non-negative safe integer, or `Infinity` (the default).
 * Zero disables replay while still sharing live emissions.
 * @throws {RangeError} If bufferSize is fractional, negative, NaN, or an unsafe integer.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export function shareReplay<T = any>(bufferSize: number = Infinity) {
  if (bufferSize !== Infinity && (!Number.isSafeInteger(bufferSize) || bufferSize < 0)) {
    throw new RangeError('shareReplay bufferSize must be a non-negative safe integer or Infinity');
  }
  let isConnected = false;
  let sourceIterator: AsyncIterator<T> | null = null;
  let activeConnection: symbol | null = null;

  const replay: T[] = [];
  let replayHead = 0;

  let completed = false;
  let errorValue: Error | undefined;

  type PendingRead = {
    resolve(result: IteratorResult<T>): void;
    reject(error: Error): void;
    next?: PendingRead;
  };

  type Subscriber = {
    done: boolean;
    queue: Array<T | undefined>;
    queueHead: number;
    pending: PendingRead | undefined;
    pendingTail: PendingRead | undefined;
  };

  const subscribers = new Set<Subscriber>();

  const pushReplay = (value: T) => {
    if (bufferSize === 0) return;
    if (replay.length < bufferSize) {
      replay.push(value);
    } else {
      replay[replayHead] = value;
      replayHead = (replayHead + 1) % bufferSize;
    }
  };

  const snapshotReplay = (): T[] => replayHead === 0
    ? replay.slice()
    : replay.slice(replayHead).concat(replay.slice(0, replayHead));

  const dequeue = (subscriber: Subscriber): IteratorResult<T> => {
    // Drop each consumed reference without shifting the rest of a large replay.
    const value = subscriber.queue[subscriber.queueHead] as T;
    subscriber.queue[subscriber.queueHead++] = undefined;
    if (subscriber.queueHead === subscriber.queue.length) {
      subscriber.queue = [];
      subscriber.queueHead = 0;
    } else if (subscriber.queueHead >= 1024 && subscriber.queueHead * 2 >= subscriber.queue.length) {
      subscriber.queue = subscriber.queue.slice(subscriber.queueHead);
      subscriber.queueHead = 0;
    }
    return NEXT(value);
  };

  const broadcastValue = (value: T) => {
    for (const subscriber of subscribers) {
      if (subscriber.done) continue;

      const read = subscriber.pending;
      if (read) {
        subscriber.pending = read.next;
        if (!subscriber.pending) subscriber.pendingTail = undefined;
        read.resolve(NEXT(value));
      } else {
        subscriber.queue.push(value);
      }
    }
  };

  const finishSubscriber = (subscriber: Subscriber, error?: Error) => {
    subscriber.done = true;
    subscriber.queue = [];
    subscriber.queueHead = 0;
    let read = subscriber.pending;
    subscriber.pending = subscriber.pendingTail = undefined;
    for (; read; read = read.next) {
      if (error === undefined) read.resolve(DONE);
      else read.reject(error);
    }
  };

  const broadcastTerminal = () => {
    for (const subscriber of subscribers) {
      if (subscriber.pending) finishSubscriber(subscriber, errorValue);
    }
    // Readers without pending pulls can still drain their private queues.
    // The terminal connection will never broadcast to them again.
    subscribers.clear();
  };

  const closeSource = async (source: AsyncIterator<T>) => {
    try { await source.return?.(); } catch { /* Best-effort upstream teardown. */ }
  };

  const disconnect = () => {
    if (sourceIterator) {
      const it = sourceIterator;
      sourceIterator = null;
      isConnected = false;
      activeConnection = null;
      void closeSource(it);
    }
  };

  const connectSource = (source: AsyncIterator<T>) => {
    const connection = Symbol("shareReplayConnection");
    sourceIterator = source;
    isConnected = true;
    activeConnection = connection;
    void (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (activeConnection !== connection) return;
          if (result.done) break;
          pushReplay(result.value);
          broadcastValue(result.value);
        }
      } catch (err) {
        if (activeConnection !== connection) return;
        errorValue = normalizeError(err);
      } finally {
        if (activeConnection !== connection) {
          return;
        }

        sourceIterator = null;
        completed = true;
        isConnected = false;
        activeConnection = null;
        broadcastTerminal();
      }
    })();
  };

  const operator = createOperator<T, T>('shareReplay', function (this: Operator, source) {
    let initialized = false;
    const subscriber: Subscriber = {
      done: false,
      queue: [],
      queueHead: 0,
      pending: undefined,
      pendingTail: undefined,
    };

    const cleanup = () => {
      if (subscriber.done) return;
      finishSubscriber(subscriber);
      subscribers.delete(subscriber);
      if (subscribers.size === 0 && isConnected) {
        disconnect();
      }
    };

    const read = (): IteratorResult<T> | Promise<IteratorResult<T>> => {
      if (subscriber.queueHead < subscriber.queue.length) return dequeue(subscriber);

      if (completed) {
        cleanup();
        if (errorValue !== undefined) throw errorValue;
        return DONE;
      }

      return new Promise((resolve, reject) => {
        const pending: PendingRead = { resolve, reject };
        if (subscriber.pendingTail) subscriber.pendingTail.next = pending;
        else subscriber.pending = pending;
        subscriber.pendingTail = pending;
      });
    };

    const iterator: AsyncIterator<T> = {
      async next() {
        if (subscriber.done) return DONE;
        if (initialized) return read();

        initialized = true;
        subscriber.queue = snapshotReplay();
        if (!completed) subscribers.add(subscriber);

        // Register the first request before invoking any upstream code that
        // could re-enter next(). Closing an unused source cannot block reads.
        try {
          return read();
        } finally {
          if (!completed && !isConnected) connectSource(source);
          else void closeSource(source);
        }
      },

      async return(value?: any) {
        cleanup();
        return { value, done: true } as IteratorResult<T>;
      },

      async throw(err: any) {
        cleanup();
        throw normalizeError(err);
      }
    };

    return iterator;
  });
  return Object.assign(operator, {
    [COMPLETED_REPLAY]: () => completed
      ? operator.apply({ next: async () => DONE })
      : undefined,
  });
}
