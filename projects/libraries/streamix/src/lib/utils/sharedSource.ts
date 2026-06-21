import {
  isPromiseLike,
  type MaybePromise,
  type Subscription,
} from "../atoms";
import { ANALOG, type AtomBase } from "../atoms/atom";
import { DONE } from "../atoms/operator";
import { pipe as pipeSource } from "../atoms/pipe";
import { getCurrentScope, getScopeMode, registerWithCurrentScope } from "../atoms/scope";
import { createSubscription } from "../atoms/subscription";
import { cyclicBuffer, type CyclicBuffer, type CyclicBufferMode } from "../primitives/cyclicBuffer";
import { createSemaphore } from "../primitives/semaphore";

export type SharedSourceMode = CyclicBufferMode;

export type SharedSourceOptions = {
  /** Stream name for debugging. */
  name?: string;
  /** Explicit mode; if omitted, inferred from the current scope. */
  mode?: SharedSourceMode;
  /** Ring buffer capacity per subscriber. Defaults to 1 in analog mode, 1024 in discrete mode. */
  capacity?: number;
  /** Maximum number of concurrent subscribers. */
  maxSubscribers?: number;
};

/**
 * Creates a hot, shared source atom.
 *
 * The underlying producer is started on the first subscription and stopped
 * when the last subscriber leaves. Each subscriber receives its own cyclic
 * buffer: discrete mode queues every value, analog mode keeps only the latest
 * value so intermittent values are skipped.
 */
export function createSharedSource<T>(
  connect: (push: (value: T) => void) => MaybePromise<() => MaybePromise<void>>,
  options: SharedSourceOptions = {}
): AtomBase<T> {
  const scope = getCurrentScope();
  const mode: CyclicBufferMode =
    options.mode ?? (scope !== null ? getScopeMode(scope) : "discrete");
  const analog = mode === "analog";
  const capacity = options.capacity ?? (analog ? 1 : 16);
  const maxSubscribers = options.maxSubscribers ?? 32;

  const semaphore = createSemaphore(maxSubscribers);
  const subscribers = new Set<CyclicBuffer<T>>();
  let cleanup: (() => MaybePromise<void>) | null = null;
  let connected = false;
  let completed = false;
  let terminalError: any;

  const pushToAll = (value: T): void => {
    if (completed) return;
    for (const buffer of Array.from(subscribers)) {
      buffer.push(value);
    }
  };

  const failAll = (err: any): void => {
    if (completed) return;
    completed = true;
    terminalError = err;
    for (const buffer of Array.from(subscribers)) {
      buffer.close();
    }
  };

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
      failAll(err instanceof Error ? err : new Error(String(err)));
    }
  };

  const createBuffer = (): CyclicBuffer<T> => cyclicBuffer<T>(capacity, mode);

  const addSubscriber = (buffer: CyclicBuffer<T>): void => {
    if (completed) {
      buffer.close();
      return;
    }
    subscribers.add(buffer);
    if (subscribers.size === 1 && !connected && !completed) {
      void doConnect();
    }
  };

  const removeSubscriber = (buffer: CyclicBuffer<T>, release?: () => void): void => {
    buffer.close();
    subscribers.delete(buffer);
    release?.();
    if (subscribers.size === 0) {
      void doCleanup();
    }
  };

  const instance: any = {
    type: "atom",
    name: options.name,
    get disposed() {
      return completed && subscribers.size === 0;
    },
    get subscriberCount() {
      return subscribers.size;
    },
    get error() {
      return terminalError;
    },
    subscribe(callback?: (value: T) => MaybePromise): Subscription {
      if (completed) return createSubscription(() => {});

      const releasePermit = semaphore.tryAcquire();
      if (!releasePermit) {
        throw new Error(
          `Maximum subscriber limit (${maxSubscribers}) reached for shared source "${options.name ?? "unknown"}"`
        );
      }

      const buffer = createBuffer();
      addSubscriber(buffer);
      const it = buffer[Symbol.asyncIterator]();
      let running = true;

      (async () => {
        try {
          while (running) {
            const result = await it.next();
            if (!running || result.done) return;
            await Promise.resolve(callback?.(result.value));
          }
        } catch {
          // consumer stopped or buffer closed
        }
      })();

      return createSubscription(() => {
        running = false;
        it.return?.();
        removeSubscriber(buffer, releasePermit);
      });
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      if (completed) {
        return {
          next: async () => DONE,
          return: async () => DONE,
          throw: async (err) => Promise.reject(err instanceof Error ? err : new Error(String(err))),
        } as AsyncIterator<T>;
      }

      const releasePermit = semaphore.tryAcquire();
      if (!releasePermit) {
        throw new Error(
          `Maximum subscriber limit (${maxSubscribers}) reached for shared source "${options.name ?? "unknown"}"`
        );
      }

      const buffer = createBuffer();
      addSubscriber(buffer);
      const it = buffer[Symbol.asyncIterator]();
      const baseReturn = it.return?.bind(it);

      return {
        next: () => it.next(),
        return: (value?: any) => {
          removeSubscriber(buffer, releasePermit);
          return baseReturn ? baseReturn(value) : Promise.resolve(DONE);
        },
        throw: (err?: any) => {
          removeSubscriber(buffer, releasePermit);
          throw err instanceof Error ? err : new Error(String(err));
        },
      };
    },
    pipe(...ops: any[]) {
      return pipeSource(instance as AtomBase<T>, ...ops);
    },
    dispose() {
      completed = true;
      for (const buffer of Array.from(subscribers)) buffer.close();
      subscribers.clear();
      void doCleanup();
    },
  };

  (instance as any)[ANALOG] = analog;
  registerWithCurrentScope(instance as AtomBase<T>);

  return instance as AtomBase<T>;
}
