import {
  atom,
  isPromiseLike,
  NO_INITIAL_VALUE,
  type MaybePromise,
  type Subscription,
} from "../atoms";
import { normalizeError, type Atom, type Writable } from "../atoms/atom";
import { ANALOG_DELIVERY } from "../atoms/delivery";
import { DONE } from "../atoms/operator";
import { createSubscription } from "../atoms/subscription";
import { cyclicBuffer, type CyclicBuffer, type CyclicBufferMode } from "../primitives/cyclicBuffer";

export type SharedSourceMode = CyclicBufferMode;

export type SharedSourceOptions = {
  /** Stream name for debugging. */
  name?: string;
  /** Sequence delivery mode. Defaults to `discrete`. */
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
  const mode: CyclicBufferMode = options.mode ?? "discrete";
  const analog = mode === "analog";
  const capacity = options.capacity ?? (analog ? 1 : 16);
  const stateAtom = atom<T>(NO_INITIAL_VALUE) as Writable<T>;
  const baseDispose = stateAtom.dispose.bind(stateAtom);

  let buffer: CyclicBuffer<T> | null = null;
  let cleanup: (() => MaybePromise<void>) | null = null;
  let connected = false;
  let completed = false;
  let readerRunning = false;
  let pendingDistributions = 0;

  const callbacks = new Set<(current: T, previous: T) => MaybePromise>();
  const callbackPromises: Promise<any>[] = [];
  const distributionWaiters: Array<() => void> = [];
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

  const releaseDistributionWaiters = (): void => {
    if (pendingDistributions > 0 && !completed && buffer !== null) return;
    while (distributionWaiters.length > 0) {
      distributionWaiters.shift()!();
    }
  };

  const resetPendingDistributions = (): void => {
    pendingDistributions = 0;
    releaseDistributionWaiters();
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
    releaseDistributionWaiters();
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
    stateAtom.fail(err, { terminate: false });
    complete(err);
    if (buffer !== null) {
      buffer.close();
      buffer = null;
    }
    resetPendingDistributions();
  };

  const distribute = async (value: T): Promise<void> => {
    stateAtom.next(value);
    const current = stateAtom.value;

    if (iterator !== null && !iterator.closed) {
      if (iterator.waiters.length > 0) {
        iterator.waiters.shift()!.resolve({ value, done: false });
      } else {
        iterator.queue.push(value);
      }
    }
    callbackPromises.length = 0;
    for (const cb of callbacks) {
      try {
        callbackPromises.push(Promise.resolve(cb(current, current)).catch(() => {}));
      } catch {
        // ignore subscriber callback errors
      }
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
          if (!analog && pendingDistributions > 0) {
            pendingDistributions--;
          }
          releaseDistributionWaiters();
        }
      } catch (err) {
        // buffer closed or consumer stopped
        if (!completed && activeBuffer === buffer) {
          complete(normalizeError(err));
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
      resetPendingDistributions();
      if (connected) {
        void doCleanup();
      }
    }
  };

  const pushToAll = async (value: T): Promise<void> => {
    const activeBuffer = buffer;
    if (completed || activeBuffer === null) return;

    if (!analog) {
      pendingDistributions++;
    }

    await activeBuffer.push(value);

    if (analog) return;

    if (completed || activeBuffer !== buffer) {
      if (pendingDistributions > 0) {
        pendingDistributions--;
      }
      releaseDistributionWaiters();
      return;
    }

    if (pendingDistributions === 0) return;

    await new Promise<void>((resolve) => {
      distributionWaiters.push(resolve);
      releaseDistributionWaiters();
    });
  };

  const instance = stateAtom as Writable<T> & {
    name?: string;
    subscriberCount?: number;
  };

  Object.defineProperties(instance, {
    name: {
      value: options.name,
      configurable: true,
      enumerable: true,
      writable: true,
    },
    subscriberCount: {
      get: () => callbacks.size,
      configurable: true,
      enumerable: true,
    },
  });

  instance.subscribe = (callback?: (current: T, previous: T) => MaybePromise): Subscription => {
      if (completed) return createSubscription(() => {});

      const cb = callback ?? (() => {});
      callbacks.add(cb);
      startSession();

      return createSubscription(() => {
        callbacks.delete(cb);
        endSessionIfIdle();
      });
  };

  instance[Symbol.asyncIterator] = (): AsyncIterator<T> => {
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
  };

  instance.dispose = () => {
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
      resetPendingDistributions();
      void doCleanup();
      baseDispose();
  };

  if (analog) (instance as any)[ANALOG_DELIVERY] = true;

  return instance as Atom<T>;
}