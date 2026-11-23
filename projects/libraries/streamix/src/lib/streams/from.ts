import { DONE, NEXT, createStream, type MaybePromise, type Stream } from "../abstractions";
import { raceNext } from "../utils/coordinator";

/**
 * Creates a stream from an asynchronous or synchronous iterable.
 *
 * This operator is a powerful way to convert any source that can be iterated
 * over (such as arrays, strings, `Map`, `Set`, `AsyncGenerator`, etc.) into
 * a reactive stream. The stream will emit each value from the source in order
 * before completing.
 *
 * @template T The type of the values in the iterable.
 * @param {AsyncIterable<T> | Iterable<T> | PromiseLike<AsyncIterable<T> | Iterable<T>>} source The iterable source to convert into a stream.
 * @returns {Stream<T>} A new stream that emits each value from the source.
 */
export function from<T = any>(source: MaybePromise<AsyncIterable<T> | Iterable<T>>): Stream<T> {
  const openIterator = (): AsyncIterator<T> & AsyncIterable<T> => {
    let upstream: Promise<AsyncIterator<T> | Iterator<T>> | undefined;
    let closed = false;
    let closing: Promise<void> | undefined;
    let pending = Promise.resolve();
    const controller = new AbortController();
    const close = () => {
      closed = true;
      controller.abort();
      return closing ??= upstream?.then(
        async iterator => { await iterator.return?.(); },
        () => {},
      ) ?? Promise.resolve();
    };

    const iterator: AsyncIterator<T> & AsyncIterable<T> = {
      [Symbol.asyncIterator]() { return this; },
      next() {
        if (closed) return Promise.resolve(DONE);
        const read = pending.then(async () => {
          if (closed) return DONE;
          upstream ??= Promise.resolve(source).then(iterable =>
            (iterable as AsyncIterable<T>)[Symbol.asyncIterator]?.()
            ?? (iterable as Iterable<T>)[Symbol.iterator]()
          );
          try {
            const input = await upstream;
            if (closed) return DONE;
            const result = await input.next();
            if (!result.done) {
              const value = await (result.value as T);
              return closed ? DONE : NEXT(value);
            }
            return DONE;
          } catch (error) {
            if (!closed) throw error;
            return DONE;
          }
        });
        const result = raceNext<T>({ next: () => read }, controller.signal).then(async item => {
          if (item.done) await close();
          return item;
        }, async error => {
          await close();
          throw error;
        });
        pending = result.then(() => {}, () => {});
        return result;
      },
      async return(value?: unknown) {
        await close();
        return { done: true, value };
      },
      async throw(error?: unknown) {
        await close();
        throw error;
      },
    };
    return iterator;
  };

  const stream = createStream<T>('from', async function* (signal) {
    const iterator = openIterator();
    try {
      while (true) {
        const result = signal ? await raceNext(iterator, signal) : await iterator.next();
        if (result.done) return;
        yield result.value;
      }
    } finally {
      await iterator.return?.();
    }
  });
  // Direct consumers pull on demand. Subscriptions share a generator run.
  stream[Symbol.asyncIterator] = openIterator;
  return stream;
}
