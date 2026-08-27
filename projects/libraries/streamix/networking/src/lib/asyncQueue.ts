import { normalizeError } from './stream';

type Waiter<T> = {
  resolve(result: IteratorResult<T>): void;
  reject(error: unknown): void;
};

export class AsyncQueue<T> {
  private readonly values: T[] = [];
  private waiter: Waiter<T> | undefined;
  private done = false;
  private error: Error | undefined;

  push(value: T): void {
    if (this.done) return;

    if (this.waiter) {
      this.waiter.resolve({ done: false, value });
      this.waiter = undefined;
      return;
    }

    this.values.push(value);
  }

  next(): Promise<IteratorResult<T>> {
    if (this.values.length) {
      return Promise.resolve({ done: false, value: this.values.shift()! });
    }

    if (this.error) {
      return Promise.reject(this.error);
    }

    if (this.done) {
      return Promise.resolve({ done: true, value: undefined as T });
    }

    if (this.waiter) {
      return Promise.reject(new Error('Concurrent reads are not supported'));
    }

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    this.values.length = 0;
    this.waiter?.resolve({ done: true, value: undefined as T });
    this.waiter = undefined;
  }

  fail(error: unknown): void {
    if (this.done) return;
    this.error = normalizeError(error);
    this.done = true;
    this.values.length = 0;
    this.waiter?.reject(this.error);
    this.waiter = undefined;
  }
}
