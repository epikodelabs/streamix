import {
  isPromiseLike,
  type MaybePromise,
  type Subscription,
} from "../atoms";
import { ANALOG, type Atom } from "../atoms/atom";
import { DONE } from "../atoms/operator";
import { getCurrentScope, getScopeMode, registerWithCurrentScope } from "../atoms/scope";
import { createSubscription } from "../atoms/subscription";
import { cyclicBuffer, type CyclicBuffer, type CyclicBufferMode } from "../primitives/cyclicBuffer";
import { normalizeError } from "./helpers";

export type SharedSourceMode = CyclicBufferMode;

export type SharedSourceOptions = {
  /** Stream name for debugging. */
  name?: string;
  /** Explicit mode; if omitted, inferred from the current scope. */
  mode?: SharedSourceMode;
  /** Ring buffer capacity per stream. Defaults to 1 in analog mode, 16 in discrete mode. */
  capacity?: number;
};

/**
 * Creates a hot, shared source atom.
 *
 * The underlying producer is started on the first subscription and stopped
 * when the last subscriber leaves. The stream owns a single cyclic buffer:
 * one buffer, one reader. Values read from the buffer are distributed to
 * callback subscribers and/or the single active async iterator.
 */
export function createSharedSource<T>(
  connect: (push: (value: T) => MaybePromise<void>) => MaybePromise<() => MaybePromise<void>>,
  options: SharedSourceOptions = {}
): Atom<T> {
  const scope = getCurrentScope();
  const mode: CyclicBufferMode =
    options.mode ?? (scope !== null ? getScopeMode(scope) : "discrete");
  const analog = mode === "analog";
  const capacity = options.capacity ?? (analog ? 1 : 16);

  let buffer: CyclicBuffer<T> | null = null;
  let cleanup: (() => MaybePromise<void>) | null = null;
  let connected = false;
  let completed = false;
  let terminalError: any;
  let readerRunning = false;

  const callbacks = new Set<(current: T, previous: T) => MaybePromise>();
  const callbackPromises: Promise<any>[] = [];
  type IteratorWaiter = {
    resolve: (result: IteratorResult<T>) => void;
    reject: (e: Error) => void;
  };
  let iterator: {
    queue: T[];
    waiters: IteratorWaiter[];
    closed: boolean;
  } | null = null;

  const doCleanup = async (): Promise<void> => {
    connected = false;
    const fn = cleanup;
    cleanup = null;
    if (fn) {
      try {
        await Promise.resolve(fn());
      } catch {
        // ignore cleanup errors
      }
    }
  };

  const doConnect = async (): Promise<void> => {
    if (connected || completed) return;
    connected = true;
    try {
      const maybeCleanup = connect(pushToAll);
      if (isPromiseLike(maybeCleanup)) {
        cleanup = await maybeCleanup;
      } else {
        cleanup = maybeCleanup;
      }
    } catch (err) {
      connected = false;
      failAll(normalizeError(err));
    }
  };

  const complete = (err?: Error): void => {
    if (completed) return;
    completed = true;
    terminalError = err;
    if (iterator !== null && !iterator.closed) {
      const it = iterator;
      iterator = null;
      if (err) {
        for (const w of it.waiters) w.reject(err);
      } else {
        for (const w of it.waiters) w.resolve(DONE);
      }
      it.waiters.length = 0;
      it.queue.length = 0;
      it.closed = true;
    }
    void doCleanup();
  };

  const failAll = (err: Error): void => {
    if (completed) return;
    complete(err);
    if (buffer !== null) {
      buffer.close();
      buffer = null;
    }
  };

  const distribute = async (value: T): Promise<void> => {
    if (iterator !== null && !iterator.closed) {
      if (iterator.waiters.length > 0) {
        iterator.waiters.shift()!.resolve({ value, done: false });
      } else {
        iterator.queue.push(value);
      }
    }
    callbackPromises.length = 0;
    for (const cb of callbacks) {
      callbackPromises.push(Promise.resolve(cb(value, value)).catch(() => {}));
    }
    if (callbackPromises.length > 0) {
      await Promise.all(callbackPromises);
    }
  };

  const startReader = (): void => {
    if (readerRunning || buffer === null) return;
    readerRunning = true;
    const activeBuffer = buffer;
    const it = activeBuffer[Symbol.asyncIterator]();

    (async () => {
      try {
        while (activeBuffer === buffer && !completed) {
          const result = await it.next();
          if (result.done || activeBuffer !== buffer) break;
          await distribute(result.value);
        }
      } catch (err) {
        // buffer closed or consumer stopped
        if (!completed && err instanceof Error) {
          complete(err);
        }
      } finally {
        readerRunning = false;
        if (buffer !== null && !completed && activeBuffer !== buffer) {
          startReader();
        }
        endSessionIfIdle();
      }
    })();
  };

  const startSession = (): void => {
    if (buffer !== null) return;
    buffer = cyclicBuffer<T>(capacity, mode);
    if (!connected && !completed) {
      void doConnect();
    }
    startReader();
  };

  const endSessionIfIdle = (): void => {
    if (callbacks.size === 0 && iterator === null && buffer !== null) {
      buffer.close();
      buffer = null;
      if (connected) {
        void doCleanup();
      }
    }
  };

  const pushToAll = async (value: T): Promise<void> => {
    if (completed || buffer === null) return;
    await buffer.push(value);
  };

  const instance: any = {
    type: "atom",
    name: options.name,
    get disposed() {
      return completed && callbacks.size === 0 && iterator === null;
    },
    get subscriberCount() {
      return callbacks.size;
    },
    get error() {
      return terminalError;
    },
    subscribe(callback?: (current: T, previous: T) => MaybePromise): Subscription {
      if (completed) return createSubscription(() => {});

      const cb = callback ?? (() => {});
      callbacks.add(cb);
      startSession();

      return createSubscription(() => {
        callbacks.delete(cb);
        endSessionIfIdle();
      });
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      if (completed) {
        return {
          next: async () => DONE,
          return: async () => DONE,
          throw: async (err) => Promise.reject(normalizeError(err)),
        } as AsyncIterator<T>;
      }

      if (iterator !== null) {
        return {
          next: async () => DONE,
          return: async () => DONE,
          throw: async (err) => Promise.reject(normalizeError(err)),
        } as AsyncIterator<T>;
      }

      iterator = { queue: [], waiters: [], closed: false };
      startSession();

      return {
        next: async (): Promise<IteratorResult<T>> => {
          if (iterator === null || iterator.closed || completed) return DONE;
          if (iterator.queue.length > 0) {
            return { value: iterator.queue.shift()!, done: false };
          }
          return new Promise<IteratorResult<T>>((resolve, reject) => {
            iterator!.waiters.push({ resolve, reject });
          });
        },
        return: async () => {
          if (iterator !== null) {
            const it = iterator;
            iterator = null;
            it.closed = true;
            for (const w of it.waiters) w.reject(new Error("Iterator returned"));
            it.waiters.length = 0;
            it.queue.length = 0;
          }
          endSessionIfIdle();
          return DONE;
        },
        throw: async (err?: any) => Promise.reject(normalizeError(err)),
      };
    },
    dispose() {
      completed = true;
      callbacks.clear();
      if (iterator !== null) {
        for (const w of iterator.waiters) w.reject(new Error("Source disposed"));
        iterator.waiters.length = 0;
        iterator.queue.length = 0;
        iterator.closed = true;
        iterator = null;
      }
      if (buffer !== null) {
        buffer.close();
        buffer = null;
      }
      void doCleanup();
    },
  };

  (instance as any)[ANALOG] = analog;
  registerWithCurrentScope(instance as Atom<T>);

  return instance as Atom<T>;
}
