import type { AtomBase } from "./atom";
import type { MaybePromise } from "./operator";

/**
 * Creates an async iterable from an atom.
 *
 * Yields the current value immediately, then yields subsequent values
 * whenever the atom emits. The iterable completes when the atom is disposed.
 *
 * @param source - The atom or async iterable to iterate over.
 * @returns An async iterable iterator that yields source values.
 *
 * @example
 * ```ts
 * const a = atom(0);
 * setTimeout(() => a.next(1), 10);
 * setTimeout(() => a.next(2), 20);
 * setTimeout(() => a.dispose(), 30);
 *
 * for await (const value of iterate(a)) {
 *   console.log(value); // 0, 1, 2
 * }
 * ```
 */
export function iterate<T>(source: AtomBase<T> | AsyncIterable<T>): AsyncIterableIterator<T> {
  if (!("type" in source) || (source as any).type !== "atom") {
    return source as AsyncIterableIterator<T>;
  }

  const atom = source as AtomBase<T>;

  let initialized = false;
  let buffer: T[] = [];
  let resolveNext: ((res: IteratorResult<T>) => void) | null = null;
  let rejectNext: ((e: any) => void) | null = null;
  let done = false;
  let onPush: (() => void) | undefined;
  let finish: (() => MaybePromise<void>) | undefined;
  let checkError: (() => any) | undefined;

  const notifyPush = () => {
    if (onPush) {
      try {
        onPush();
      } catch {
        // ignore consumer errors
      }
    }
  };

  const ensureInit = () => {
    if (initialized) return;
    initialized = true;

    const sub = atom.subscribe((value) => {
      if (done) return;
      if (resolveNext) {
        resolveNext({ value, done: false });
        resolveNext = null;
        rejectNext = null;
      } else {
        buffer.push(value);
      }
      notifyPush();
    });

    finish = () => {
      if (done) return;
      const cleanup = sub.unsubscribe();
      const err = (atom as any)._error;
      if (resolveNext) {
        if (err) {
          done = true;
          const r = rejectNext!;
          resolveNext = null;
          rejectNext = null;
          r(err);
        } else if (buffer.length === 0) {
          done = true;
          resolveNext({ value: undefined as any, done: true });
          resolveNext = null;
          rejectNext = null;
        }
      }
      notifyPush();
      return cleanup;
    };

    (atom as any)._onDispose?.add(finish);

    checkError = () => {
      const err = (atom as any)._error;
      if (err !== undefined) {
        return err;
      }
      return undefined;
    };
  };

  const iterator: AsyncIterableIterator<T> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      ensureInit();
      if (done) return { value: undefined as any, done: true };

      const err = checkError!();
      if (err) {
        await finish!();
        throw err;
      }

      if (buffer.length > 0) {
        const val = buffer.shift()!;
        if (atom.disposed && buffer.length === 0) {
          done = true;
        }
        return { value: val, done: false };
      }

      if (atom.disposed) {
        done = true;
        return { value: undefined as any, done: true };
      }

      return new Promise<IteratorResult<T>>((resolve, reject) => {
        resolveNext = resolve;
        rejectNext = reject;
      });
    },
    async return() {
      ensureInit();
      await finish!();
      return { value: undefined as any, done: true };
    },
  };

  (iterator as any).__tryNext = (): IteratorResult<T> | null => {
    ensureInit();
    if (done) return { value: undefined as any, done: true };
    const err = checkError!();
    if (err) {
      throw err;
    }
    if (buffer.length > 0) {
      const val = buffer.shift()!;
      if (atom.disposed && buffer.length === 0) {
        done = true;
      }
      return { value: val, done: false };
    }
    if (atom.disposed) {
      done = true;
      return { value: undefined as any, done: true };
    }
    return null;
  };

  (iterator as any).__hasBufferedValues = () => buffer.length > 0;

  Object.defineProperty(iterator, "__onPush", {
    get() {
      return onPush;
    },
    set(cb: () => void) {
      onPush = cb;
    },
    configurable: true,
  });

  return iterator;
}
