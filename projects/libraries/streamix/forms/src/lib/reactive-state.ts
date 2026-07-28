export type MaybePromise<T = void> = T | PromiseLike<T>;

export type Subscription = (() => MaybePromise<void>) & {
  readonly unsubscribed: boolean;
};

type Subscriber<T> = (current: T, previous: T) => MaybePromise<void>;
type ErrorHandler = (error: unknown) => MaybePromise<void>;

interface AsyncIteratorState<T> {
  readonly queue: T[];
  readonly waiters: Array<(result: IteratorResult<T>) => void>;
  closed: boolean;
}

function createSubscription(
  teardown?: () => MaybePromise<void>,
): Subscription {
  let unsubscribed = false;

  const unsubscribe = (): MaybePromise<void> => {
    if (unsubscribed) {
      return;
    }

    unsubscribed = true;
    return teardown?.();
  };

  return Object.defineProperty(unsubscribe as Subscription, 'unsubscribed', {
    get: () => unsubscribed,
  });
}

export interface Atom<T = unknown> {
  readonly type: 'atom';
  readonly name?: string;
  readonly value: T;
  readonly safeValue: T;
  readonly previous: T;
  readonly disposed: boolean;
  readonly dirty: boolean;
  readonly error?: unknown;
  readonly subscriberCount?: number;

  subscribe(callback?: Subscriber<T>): Subscription;
  onError(handler: ErrorHandler): Subscription;
  dispose(): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

export interface Writable<T = unknown> extends Atom<T> {
  next(value: T): void;
  set(value: T): void;
  fail(error: unknown, options?: { terminate?: boolean }): void;
  recover(): void;
  clearError(): void;
}

function notifyAsync<T>(
  callback: Subscriber<T>,
  current: T,
  previous: T,
  reportError: (error: unknown) => void,
): void {
  try {
    void Promise.resolve(callback(current, previous)).catch(reportError);
  } catch (error) {
    reportError(error);
  }
}

function notifyError(
  handler: ErrorHandler,
  error: unknown,
): void {
  try {
    void Promise.resolve(handler(error)).catch(console.error);
  } catch (handlerError) {
    console.error(handlerError);
  }
}

export function atom<T>(initial: T): Writable<T> {
  const subscribers = new Set<Subscriber<T>>();
  const errorHandlers = new Set<ErrorHandler>();
  const iterators = new Set<AsyncIteratorState<T>>();

  let current = initial;
  let previous = initial;
  let disposed = false;
  let currentError: unknown;

  const closeIterators = (): void => {
    for (const iterator of iterators) {
      iterator.closed = true;

      while (iterator.waiters.length > 0) {
        iterator.waiters.shift()?.({ value: undefined, done: true });
      }
    }

    iterators.clear();
  };

  const reportError = (error: unknown): void => {
    currentError = error;

    if (errorHandlers.size === 0) {
      console.error(error);
      return;
    }

    for (const handler of errorHandlers) {
      notifyError(handler, error);
    }
  };

  const emit = (next: T): void => {
    if (disposed) {
      return;
    }

    const prior = current;
    previous = prior;
    current = next;
    currentError = undefined;

    for (const iterator of iterators) {
      if (iterator.closed) {
        continue;
      }

      if (iterator.waiters.length > 0) {
        iterator.waiters.shift()?.({ value: next, done: false });
      } else {
        iterator.queue.push(next);
      }
    }

    for (const subscriber of subscribers) {
      notifyAsync(subscriber, next, prior, reportError);
    }
  };

  const publicAtom: Writable<T> = {
    type: 'atom',

    get value(): T {
      if (currentError !== undefined) {
        throw currentError;
      }

      return current;
    },

    get safeValue(): T {
      return current;
    },

    get previous(): T {
      return previous;
    },

    get disposed(): boolean {
      return disposed;
    },

    get dirty(): boolean {
      return false;
    },

    get error(): unknown {
      return currentError;
    },

    get subscriberCount(): number {
      return subscribers.size;
    },

    subscribe(callback?: Subscriber<T>): Subscription {
      if (!callback || disposed) {
        return createSubscription();
      }

      subscribers.add(callback);
      return createSubscription(() => {
        subscribers.delete(callback);
      });
    },

    onError(handler: ErrorHandler): Subscription {
      if (disposed) {
        return createSubscription();
      }

      errorHandlers.add(handler);
      return createSubscription(() => {
        errorHandlers.delete(handler);
      });
    },

    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      subscribers.clear();
      errorHandlers.clear();
      closeIterators();
    },

    [Symbol.asyncIterator](): AsyncIterator<T> {
      const iterator: AsyncIteratorState<T> = {
        queue: [],
        waiters: [],
        closed: disposed,
      };

      if (!disposed) {
        iterators.add(iterator);
      }

      return {
        next(): Promise<IteratorResult<T>> {
          if (iterator.queue.length > 0) {
            return Promise.resolve({
              value: iterator.queue.shift() as T,
              done: false,
            });
          }

          if (disposed || iterator.closed) {
            return Promise.resolve({ value: undefined, done: true });
          }

          return new Promise(resolve => {
            iterator.waiters.push(resolve);
          });
        },

        return(): Promise<IteratorResult<T>> {
          iterator.closed = true;
          iterators.delete(iterator);

          while (iterator.waiters.length > 0) {
            iterator.waiters.shift()?.({ value: undefined, done: true });
          }

          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },

    next(value: T): void {
      emit(value);
    },

    set(value: T): void {
      emit(value);
    },

    fail(error: unknown, options?: { terminate?: boolean }): void {
      reportError(error);

      if (options?.terminate) {
        publicAtom.dispose();
      }
    },

    recover(): void {
      currentError = undefined;
    },

    clearError(): void {
      currentError = undefined;
    },
  };

  return publicAtom;
}
