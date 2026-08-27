export type MaybePromise<T> = T | PromiseLike<T>;

/** Synapse's minimal cancellable async stream contract. */
export type Stream<T> = AsyncIterable<T>;

export function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return Object.assign(new Error((error as { message: string }).message), error);
  }

  return new Error('Unknown error');
}

/**
 * Creates a fresh cancellable async iterator for every consumer.
 * Returning from or throwing into the iterator aborts its factory signal.
 */
export function flow<T>(
  factory: (signal: AbortSignal) => AsyncIterable<T>,
): Stream<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterableIterator<T> {
      const controller = new AbortController();
      const iterator = factory(controller.signal)[Symbol.asyncIterator]();

      return {
        next(value?: unknown) {
          return iterator.next(value as never);
        },
        throw(error?: unknown) {
          controller.abort(error);
          return iterator.throw?.(error) ?? Promise.reject(error);
        },
        async return(value?: unknown) {
          controller.abort();
          if (iterator.return) return iterator.return(value as never);
          return { done: true, value: value as T };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  };
}

type QueueWaiter<T> = {
  resolve(result: IteratorResult<T>): void;
  reject(error: unknown): void;
};

/** Internal single-consumer queue used by push-driven transports. */
export class AsyncQueue<T> {
  private readonly values: T[] = [];
  private waiter: QueueWaiter<T> | undefined;
  private closed = false;
  private error: Error | undefined;

  push(value: T): void {
    if (this.closed || this.error) return;

    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter.resolve({ done: false, value });
      return;
    }

    this.values.push(value);
  }

  next(): Promise<IteratorResult<T>> {
    if (this.values.length) {
      return Promise.resolve({ done: false, value: this.values.shift()! });
    }

    if (this.error) return Promise.reject(this.error);
    if (this.closed) return Promise.resolve({ done: true, value: undefined as T });

    if (this.waiter) {
      return Promise.reject(new Error('Concurrent reads are not supported'));
    }

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  /** Graceful completion preserves already-buffered values. */
  close(): void {
    if (this.closed || this.error) return;
    this.closed = true;

    if (this.values.length === 0 && this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter.resolve({ done: true, value: undefined as T });
    }
  }

  /** Failure is immediate and discards buffered values. */
  fail(error: unknown): void {
    if (this.closed || this.error) return;
    this.error = normalizeError(error);
    this.values.length = 0;

    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter.reject(this.error);
    }
  }
}
